// Pure intraday ingestion — one date range, one or more series.
//
//   · Continuous series (hr): grouped by UTC day → fetch the whole [from, to+1d)
//     window. Every point keeps its OWN utc_offset_seconds, so UTC-day-vs-local
//     stays a read-time decision.
//   · Sleep series (hrv, spo2): the "night" is the sleep interval from
//     wearable.sleep — we fetch exactly the span those nights cover (not the UTC
//     day, so pre-midnight is never cut) and keep points inside an interval. If
//     no sleep exists for the range, we skip with a note (ingest sleep first).
//
// Everything is stored raw and upserted on (timestamp_utc, source) → idempotent.

import {
  exchangeRefreshToken,
  fetchRange,
  SERIES,
  type GoogleSecrets,
  type RawPoint,
  type SeriesKey,
} from "./google.ts";

// deno-lint-ignore no-explicit-any
type Client = any;

const SOURCE = "fitbit_air";
const UPSERT_CHUNK = 500;

const TABLE: Record<SeriesKey, string> = {
  hr: "heart_rate",
  hrv: "hrv_instant",
  spo2: "spo2",
};

// Count stored rows in a time window (for the reconciliation before/after delta).
// Best-effort: a count error must never abort ingestion, so returns null.
async function countStored(client: Client, table: string, startMs: number, endMs: number): Promise<number | null> {
  const { count, error } = await client
    .schema("wearable")
    .from(table)
    .select("timestamp_utc", { count: "exact", head: true })
    .gte("timestamp_utc", new Date(startMs).toISOString())
    .lte("timestamp_utc", new Date(endMs).toISOString());
  return error ? null : (count ?? 0);
}

export interface SeriesResult {
  series: SeriesKey;
  kind: string;
  points_fetched: number;
  rows_ready: number;
  rows_written: number;
  pages: number;
  capped: boolean;
  timed_out: boolean;
  oldest_reached: string | null;
  // Reconciliation view: how many rows were stored for this window before vs
  // after this run. `added` = stored_after − stored_before = points the API
  // produced late (Fitbit keeps refining a night for hours). Lets a T+24h/48h
  // pass see and pull exactly the delta.
  stored_before?: number | null;
  stored_after?: number | null;
  added?: number | null;
  note?: string;
  // deno-lint-ignore no-explicit-any
  sample?: any[];
}

export interface IngestResult {
  results: SeriesResult[];
  rotatedRefreshToken: string | null;
}

export interface IngestParams {
  series: SeriesKey[];
  rangeStartMs: number; // fetch window start (epoch ms)
  rangeEndMs: number;   // fetch window end (epoch ms, exclusive)
  dryRun: boolean;
  resume: boolean;      // continuous series: clamp start to the stored watermark (cron default). false = honour the requested window verbatim (backfill of past days).
}

// deno-lint-ignore no-explicit-any
function toRow(series: SeriesKey, p: RawPoint): any {
  const base = {
    timestamp_utc: p.time,
    utc_offset_seconds: p.offsetSeconds ?? 0, // always present in the API; ?? 0 is a guard
    source: SOURCE,
  };
  if (series === "hr") return { ...base, bpm: Math.round(p.value as number), recording_method: p.recordingMethod };
  if (series === "hrv") return { ...base, rmssd_ms: p.value };
  return { ...base, percentage: p.value }; // spo2
}

export async function ingest(params: IngestParams, secrets: GoogleSecrets, client: Client): Promise<IngestResult> {
  const token = await exchangeRefreshToken(secrets);

  const results: SeriesResult[] = [];
  for (const s of params.series) {
    results.push(await ingestSeries(s, params.rangeStartMs, params.rangeEndMs, token.accessToken, client, params.dryRun, params.resume));
  }

  return { results, rotatedRefreshToken: token.rotatedRefreshToken };
}

