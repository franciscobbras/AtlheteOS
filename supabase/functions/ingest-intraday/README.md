# ingest-intraday

Raw ingestion of the three Fitbit Air intraday series (Google Health API v4) into
`wearable.*`. Computes nothing; stores raw points; upserts idempotently on
`(timestamp_utc, source)`. `source = 'fitbit_air'`.

| series | dataType | table | value | cadence | coverage |
|--------|----------|-------|-------|---------|----------|
| `hr`   | `heart-rate`             | `wearable.heart_rate` | `bpm` (int) + `recording_method` | ~1/min | **24/7** |
| `hrv`  | `heart-rate-variability` | `wearable.hrv_instant` | `rmssd_ms` | 5 min | **sleep only** |
| `spo2` | `oxygen-saturation`      | `wearable.spo2` | `percentage` | ~1/min | **sleep only** (confirmed) |

Every point stores its **own** `utc_offset_seconds` (from the sample's `utcOffset`
Duration) — so choosing UTC-day vs local at read time stays open, even for HR.

## Window parameter

The fetch window is a plain parameter, same for every series:

- `?date=YYYY-MM-DD` — one day (default: yesterday UTC).
- `?from=…&to=…` — each bound is a date (`YYYY-MM-DD`) **or** a full ISO datetime
  (`2026-07-29T09:00:00Z`). A bare date is start-of-day; a bare `to` date is end-of-day.

The function only ingests the window it's given. **Scheduling / catch-up / resume is
an automation concern, decided separately** — the function bakes none of it in.

### HR volume note

HR is sampled every ~2–3 s → **~36k points/day**, and the API has no server-side time
filter, so pagination always starts from newest. Practically that means **only recent
windows are feasible** for HR (a far-past day would page through everything newer and
hit the time budget → `timed_out`, partial). Pick small recent windows for HR (e.g.
`?series=hr&from=2026-07-29T09:00:00Z&to=2026-07-29T15:00:00Z`). Each point stores its
own `utc_offset_seconds`, so UTC-day-vs-local stays a read-time decision.

## The "night" rule (hrv / spo2)

- **hr (continuous):** fetches exactly the requested window; no sleep dependency.
- **hrv / spo2 (sleep):** the night = the **sleep interval** from `wearable.sleep`,
  not the UTC day. For the requested range we load the overlapping sleep nights,
  fetch exactly the span they cover (so pre-midnight is never cut), and keep only
  points inside an interval. **The grouping-by-night itself is a read-time concern**
  — storage is a pure timestamp series.

> ⚠️ **Ordering:** hrv/spo2 need `wearable.sleep` already populated for the same
> nights. Run **sleep first** (`ingest-wearable`), then hrv/spo2. If no sleep exists
> for the range, that series is skipped with a `note` (nothing written).

## Prerequisites (once)

- Tables exist with `unique (timestamp_utc, source)` — created by
  `20260729000000_wearable_intraday_series.sql` (already applied). That constraint
  backs the `ON CONFLICT (timestamp_utc, source)` upsert; no extra index needed.
- Vault secrets + exposed `wearable` schema (same as `ingest-wearable`).

## Daily (cron, phase 2) — cheap, recent only

Order matters: sleep/daily first, then intraday.

```
1. ingest-wearable            (sleep + daily aggregates, date=yesterday)
2. ingest-intraday?date=<yesterday>            (all three; hrv/spo2 read yesterday's sleep)
```

A single `?date=` (default: yesterday UTC) pages only the recent stream → fast.

## Backfill — hrv / spo2 (sleep-bounded, low volume)

`?from=&to=` runs one pagination pass over the range. hrv/spo2 are light
(~90 and ~470 points/night), so a multi-day range is fine. HR is **not**
deep-backfillable (volume + no server-side time filter — see above).

```bash
BASE="https://owdabspslxibnyybtcxx.supabase.co/functions/v1/ingest-intraday"

# sleep must already be backfilled (ingest-wearable) for these nights, then:
curl -s "$BASE?series=hrv,spo2&from=2026-07-12&to=2026-07-28" | jq '.series'
```

## Dry run

`&dryRun=true` fetches + shapes but writes nothing; each series returns
`points_fetched`, `rows_ready`, `pages`, `capped`, and a 3-row `sample`.

```bash
curl -s "$BASE?series=hr,hrv,spo2&date=2026-07-28&dryRun=true" | jq
```

## Response shape

```json
{
  "ok": true,
  "range": { "from": "2026-07-28", "to": "2026-07-28" },
  "dry_run": false,
  "series": [
    { "series": "hr",   "kind": "continuous", "points_fetched": 1420, "rows_ready": 1420, "rows_written": 1420, "pages": 29, "capped": false },
    { "series": "hrv",  "kind": "sleep",      "points_fetched": 88,   "rows_ready": 88,   "rows_written": 88,   "pages": 6,  "capped": false },
    { "series": "spo2", "kind": "sleep",      "points_fetched": 470,  "rows_ready": 470,  "rows_written": 470,  "pages": 11, "capped": false }
  ],
  "refresh_token_rotated": false
}
```

- `invalid_grant` / 401 / 403 → HTTP 401 with a clear re-auth message.
- `note: "sem noites de sono…"` on hrv/spo2 → ingest sleep first.
- `capped: true` → reduce the range (chunk) for that series.
