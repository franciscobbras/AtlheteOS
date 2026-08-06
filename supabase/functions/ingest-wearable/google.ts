// Google OAuth + Google Health API (v4) access.
//
// This module is the ONLY place that talks to Google. It does two things:
//   1. Trade a refresh token for a short-lived access token (with rotation).
//   2. Pull raw dataPoints per dataType for a given date.
//
// It computes nothing. dataPoints are returned verbatim so the caller can store
// them in `raw`. The extraction helpers pull the handful of fields we surface as
// typed columns — those field paths are the one part still to confirm against
// real payloads during phase-1 manual runs.
//
// API: GET https://health.googleapis.com/v4/users/me/dataTypes/{dataType}/dataPoints
//      dataType in kebab-case. Paginated via nextPageToken. ~15 min batch latency.

export interface GoogleSecrets {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export interface AccessToken {
  accessToken: string;
  // Present only when Google rotates the refresh token on this refresh.
  rotatedRefreshToken: string | null;
}

// Thrown when the refresh token is dead (revoked / expired / consent removed).
// The handler maps this to a clear, non-silent re-auth error.
export class ReauthRequiredError extends Error {
  constructor(detail: string) {
    super(`re-auth necessária: ${detail}`);
    this.name = "ReauthRequiredError";
  }
}

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

export const SCOPES = [
  "https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly",
  "https://www.googleapis.com/auth/googlehealth.sleep.readonly",
];

// ── Google Health API v4 ─────────────────────────────────────────────────────
const HEALTH_API_BASE = "https://health.googleapis.com/v4";

// kebab-case dataTypes.
export const DATA_TYPE = {
  hrv: "daily-heart-rate-variability",
  restingHr: "daily-resting-heart-rate",
  temp: "daily-sleep-temperature-derivations",
  sleep: "sleep",
} as const;

const MAX_PAGES = 20; // runaway guard for pagination

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
    // invalid_grant == the refresh token is no longer usable → re-auth.
    if (json?.error === "invalid_grant") {
      throw new ReauthRequiredError(json?.error_description ?? "invalid_grant");
    }
    throw new Error(
      `token refresh failed (${res.status}): ${json?.error ?? "unknown"} ${json?.error_description ?? ""}`.trim(),
    );
  }

  return {
    accessToken: json.access_token as string,
    rotatedRefreshToken: (json.refresh_token as string | undefined) ?? null,
  };
}

