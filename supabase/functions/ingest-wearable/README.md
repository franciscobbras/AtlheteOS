# ingest-wearable

Raw ingestion of Google Health API data (Fitbit-backed, `source = 'fitbit_air'`)
into `wearable.daily_metrics` and `wearable.sleep`. **Computes nothing** — every
formula (LnRMSSD, CTL/ATL, …) lives in `src/lib/metrics.ts` and reads weights
from `metrics.config`. This function only stores raw values.

## Layout

| File | Role |
|------|------|
| `index.ts` | Thin HTTP handler: resolves date, reads Vault, runs `ingest()`, persists rotated tokens, shapes JSON. |
| `ingest.ts` | Pure `ingest(date, secrets, client)` — testable in isolation, no HTTP/Vault/env. |
| `google.ts` | OAuth refresh + Google Health fetch + raw→column extraction. Only module that calls Google. |
| `vault.ts` | Vault read/write via the `get_secret` / `upsert_secret` RPCs. |
| `../../migrations/20260727000000_wearable_vault_helpers.sql` | The two SECURITY DEFINER Vault helpers (service_role only). |

`ingest()` returns `rotatedRefreshToken`; the **handler** writes it back to the
Vault. That keeps `ingest()` free of Vault side effects and unit-testable.

## What it writes

- **`wearable.daily_metrics`** — one row per `metric_type`, upsert on
  `(date, metric_type, source)`:
  - `daily_hrv_rmssd` — **raw RMSSD in ms** (never log-transformed here)
  - `resting_hr` — bpm
  - `temp_nightly`, `temp_baseline`, `temp_stddev_30d` — °C, the three raw
    temperature components. The deviation is **derived in metrics.ts**, never
    here. Any component absent from the payload is skipped (others still write).
  - Full matched dataPoint in `raw`.
- **`wearable.sleep`** — upsert on `(start_utc, source)`:
  `start_utc`, `end_utc`, `utc_offset_seconds` (offset in effect during sleep,
  not the server's), `stages`, `summary`, `raw`.

A metric absent from the payload is simply not written — no null rows.

## Idempotency

Both writes are `ON CONFLICT` upserts on the tables' unique constraints, so
re-running the same `?date=` overwrites in place — never duplicates. Run it as
many times as you like during phase-1 validation.

## Prerequisites (once)

1. **Vault secrets** — store these three (Dashboard → Project Settings → Vault,
   or `select vault.create_secret(...)`):
   `google_client_id`, `google_client_secret`, `google_refresh_token`.
2. **Vault helpers** — apply the migration: `supabase db push` (or run the SQL
   in the SQL editor).
3. **Expose `wearable`** to PostgREST on the remote project:
   Settings → API → Exposed schemas → add `wearable`. (Mirrored locally in
   `supabase/config.toml`.) Without this, `client.schema("wearable")` 404s.
4. **Google OAuth consent** with scopes:
   - `…/auth/googlehealth.health_metrics_and_measurements.readonly`
   - `…/auth/googlehealth.sleep.readonly`

## Phase 1 — run by hand

```bash
# from repo root (Nexus/)
cp supabase/functions/ingest-wearable/.env.example supabase/functions/ingest-wearable/.env
#  → fill SUPABASE_SERVICE_ROLE_KEY so the served function hits the REAL project

supabase functions serve ingest-wearable \
  --env-file supabase/functions/ingest-wearable/.env --no-verify-jwt

# DRY RUN first — fetch + extract, write nothing, return what WOULD be written
# (incl. the matched raw dataPoints) so you can confirm the field mappings:
curl -s "http://localhost:54321/functions/v1/ingest-wearable?date=2026-07-20&dryRun=true" | jq

# yesterday (UTC), real write:
curl -s "http://localhost:54321/functions/v1/ingest-wearable" | jq

# specific day (backfill):
curl -s "http://localhost:54321/functions/v1/ingest-wearable?date=2026-07-20" | jq
```

Response shape (real write):

```json
{
  "ok": true,
  "date": "2026-07-20",
  "dry_run": false,
  "written": {
    "daily_metrics": { "daily_hrv_rmssd": true, "resting_hr": true, "temp_nightly": true, "temp_baseline": true, "temp_stddev_30d": true },
    "sleep": true
  },
  "refresh_token_rotated": false
}
```

On `dryRun=true`, nothing is written; `written` becomes `would_write` and a
`preview` block carries the exact rows (with each matched `raw` dataPoint) for
inspection. The Vault token rotation still persists on a dry run — the refresh
already happened, so dropping a rotated token would break the next call.

- `date` omitted → **yesterday (UTC)**. Arbitrary `?date=YYYY-MM-DD` backfills
  older days. `&dryRun=true` on any of them to inspect without writing.
- `invalid_grant` or a 401/403 from Google → HTTP **401** with
  `"re-auth necessária…"` and an `action` hint. Never fails silently.
- `.env` holds the service-role key — **do not commit it**.

### Google Health API (v4)

Endpoint: `GET https://health.googleapis.com/v4/users/me/dataTypes/{dataType}/dataPoints`,
paginated via `nextPageToken`, ~15 min batch latency. dataTypes (kebab-case), in
`google.ts` → `DATA_TYPE`:

| dataType | → metric_type(s) |
|----------|------------------|
| `daily-heart-rate-variability`         | `daily_hrv_rmssd` (RMSSD cru, ms) |
| `daily-resting-heart-rate`             | `resting_hr` (bpm) |
| `daily-sleep-temperature-derivations`  | `temp_nightly` + `temp_baseline` + `temp_stddev_30d` (°C) |
| `sleep`                                | `wearable.sleep` |

Field paths (no `value` wrapper; int64 as strings; `startUtcOffset` as Duration;
daily `date` is a `{year,month,day}` object matched on the wake day):
- HRV → `dailyHeartRateVariability.averageHeartRateVariabilityMilliseconds`
- RHR → `dailyRestingHeartRate.beatsPerMinute` (string int64)
- Temp → `dailySleepTemperatureDerivations.{nightlyTemperatureCelsius,
  baselineTemperatureCelsius, relativeNightlyStddev30dCelsius}` → 3 raw rows
- Sleep → `sleep.interval` / `sleep.stages` / `sleep.summary`; offset from
  `interval.startUtcOffset` ("3600s" → 3600).

### Validated in phase 1

Confirmed against real payloads (2026-07-27): OAuth, v4 endpoint, pagination,
`{year,month,day}` date matching on the wake day, int64/Duration parsing, HRV/RHR
value paths, the three temperature components, sleep interval/stages/summary,
upserts, idempotency, errors. Use `&dryRun=true` (returns `preview.debug` with
per-dataType counts + first raw point) whenever a mapping needs re-checking.

## Phase 2 — schedule with pg_cron (later; do not build yet)

The function code does **not** change — cron just hits the same URL. The Google
batch has **~15 min latency**, and the default date is *yesterday UTC*, so
schedule comfortably after midnight UTC to let the previous day settle — e.g.
**03:00 UTC** (≈ 03:00 lisboa no inverno / 04:00 no verão).

Sketch to implement in phase 2 (`pg_cron` + `pg_net`, service key from Vault):

```sql
-- pseudo — not active yet
select cron.schedule(
  'ingest-wearable-daily',
  '0 3 * * *',
  $$
    select net.http_post(
      url     := 'https://owdabspslxibnyybtcxx.supabase.co/functions/v1/ingest-wearable',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || public.get_secret('service_role_key'),
        'Content-Type',  'application/json'
      )
    );
  $$
);
```