async function ingestSeries(
  series: SeriesKey,
  rangeStartMs: number,
  rangeEndMs: number,
  accessToken: string,
  client: Client,
  dryRun: boolean,
  resume: boolean,
): Promise<SeriesResult> {
  const cfg = SERIES[series];

  // Continuous (hr): fetch exactly the requested window. Sleep (hrv/spo2): the
  // window scopes which sleep nights we consider; we then fetch each night's span.
  let fetchStartMs = rangeStartMs;
  let fetchEndMs = rangeEndMs;
  let intervals: Array<{ s: number; e: number }> | null = null;

  // Forward-only resume (continuous series only, and only when resume=true):
  // start from the most recent timestamp already stored, not from the requested
  // window's start. A cron tick every few minutes must not re-page the whole day
  // every time — it only needs what landed since the last successful run. Falls
  // back to the requested start when the table is empty (cold start).
  // resume=false skips this entirely: a backfill of PAST days must honour the
  // requested window, or the watermark (now in the future relative to the
  // target) would clamp the start forward and fetch nothing.
  if (cfg.kind === "continuous" && resume) {
    const { data: last, error } = await client
      .schema("wearable")
      .from(TABLE[series])
      .select("timestamp_utc")
      .order("timestamp_utc", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`ler watermark de ${TABLE[series]} falhou: ${error.message}`);
    if (last?.timestamp_utc) {
      const watermarkMs = Date.parse(last.timestamp_utc) + 1; // +1ms: never refetch the last stored point
      if (watermarkMs > fetchStartMs) fetchStartMs = watermarkMs;
    }
  }

  if (cfg.kind === "sleep") {
    // Nights whose sleep interval overlaps the range (sleep must already be ingested).
    const { data: sleeps, error } = await client
      .schema("wearable")
      .from("sleep")
      .select("start_utc,end_utc")
      .lt("start_utc", new Date(rangeEndMs).toISOString())
      .gt("end_utc", new Date(rangeStartMs).toISOString());
    if (error) throw new Error(`ler wearable.sleep falhou: ${error.message}`);

    intervals = (sleeps ?? []).map((r: { start_utc: string; end_utc: string }) => ({
      s: Date.parse(r.start_utc),
      e: Date.parse(r.end_utc),
    }));

    if (!intervals.length) {
      return {
        series, kind: cfg.kind, points_fetched: 0, rows_ready: 0, rows_written: 0,
        pages: 0, capped: false, timed_out: false, oldest_reached: null,
        note: "sem noites de sono no intervalo — ingerir sleep primeiro (ingest-wearable)",
      };
    }

    // Fetch exactly the span the nights cover — the night, not the UTC day.
    fetchStartMs = Math.min(...intervals.map((i) => i.s));
    fetchEndMs = Math.max(...intervals.map((i) => i.e));
  }

  const { points, pagesFetched, capped, timedOut, oldestReached } = await fetchRange(accessToken, cfg, fetchStartMs, fetchEndMs);

  let usable = points;
  if (intervals) {
    usable = points.filter((p) => {
      const ms = Date.parse(p.time);
      return intervals!.some((iv) => ms >= iv.s && ms <= iv.e);
    });
  }

  const rows = usable.filter((p) => p.value !== null).map((p) => toRow(series, p));

  // Reconciliation: rows already stored for this window, before we write.
  const storedBefore = await countStored(client, TABLE[series], fetchStartMs, fetchEndMs);

  let written = 0;
  if (!dryRun && rows.length) {
    for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
      const chunk = rows.slice(i, i + UPSERT_CHUNK);
      const { error } = await client
        .schema("wearable")
        .from(TABLE[series])
        .upsert(chunk, { onConflict: "timestamp_utc,source" });
      if (error) throw new Error(`upsert ${TABLE[series]} falhou: ${error.message}`);
    }
    written = rows.length;
  }

  // Re-count only if we actually wrote; otherwise after == before.
  const storedAfter = (!dryRun && written) ? await countStored(client, TABLE[series], fetchStartMs, fetchEndMs) : storedBefore;
  const added = (storedBefore != null && storedAfter != null) ? storedAfter - storedBefore : null;

  const note = (capped || timedOut)
    ? `parcial (${timedOut ? "time budget" : "page cap"}) — só chegou a ${oldestReached}; re-correr com janela menor para completar (upsert é idempotente)`
    : undefined;

  return {
    series,
    kind: cfg.kind,
    points_fetched: points.length,
    rows_ready: rows.length,
    rows_written: written,
    pages: pagesFetched,
    capped,
    timed_out: timedOut,
    oldest_reached: oldestReached,
    stored_before: storedBefore,
    stored_after: storedAfter,
    added,
    ...(note ? { note } : {}),
    ...(dryRun ? { sample: rows.slice(0, 3) } : {}),
  };
}