// ── Raw fetch ────────────────────────────────────────────────────────────────
async function getJson(url: string, accessToken: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 401 || res.status === 403) {
    throw new ReauthRequiredError(`Health API returned ${res.status}`);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Health API GET ${url} failed (${res.status}): ${text.slice(0, 300)}`);
  }
  return res.json();
}

// Fetch every dataPoint for a dataType, following nextPageToken.
// deno-lint-ignore no-explicit-any
async function fetchAllDataPoints(accessToken: string, dataType: string): Promise<any[]> {
  // deno-lint-ignore no-explicit-any
  const points: any[] = [];
  let pageToken: string | null = null;
  let pages = 0;

  do {
    const url = new URL(`${HEALTH_API_BASE}/users/me/dataTypes/${dataType}/dataPoints`);
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    // deno-lint-ignore no-explicit-any
    const json: any = await getJson(url.toString(), accessToken);
    if (Array.isArray(json?.dataPoints)) points.push(...json.dataPoints);
    pageToken = (json?.nextPageToken as string | undefined) ?? null;
    pages++;
  } while (pageToken && pages < MAX_PAGES);

  return points;
}

// deno-lint-ignore no-explicit-any
export function fetchDataPointsRaw(accessToken: string, dataType: string): Promise<any[]> {
  return fetchAllDataPoints(accessToken, dataType);
}

// ── Extraction (raw dataPoint → the fields we surface as columns) ─────────────
// v4 DataPoint shape: { name, dataSource, <typeFieldCamelCase>: {...} }. No `value`
// wrapper. int64 fields (beatsPerMinute, minutesAsleep…) arrive as STRINGS. Durations
// (startUtcOffset) come as "3600s". The matched dataPoint is always stored in `raw`,
// so a wrong path loses a typed value but never data.

// JSON number OR int64-as-string → number.
function toNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

// Google Duration ("3600s", "-1800s", "3600.5s") → integer seconds.
function durationToSeconds(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const m = v.match(/^(-?\d+(?:\.\d+)?)s$/);
  return m ? Math.round(parseFloat(m[1])) : null;
}

// Dotted-path getter.
// deno-lint-ignore no-explicit-any
function get(obj: any, path: string): unknown {
  let cur = obj;
  for (const key of path.split(".")) {
    cur = cur?.[key];
    if (cur === undefined || cur === null) return undefined;
  }
  return cur;
}

interface DailyCfg {
  typeField: string;   // camelCase field holding the metric object
  valuePaths: string[]; // candidate paths within that object
}

const DAILY: Record<string, DailyCfg> = {
  [DATA_TYPE.hrv]: {
    typeField: "dailyHeartRateVariability",
    valuePaths: ["averageHeartRateVariabilityMilliseconds"],
  },
  [DATA_TYPE.restingHr]: {
    typeField: "dailyRestingHeartRate",
    valuePaths: ["beatsPerMinute"],
  },
  // Temperature is NOT here — it yields 3 raw components (see extractTempPoint).
};

// Normalise a date candidate to YYYY-MM-DD. Daily points carry a structured
// { year, month, day } object (NOT an ISO string); intervals carry ISO strings.
// deno-lint-ignore no-explicit-any
function ymd(v: any): string | null {
  if (typeof v === "string" && v.length >= 10) return v.slice(0, 10);
  if (v && typeof v === "object" &&
    typeof v.year === "number" && typeof v.month === "number" && typeof v.day === "number") {
    return `${v.year}-${String(v.month).padStart(2, "0")}-${String(v.day).padStart(2, "0")}`;
  }
  return null;
}

// The calendar day a daily point belongs to (Fitbit labels it with the wake day).
// deno-lint-ignore no-explicit-any
function dailyDate(p: any, typeField: string): string | null {
  const t = p?.[typeField] ?? {};
  const cands = [
    t?.date, t?.interval?.startTime, t?.startTime,
    p?.date, p?.interval?.startTime, p?.startTime,
    t?.interval?.endTime, p?.interval?.endTime,
  ];
  for (const c of cands) {
    const d = ymd(c);
    if (d) return d;
  }
  return null;
}

export interface DailyExtract {
  value: number;
  raw: unknown; // the matched dataPoint
}

// deno-lint-ignore no-explicit-any
export function extractDailyPoint(dataType: string, dataPoints: any[], date: string): DailyExtract | null {
  const cfg = DAILY[dataType];
  if (!cfg) return null;

  const point = dataPoints.find((p) => dailyDate(p, cfg.typeField) === date);
  if (!point) return null;

  const t = point[cfg.typeField];
  let value: number | null = null;
  for (const vp of cfg.valuePaths) {
    value = toNum(get(t, vp));
    if (value !== null) break;
  }
  if (value === null) return null;
  return { value, raw: point };
}

// Temperature is stored as three RAW components (no deviation computed here — that
// lives in metrics.ts). Any component absent from the payload is left out; the
// others still ingest. raw is the matched point (carries all three regardless).
export interface ExtractedTemp {
  nightly: number | null;
  baseline: number | null;
  stddev30d: number | null;
  raw: unknown;
}

// deno-lint-ignore no-explicit-any
export function extractTempPoint(dataPoints: any[], date: string): ExtractedTemp | null {
  const typeField = "dailySleepTemperatureDerivations";
  const point = dataPoints.find((p) => dailyDate(p, typeField) === date);
  if (!point) return null;

  const t = point[typeField] ?? {};
  return {
    nightly: toNum(t?.nightlyTemperatureCelsius),
    baseline: toNum(t?.baselineTemperatureCelsius),
    stddev30d: toNum(t?.relativeNightlyStddev30dCelsius),
    raw: point,
  };
}

export interface ExtractedSleep {
  startUtc: string;
  endUtc: string;
  utcOffsetSeconds: number | null;
  stages: unknown;
  summary: unknown;
  raw: unknown; // the matched dataPoint
}

// Sleep for `date` = the night whose END (wake) falls on `date`.
// Structure: sleep.interval {startTime,endTime,startUtcOffset}, sleep.stages, sleep.summary.
// deno-lint-ignore no-explicit-any
export function extractSleepPoint(dataPoints: any[], date: string): ExtractedSleep | null {
  // deno-lint-ignore no-explicit-any
  const endOn = (p: any) => {
    const e = p?.sleep?.interval?.endTime ?? p?.sleep?.endTime;
    return typeof e === "string" && e.slice(0, 10) === date;
  };
  // deno-lint-ignore no-explicit-any
  const startOn = (p: any) => {
    const s = p?.sleep?.interval?.startTime ?? p?.sleep?.startTime;
    return typeof s === "string" && s.slice(0, 10) === date;
  };

  const point = dataPoints.find(endOn) ?? dataPoints.find(startOn);
  if (!point) return null;

  const s = point.sleep ?? {};
  const start = s?.interval?.startTime ?? s?.startTime ?? null;
  const end = s?.interval?.endTime ?? s?.endTime ?? null;
  if (!start || !end) return null;

  return {
    startUtc: start,
    endUtc: end,
    utcOffsetSeconds: durationToSeconds(
      s?.interval?.startUtcOffset ?? s?.startUtcOffset ?? point?.startUtcOffset,
    ),
    stages: s?.stages ?? null,
    summary: s?.summary ?? null,
    raw: point,
  };
}
