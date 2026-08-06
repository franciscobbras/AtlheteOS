// Google OAuth + Google Health API (v4) — intraday time series.
//
// Three series, each a paginated stream of dataPoints (newest-first, no server-side
// date filter). We compute nothing: values are stored raw. The "night" for the
// sleep-only series is applied by the caller via the sleep interval, never here.
//
//   hr   → heart-rate             (24/7, continuous)      → bpm
//   hrv  → heart-rate-variability (sleep only)            → rmssd_ms
//   spo2 → oxygen-saturation      (sleep only, confirmed) → percentage

export interface GoogleSecrets {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export interface AccessToken {
  accessToken: string;
  rotatedRefreshToken: string | null;
}

export class ReauthRequiredError extends Error {
  constructor(detail: string) {
    super(`re-auth necessária: ${detail}`);
    this.name = "ReauthRequiredError";
  }
}

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const HEALTH_API_BASE = "https://health.googleapis.com/v4";
const MAX_PAGES = 800; // ~40k points; HR backfill over many days may need chunking

export type SeriesKey = "hr" | "hrv" | "spo2";

export interface SeriesCfg {
  dataType: string;   // kebab-case dataType in the URL
  obj: string;        // camelCase wrapper object on each dataPoint
  valueKey: string;   // numeric field within obj
  kind: "continuous" | "sleep";
}

export const SERIES: Record<SeriesKey, SeriesCfg> = {
  hr: {
    dataType: "heart-rate",
    obj: "heartRate",
    valueKey: "beatsPerMinute", // string int64
    kind: "continuous",
  },
  hrv: {
    dataType: "heart-rate-variability",
    obj: "heartRateVariability",
    valueKey: "rootMeanSquareOfSuccessiveDifferencesMilliseconds",
    kind: "sleep",
  },
  spo2: {
    dataType: "oxygen-saturation",
    obj: "oxygenSaturation",
    valueKey: "percentage",
    kind: "sleep",
  },
};

// ── OAuth: refresh token → access token ──────────────────────────────────────
export async function exchangeRefreshToken(secrets: GoogleSecrets): Promise<AccessToken> {
  const body = new URLSearchParams({
    client_id: secrets.clientId,
    client_secret: secrets.clientSecret,
    refresh_token: secrets.refreshToken,
    grant_type: "refresh_token",
  });

  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = await res.json().catch(() => ({}));

  if (!res.ok) {
    if (json?.error === "invalid_grant") {
      throw new ReauthRequiredError(json?.error_description ?? "invalid_grant");
    }
    throw new Error(`token refresh failed (${res.status}): ${json?.error ?? "unknown"}`);
  }

  return {
    accessToken: json.access_token as string,
    rotatedRefreshToken: (json.refresh_token as string | undefined) ?? null,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function durationToSeconds(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const m = v.match(/^(-?\d+(?:\.\d+)?)s$/);
  return m ? Math.round(parseFloat(m[1])) : null;
}
function toNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

const MAX_RETRIES = 5;
const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// GET with exponential backoff on transient errors (and network failures) —
// essential for deep pagination where a stray 503 must not abort the whole run.
async function getJson(url: string, accessToken: string): Promise<unknown> {
  let lastErr = "";
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) await sleep(Math.min(500 * 2 ** (attempt - 1), 8000));

    let res: Response;
    try {
      res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    } catch (e) {
      lastErr = `network: ${e instanceof Error ? e.message : String(e)}`;
      continue; // retry network failures
    }

    if (res.status === 401 || res.status === 403) {
      throw new ReauthRequiredError(`Health API returned ${res.status}`);
    }
    if (res.ok) return res.json();

    const text = await res.text().catch(() => "");
    lastErr = `${res.status}: ${text.slice(0, 200)}`;
    if (!RETRYABLE.has(res.status)) {
      throw new Error(`Health API GET failed (${lastErr})`);
    }
    // retryable → loop
  }
  throw new Error(`Health API GET failed after ${MAX_RETRIES} retries (${lastErr})`);
}

export interface RawPoint {
  time: string;                 // physicalTime ISO (→ timestamp_utc)
  offsetSeconds: number | null; // from utcOffset Duration (per point)
  value: number | null;
  recordingMethod: string | null;
}

export interface FetchResult {
  points: RawPoint[];
  pagesFetched: number;
  capped: boolean;      // hit MAX_PAGES
  timedOut: boolean;    // hit the wall-clock budget
  oldestReached: string | null; // oldest physicalTime seen (how deep we got)
}

// Stop paginating before the Edge Function wall-clock limit so a long/degraded run
// returns partial results + a flag instead of an empty timeout. Partial writes are
// idempotent, so the caller just re-runs / chunks to finish.
const BUDGET_MS = 110_000;

// Paginate newest-first, collecting points whose physicalTime ∈ [startMs, endMs].
// Stops when: a page's oldest point predates the window, the token runs out, the
// page cap is hit (capped), or the time budget is exceeded (timedOut).
export async function fetchRange(
  accessToken: string,
  cfg: SeriesCfg,
  startMs: number,
  endMs: number,
): Promise<FetchResult> {
  const points: RawPoint[] = [];
  let pageToken: string | null = null;
  let pages = 0;
  let capped = false;
  let timedOut = false;
  let oldestReachedMs = Infinity;
  const t0 = Date.now();

  while (true) {
    const url = new URL(`${HEALTH_API_BASE}/users/me/dataTypes/${cfg.dataType}/dataPoints`);
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    // deno-lint-ignore no-explicit-any
    const json: any = await getJson(url.toString(), accessToken);
    const dps: unknown[] = Array.isArray(json?.dataPoints) ? json.dataPoints : [];

    let oldestMs = Infinity;
    for (const dp of dps) {
      // deno-lint-ignore no-explicit-any
      const o = (dp as any)?.[cfg.obj];
      const t = o?.sampleTime?.physicalTime;
      if (typeof t !== "string") continue;
      const ms = Date.parse(t);
      if (ms < oldestMs) oldestMs = ms;
      if (ms >= startMs && ms <= endMs) {
        points.push({
          time: t,
          offsetSeconds: durationToSeconds(o?.sampleTime?.utcOffset),
          value: toNum(o?.[cfg.valueKey]),
          // deno-lint-ignore no-explicit-any
          recordingMethod: (dp as any)?.dataSource?.recordingMethod ?? null,
        });
      }
    }
    if (dps.length) oldestReachedMs = Math.min(oldestReachedMs, oldestMs);

    pages++;
    pageToken = (json?.nextPageToken as string | undefined) ?? null;

    if (dps.length && oldestMs < startMs) break; // paged past the window
    if (!pageToken) break;
    if (pages >= MAX_PAGES) { capped = true; break; }
    if (Date.now() - t0 > BUDGET_MS) { timedOut = true; break; }
  }

  return {
    points,
    pagesFetched: pages,
    capped,
    timedOut,
    oldestReached: Number.isFinite(oldestReachedMs) ? new Date(oldestReachedMs).toISOString() : null,
  };
}
