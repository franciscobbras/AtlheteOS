// Pure ingestion logic — no HTTP, no Vault reads, no env access.
//
// It receives the date, the already-resolved secrets, and a service_role
// Supabase client. It refreshes the Google token, pulls raw dataPoints per
// dataType, and upserts them into wearable.* idempotently. It returns a summary
// plus any rotated refresh token (the handler owns persisting that back to the
// Vault), which keeps this function testable in isolation.

import {
  exchangeRefreshToken,
  fetchDataPointsRaw,
  extractDailyPoint,
  extractTempPoint,
  extractSleepPoint,
  DATA_TYPE,
  type GoogleSecrets,
} from "./google.ts";

// deno-lint-ignore no-explicit-any
type Client = any;

const SOURCE = "fitbit_air";

export interface IngestResult {
  date: string;
  dryRun: boolean;
  dailyMetrics: {
    daily_hrv_rmssd: boolean;
    resting_hr: boolean;
    temp_nightly: boolean;
    temp_baseline: boolean;
    temp_stddev_30d: boolean;
  };
  sleep: boolean;
  rotatedRefreshToken: string | null;
  // Present only on dryRun: exactly what WOULD be written, with the matched raw
  // dataPoints so field mappings can be confirmed before any write. `debug` shows
  // the true shape fetched per dataType even when NOTHING matched (counts + first
  // raw point), so date/value paths can be fixed blind-spot-free.
  preview?: {
    daily_metrics: Array<{ metric_type: string; value: number; unit: string; raw: unknown }>;
    sleep: SleepRow | null;
    debug: {
      counts: { hrv: number; resting_hr: number; temp: number; sleep: number };
      samples: { hrv: unknown; resting_hr: unknown; temp: unknown; sleep: unknown };
    };
  };
}

interface SleepRow {
  start_utc: string;
  end_utc: string;
  utc_offset_seconds: number;
  source: string;
  stages: unknown;
  summary: unknown;
  raw: unknown;
}

interface DailyRow {
  date: string;
  metric_type: string;
  value: number;
  unit: string;
  source: string;
  raw: unknown;
  computed_at_utc: string;
}

export async function ingest(
  date: string,
  secrets: GoogleSecrets,
  client: Client,
  dryRun = false,
): Promise<IngestResult> {
  const nowUtc = new Date().toISOString();

  // 1. Token — refresh token → access token (may rotate the refresh token).
  const token = await exchangeRefreshToken(secrets);

  // 2. Pull raw dataPoints — one dataType per daily metric, plus sleep.
  const [hrvPts, rhrPts, tempPts, sleepPts] = await Promise.all([
    fetchDataPointsRaw(token.accessToken, DATA_TYPE.hrv),
    fetchDataPointsRaw(token.accessToken, DATA_TYPE.restingHr),
    fetchDataPointsRaw(token.accessToken, DATA_TYPE.temp),
    fetchDataPointsRaw(token.accessToken, DATA_TYPE.sleep),
  ]);

  // 3a. Daily metrics → one row per metric_type. Raw values only, raw = matched point.
  const hrv = extractDailyPoint(DATA_TYPE.hrv, hrvPts, date);
  const rhr = extractDailyPoint(DATA_TYPE.restingHr, rhrPts, date);
  // Temperature → 3 raw components; write only the ones present, no nulls.
  const temp = extractTempPoint(tempPts, date);

  const rows: DailyRow[] = [];
  if (hrv) {
    rows.push({ date, metric_type: "daily_hrv_rmssd", value: hrv.value, unit: "ms", source: SOURCE, raw: hrv.raw, computed_at_utc: nowUtc });
  }
  if (rhr) {
    rows.push({ date, metric_type: "resting_hr", value: rhr.value, unit: "bpm", source: SOURCE, raw: rhr.raw, computed_at_utc: nowUtc });
  }
  if (temp) {
    if (temp.nightly != null) {
      rows.push({ date, metric_type: "temp_nightly", value: temp.nightly, unit: "celsius", source: SOURCE, raw: temp.raw, computed_at_utc: nowUtc });
    }
    if (temp.baseline != null) {
      rows.push({ date, metric_type: "temp_baseline", value: temp.baseline, unit: "celsius", source: SOURCE, raw: temp.raw, computed_at_utc: nowUtc });
    }
    if (temp.stddev30d != null) {
      rows.push({ date, metric_type: "temp_stddev_30d", value: temp.stddev30d, unit: "celsius", source: SOURCE, raw: temp.raw, computed_at_utc: nowUtc });
    }
  }

  // 3b. Sleep → one row keyed on (start_utc, source).
  const sleep = extractSleepPoint(sleepPts, date);
  const sleepRow: SleepRow | null = sleep
    ? {
      start_utc: sleep.startUtc,
      end_utc: sleep.endUtc,
      utc_offset_seconds: sleep.utcOffsetSeconds ?? 0, // column is NOT NULL; raw preserves truth
      source: SOURCE,
      stages: sleep.stages,
      summary: sleep.summary,
      raw: sleep.raw,
    }
    : null;

  // 4. Write — unless dryRun, which returns a preview of exactly this instead.
  if (!dryRun) {
    if (rows.length) {
      const { error } = await client
        .schema("wearable")
        .from("daily_metrics")
        .upsert(rows, { onConflict: "date,metric_type,source" });
      if (error) throw new Error(`upsert daily_metrics falhou: ${error.message}`);
    }
    if (sleepRow) {
      const { error } = await client
        .schema("wearable")
        .from("sleep")
        .upsert(sleepRow, { onConflict: "start_utc,source" });
      if (error) throw new Error(`upsert sleep falhou: ${error.message}`);
    }
  }

  return {
    date,
    dryRun,
    dailyMetrics: {
      daily_hrv_rmssd: hrv !== null,
      resting_hr: rhr !== null,
      temp_nightly: temp?.nightly != null,
      temp_baseline: temp?.baseline != null,
      temp_stddev_30d: temp?.stddev30d != null,
    },
    sleep: sleepRow !== null,
    rotatedRefreshToken: token.rotatedRefreshToken,
    ...(dryRun
      ? {
        preview: {
          daily_metrics: rows.map((r) => ({ metric_type: r.metric_type, value: r.value, unit: r.unit, raw: r.raw })),
          sleep: sleepRow,
          debug: {
            counts: {
              hrv: hrvPts.length,
              resting_hr: rhrPts.length,
              temp: tempPts.length,
              sleep: sleepPts.length,
            },
            samples: {
              hrv: hrvPts[0] ?? null,
              resting_hr: rhrPts[0] ?? null,
              temp: tempPts[0] ?? null,
              sleep: sleepPts[0] ?? null,
            },
          },
        },
      }
      : {}),
  };
}
