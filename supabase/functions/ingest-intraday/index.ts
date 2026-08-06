// Thin HTTP handler for ingest-intraday.
//
//   ?series=hr,hrv,spo2   (default: all three)
//   ?date=YYYY-MM-DD      single day (default: yesterday UTC) — daily mode
//   ?from=YYYY-MM-DD&to=YYYY-MM-DD   date range — backfill mode
//   ?dryRun=true          fetch + shape, write nothing, return a preview
//
// Same code for daily and backfill; the caller picks the range. Back-fill HR
// separately from hrv/spo2 (volume) by calling with ?series=hr on its own.

import { createClient } from "npm:@supabase/supabase-js@2";
import { ingest } from "./ingest.ts";
import { readGoogleSecrets, writeSecret } from "./vault.ts";
import { ReauthRequiredError, SERIES, type SeriesKey } from "./google.ts";
import { notifyOnce, resolveByDedupe } from "../_shared/notify.ts";

// "Am I the last scheduled attempt?" is the CRON's knowledge, not the function's.
// The cron marks its final tick with ?final=1 (see the *_cron_*.sql migrations);
// only a final tick escalates a still-empty / still-failing result to
// ops.notifications. No wall-clock heuristic here — that was a hidden coupling
// between pg_cron and this file and broke once the schedule moved to Lisbon time.

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function yesterdayUtc(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// A window bound accepts a date (YYYY-MM-DD) or a full ISO datetime. A bare date
// means start-of-day; as an END bound it means end-of-day (+1 day, exclusive).
function parseBound(s: string, isEnd: boolean): number | null {
  if (DAY_RE.test(s)) {
    const ms = Date.parse(`${s}T00:00:00Z`);
    return isEnd ? ms + 86_400_000 : ms;
  }
  const ms = Date.parse(s);
  return Number.isNaN(ms) ? null : ms;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dryRun") === "true";
  // resume defaults on (cron/forward-only). ?resume=false honours the requested
  // window verbatim for continuous series — required to backfill past HR days,
  // where the stored watermark would otherwise clamp the start forward.
  const resume = url.searchParams.get("resume") !== "false";
  // final: set by the cron on the LAST tick of a retry ladder. Only a final
  // tick may escalate an empty/failed result to a notification; earlier ticks
  // are expected to self-heal on the next retry. reauth is exempt (always fires).
  const finalParam = url.searchParams.get("final");
  const isFinal = finalParam === "1" || finalParam === "true";

  // series
  const seriesParam = url.searchParams.get("series");
  const series = (seriesParam ? seriesParam.split(",") : ["hr", "hrv", "spo2"])
    .map((s) => s.trim()).filter(Boolean);
  const invalid = series.filter((s) => !(s in SERIES));
  if (invalid.length) {
    return json({ ok: false, error: `series inválida: ${invalid.join(", ")} (usar hr | hrv | spo2)` }, 400);
  }

  // window: ?date=D (single day) or ?from=&to= (date or ISO datetime).
  // Default (no window param at all): "yesterday" for sleep series (daily
  // cron convention) — but a bare "?series=hr" (the HR cron's own call) needs
  // an upper bound of *now*, not end-of-yesterday, since HR's forward-only
  // resume (ingest.ts) picks its own start from the stored watermark and
  // just needs "up to now" as the end; "yesterday" would leave it forever
  // stuck fetching a day-old ceiling.
  const dateParam = url.searchParams.get("date");
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");
  let rawFrom: string, rawTo: string;
  if (fromParam || toParam) {
    rawFrom = fromParam ?? toParam!;
    rawTo = toParam ?? fromParam!;
  } else if (dateParam) {
    rawFrom = rawTo = dateParam;
  } else if (series.every((s) => SERIES[s as SeriesKey].kind === "continuous")) {
    rawFrom = new Date(Date.now() - 6 * 3600_000).toISOString(); // fallback lower bound; the real start comes from the watermark
    rawTo = new Date().toISOString();
  } else {
    rawFrom = rawTo = yesterdayUtc();
  }
  const rangeStartMs = parseBound(rawFrom, false);
  const rangeEndMs = parseBound(rawTo, true);
  if (rangeStartMs === null || rangeEndMs === null) {
    return json({ ok: false, error: `janela inválida (usar YYYY-MM-DD ou ISO datetime): from="${rawFrom}" to="${rawTo}"` }, 400);
  }
  if (rangeStartMs >= rangeEndMs) {
    return json({ ok: false, error: `janela vazia: from >= to` }, 400);
  }

  const client = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  try {
    const secrets = await readGoogleSecrets(client);
    const { results, rotatedRefreshToken } = await ingest(
      { series: series as SeriesKey[], rangeStartMs, rangeEndMs, dryRun, resume },
      secrets,
      client,
    );

    let refreshTokenRotated = false;
    if (rotatedRefreshToken) {
      await writeSecret(client, "google_refresh_token", rotatedRefreshToken);
      refreshTokenRotated = true;
    }

    if (!dryRun) {
      const dayStr = dateParam ?? new Date(rangeStartMs).toISOString().slice(0, 10);
      for (const r of results) {
        if (r.kind !== "sleep") continue;
        const hasData = (r.stored_after ?? r.rows_written) > 0;
        if (hasData) {
          // Data present (this run wrote it, or a reconcile pass found it late):
          // close any open data_missing for this series+day. Runs on every tick,
          // not just final, so the loop closes as soon as the data arrives.
          await resolveByDedupe(client, "data_missing", `data_missing:${r.series}:${dayStr}`)
            .catch((e) => console.error(`[ingest-intraday] falha ao resolver notificação: ${e}`));
        } else if (isFinal) {
          // Still empty at the schedule's final tick (?final=1) → escalate once.
          await notifyOnce(client, {
            type: "data_missing",
            severity: "warning",
            title: `Dados de ${r.series} em falta para ${dayStr}`,
            detail: r.note ?? `sem pontos ${r.series} até ao último tick agendado`,
            context: { series: r.series, day: dayStr },
            dedupeKey: `data_missing:${r.series}:${dayStr}`,
          }).catch((e) => console.error(`[ingest-intraday] falha ao gravar notificação: ${e}`));
        }
      }
    }

    return json({
      ok: true,
      window: { from: new Date(rangeStartMs).toISOString(), to: new Date(rangeEndMs).toISOString() },
      dry_run: dryRun,
      series: results,
      refresh_token_rotated: refreshTokenRotated,
    });
  } catch (err) {
    if (err instanceof ReauthRequiredError) {
      console.error(`[ingest-intraday] ${err.message}`);
      await notifyOnce(client, {
        type: "reauth_required",
        severity: "error",
        title: "Google Health token expirado — reautenticação necessária",
        detail: err.message,
        dedupeKey: "reauth_required",
      }).catch((e) => console.error(`[ingest-intraday] falha ao gravar notificação: ${e}`));
      return json({ ok: false, error: err.message, action: "re-autenticar Google e atualizar google_refresh_token no Vault" }, 401);
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[ingest-intraday] falha: ${message}`);

    // "Falha total após esgotar retries": a thrown error only escalates on the
    // schedule's final tick (?final=1). Earlier ticks stay silent — the ladder
    // will retry, and a transient error that clears must not raise an alarm.
    // This also fixes the old HR bug where an unconditional :30 retry raised an
    // ingestion_failure even after the base run had already succeeded.
    if (!dryRun && isFinal) {
      const dayStr = dateParam ?? new Date(rangeStartMs).toISOString().slice(0, 10);
      const isHr = series.includes("hr");
      // HR's ladder repeats every 3h → bucket the dedupe key by hour so each
      // cycle can raise at most one alert; sleep series → one per target day.
      const bucket = isHr ? new Date().toISOString().slice(0, 13) : dayStr;
      await notifyOnce(client, {
        type: "ingestion_failure",
        severity: "error",
        title: isHr ? "Ingestão de HR falhou repetidamente" : "Ingestão de HRV/SpO2 falhou",
        detail: message,
        context: { series: series.join(","), day: dayStr },
        dedupeKey: `ingestion_failure:${series.join(",")}:${bucket}`,
      }).catch((e) => console.error(`[ingest-intraday] falha ao gravar notificação: ${e}`));
    }

    return json({ ok: false, error: message }, 500);
  }
});
