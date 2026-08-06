'use client';

/**
 * wearable_raw — internal raw-data inspection tool (no design, functional).
 *
 * Reads wearable.* directly via supabase-js (authenticated role, SELECT), raw values
 * untouched. Three sections:
 *   1. Agregados diários (wearable.daily_metrics, pivoted per day)
 *   2. Sono (wearable.sleep)
 *   3. interday (wearable.intraday_day_index → hr/hrv/spo2 per UTC day; double-click a
 *      day to open its raw points from heart_rate / hrv_instant / spo2)
 *
 * Only read-time derivations are duration, local time (UTC+offset) and sleep efficiency
 * — metric values are never transformed.
 */

import { Fragment, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

// ── Types ─────────────────────────────────────────────────────────────────────

type DailyRow = { date: string; metric_type: string; value: number; unit: string | null; source: string };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SleepRow = { start_utc: string; end_utc: string; utc_offset_seconds: number; summary: any; stages: any; source: string };
type ScoreRow = { date: string; score: number | null; confidence: number | null };
type DayIndexRow = { day: string; hr: number; hrv: number; spo2: number };
type IntradayPoint = { timestamp_utc: string; utc_offset_seconds: number; value: number };

// ── Date helpers (UTC-anchored to avoid DST drift) ─────────────────────────────

function parseYMD(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
function toYMD(dt: Date): string {
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}
function addDays(dt: Date, n: number): Date {
  const c = new Date(dt);
  c.setUTCDate(c.getUTCDate() + n);
  return c;
}
function todayYMD(): string {
  return toYMD(new Date());
}

// Local wall-clock = UTC instant shifted by offset, then read as UTC components.
function shifted(utcIso: string, offsetSeconds: number): Date {
  return new Date(new Date(utcIso).getTime() + offsetSeconds * 1000);
}
function localDate(utcIso: string, offsetSeconds: number): string {
  return toYMD(shifted(utcIso, offsetSeconds));
}
function localHHMM(utcIso: string, offsetSeconds: number): string {
  const d = shifted(utcIso, offsetSeconds);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}
function localHHMMSS(utcIso: string, offsetSeconds: number): string {
  const d = shifted(utcIso, offsetSeconds);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}:${String(d.getUTCSeconds()).padStart(2, '0')}`;
}
function durationMin(startIso: string, endIso: string): number {
  return Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000);
}
function fmtHhMm(min: number): string {
  return `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m`;
}

// ── Sleep summary readers (raw fields; strings → numbers) ──────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function stageMinutes(summary: any, type: string): number | null {
  const arr = summary?.stagesSummary;
  if (!Array.isArray(arr)) return null;
  const s = arr.find((x) => x?.type === type);
  const n = s ? Number(s.minutes) : NaN;
  return Number.isFinite(n) ? n : null;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function efficiencyPct(summary: any): number | null {
  if (summary?.efficiency != null && Number.isFinite(Number(summary.efficiency))) return Number(summary.efficiency);
  if (summary?.sleepEfficiency != null && Number.isFinite(Number(summary.sleepEfficiency))) return Number(summary.sleepEfficiency);
  const asleep = Number(summary?.minutesAsleep);
  const period = Number(summary?.minutesInSleepPeriod);
  if (Number.isFinite(asleep) && Number.isFinite(period) && period > 0) {
    return Math.round((asleep / period) * 1000) / 10; // derived
  }
  return null;
}

// ── Metric column ordering + labels ────────────────────────────────────────────

const METRIC_ORDER = ['daily_hrv_rmssd', 'resting_hr', 'temp_nightly', 'temp_baseline', 'temp_stddev_30d'];
const METRIC_LABEL: Record<string, string> = {
  daily_hrv_rmssd: 'HRV (RMSSD, ms)',
  resting_hr: 'RHR (bpm)',
  temp_nightly: 'Temp nightly (°C)',
  temp_baseline: 'Temp baseline (°C)',
  temp_stddev_30d: 'Temp σ 30d (°C)',
};

// ── Styles (minimal, functional) ───────────────────────────────────────────────

const NUM: React.CSSProperties = { textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };
// Sleep score 0–100 → cor (mesmos limiares do gauge de wellbeing).
function scoreColor100(v: number): string {
  return v >= 67 ? '#22C55E' : v >= 34 ? '#F59E0B' : '#EF4444';
}
const MISSING_BG = 'rgba(239,68,68,0.10)';
const MUTED: React.CSSProperties = { color: 'var(--muted)' };
const DISPLAY_CAP = 500; // max intraday points rendered per series in the expanded day

// Supabase errors are plain PostgrestError objects (not Error instances).
function errText(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === 'object') {
    const o = e as Record<string, unknown>;
    const parts = [o.message, o.details, o.hint, o.code].filter(Boolean).map(String);
    if (parts.length) return parts.join(' · ');
    try { return JSON.stringify(e); } catch { return String(e); }
  }
  return String(e);
}

// ── Component ───────────────────────────────────────────────────────────────────

export default function WearableRawInspector() {
  const [daily, setDaily] = useState<DailyRow[] | null>(null);
  const [sleep, setSleep] = useState<SleepRow[] | null>(null);
  const [scores, setScores] = useState<Map<string, ScoreRow>>(new Map());
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [d, s, sc] = await Promise.all([
          supabase.schema('wearable').from('daily_metrics')
            .select('date, metric_type, value, unit, source')
            .order('date', { ascending: false }),
          supabase.schema('wearable').from('sleep')
            .select('start_utc, end_utc, utc_offset_seconds, summary, stages, source')
            .order('start_utc', { ascending: false }),
          supabase.schema('metrics').from('daily_scores')
            .select('date, score, confidence')
            .eq('metric_type', 'sleep_score'),
        ]);
        if (d.error) throw d.error;
        if (s.error) throw s.error;
        setDaily((d.data as DailyRow[]) ?? []);
        setSleep((s.data as SleepRow[]) ?? []);
        // Derived layer is best-effort: a failure here must not blank the raw
        // inspector. Keyed by wake-day (daily_scores.date == the sleep wake day).
        if (!sc.error && sc.data) {
          setScores(new Map((sc.data as ScoreRow[]).map((r) => [r.date, r])));
        }
      } catch (e) {
        setErr(errText(e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div className="card">
      <p className="section-label" style={{ fontFamily: 'monospace' }}>wearable_raw</p>
      <p style={{ margin: '0 0 14px', fontSize: 12, ...MUTED }}>
        Inspeção de dados brutos — <code>wearable.daily_metrics</code> · <code>wearable.sleep</code> · séries intraday (<code>heart_rate</code> / <code>hrv_instant</code> / <code>spo2</code>). Valores crus, sem transformação.
      </p>

      {loading && <p style={MUTED}>A carregar…</p>}
      {err && <p className="message message-error" style={{ fontSize: 13 }}>{err}</p>}

      {!loading && !err && daily && sleep && (
        <>
          <Inspector daily={daily} sleep={sleep} scores={scores} />
          <InterdaySection />
        </>
      )}
    </div>
  );
}

function Inspector({ daily, sleep, scores }: { daily: DailyRow[]; sleep: SleepRow[]; scores: Map<string, ScoreRow> }) {
  const [openNight, setOpenNight] = useState<string | null>(null);

  // Pivot daily by date.
  const byDate = new Map<string, Map<string, DailyRow>>();
  const srcByDate = new Map<string, Set<string>>();
  for (const r of daily) {
    if (!byDate.has(r.date)) byDate.set(r.date, new Map());
    byDate.get(r.date)!.set(r.metric_type, r);
    if (!srcByDate.has(r.date)) srcByDate.set(r.date, new Set());
    srcByDate.get(r.date)!.add(r.source);
  }

  // Sleep keyed by the WAKE day (local date of end) — nights crossing midnight
  // stay on the wake day; longest session wins per day (main sleep beats a nap).
  const sleepByNight = new Map<string, SleepRow>();
  for (const r of sleep) {
    const night = localDate(r.end_utc, r.utc_offset_seconds);
    const cur = sleepByNight.get(night);
    if (!cur || durationMin(r.start_utc, r.end_utc) > durationMin(cur.start_utc, cur.end_utc)) {
      sleepByNight.set(night, r);
    }
  }

  const dailyDates = new Set(byDate.keys());

  const present = [...new Set(daily.map((r) => r.metric_type))];
  const cols = [
    ...METRIC_ORDER.filter((m) => present.includes(m)),
    ...present.filter((m) => !METRIC_ORDER.includes(m)).sort(),
  ];

  // Date range: from the first-ever data day up to today, so every hole WITHIN
  // the tracked period shows. Days before the first data are NOT rendered —
  // tracking hadn't begun, so they aren't "missing", just outside the record.
  const allDates = [...dailyDates, ...sleepByNight.keys()];
  const today = todayYMD();
  const maxData = allDates.length ? allDates.reduce((a, b) => (a > b ? a : b)) : today;
  const minData = allDates.length ? allDates.reduce((a, b) => (a < b ? a : b)) : today;
  const end = maxData > today ? maxData : today;
  const start = minData;

  const seq: string[] = [];
  for (let d = parseYMD(end); toYMD(d) >= start; d = addDays(d, -1)) seq.push(toYMD(d));

  // "Missing in the last 30 days" counts only days at/after tracking began —
  // pre-start days never count as missing.
  const last30: string[] = [];
  for (let i = 0; i < 30; i++) {
    const dt = toYMD(addDays(parseYMD(today), -i));
    if (dt >= minData) last30.push(dt);
  }
  const withDaily30 = last30.filter((dt) => dailyDates.has(dt)).length;
  const missing30 = last30.length - withDaily30;

  let span = 0;
  for (let d = parseYMD(minData); toYMD(d) <= maxData; d = addDays(d, 1)) span++;
  const holesInSpan = allDates.length ? span - dailyDates.size : 0;

  return (
    <>
      {/* Count indicator */}
      <div className="inner-card" style={{ marginBottom: 16, fontSize: 12.5, lineHeight: 1.7 }}>
        <strong style={{ color: 'var(--text)' }}>{dailyDates.size}</strong> dias com dados ·{' '}
        <strong style={{ color: missing30 > 0 ? '#F59E0B' : '#22C55E' }}>{missing30}</strong> em falta nos últimos 30 dias ·{' '}
        <strong style={{ color: holesInSpan > 0 ? '#EF4444' : '#22C55E' }}>{holesInSpan}</strong> buracos dentro do intervalo{' '}
        {allDates.length ? <span style={MUTED}>({minData} → {maxData})</span> : null}
        <br />
        <span style={{ fontSize: 11, ...MUTED }}>{sleepByNight.size} noites de sono · linhas a vermelho = dia sem dados</span>
      </div>

      {/* ── Secção 1: Agregados diários ─────────────────────────────────────── */}
      <p className="section-label" style={{ marginTop: 4 }}>Secção 1 — Agregados diários</p>
      <div className="table-wrap" style={{ marginBottom: 22 }}>
        <table className="table">
          <thead>
            <tr>
              <th>Data</th>
              {cols.map((m) => <th key={m} style={{ textAlign: 'right' }}>{METRIC_LABEL[m] ?? m}</th>)}
              <th>Fonte</th>
            </tr>
          </thead>
          <tbody>
            {seq.map((date) => {
              const row = byDate.get(date);
              if (!row) {
                return (
                  <tr key={date} style={{ background: MISSING_BG }}>
                    <td style={{ fontWeight: 600 }}>{date}</td>
                    <td colSpan={cols.length + 1} style={{ ...MUTED, fontStyle: 'italic' }}>— sem dados —</td>
                  </tr>
                );
              }
              const srcs = [...(srcByDate.get(date) ?? [])].join(', ');
              return (
                <tr key={date}>
                  <td style={{ fontWeight: 600, color: 'var(--text)' }}>{date}</td>
                  {cols.map((m) => {
                    const cell = row.get(m);
                    return (
                      <td key={m} style={NUM}>
                        {cell ? cell.value : <span style={MUTED}>—</span>}
                      </td>
                    );
                  })}
                  <td style={MUTED}>{srcs}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── Secção 2: Sono ──────────────────────────────────────────────────── */}
      <p className="section-label">Secção 2 — Sono</p>
      <p style={{ margin: '0 0 10px', fontSize: 11, ...MUTED }}>
        <strong>Clica numa noite</strong> para abrir o hipnograma (arquitetura do sono ao longo da noite).
      </p>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Data (acordar)</th>
              <th>Início</th>
              <th>Fim</th>
              <th style={{ textAlign: 'right' }}>Duração</th>
              <th style={{ textAlign: 'right' }}>Leve</th>
              <th style={{ textAlign: 'right' }}>Profundo</th>
              <th style={{ textAlign: 'right' }}>REM</th>
              <th style={{ textAlign: 'right' }}>Eficiência</th>
              <th style={{ textAlign: 'right' }} title="Sleep score (metrics.daily_scores) 0–100">SS</th>
              <th style={{ textAlign: 'right' }} title="Confiança do sleep score (0–1)">Confiança</th>
              <th>Fonte</th>
            </tr>
          </thead>
          <tbody>
            {seq.map((date) => {
              const r = sleepByNight.get(date);
              if (!r) {
                return (
                  <tr key={date} style={{ background: MISSING_BG }}>
                    <td style={{ fontWeight: 600 }}>{date}</td>
                    <td colSpan={10} style={{ ...MUTED, fontStyle: 'italic' }}>— sem dados —</td>
                  </tr>
                );
              }
              const off = r.utc_offset_seconds;
              const light = stageMinutes(r.summary, 'LIGHT');
              const deep = stageMinutes(r.summary, 'DEEP');
              const rem = stageMinutes(r.summary, 'REM');
              const eff = efficiencyPct(r.summary);
              const sc = scores.get(date);
              const ss = sc && sc.score != null ? Math.round(Number(sc.score)) : null;
              const conf = sc && sc.confidence != null ? Math.round(Number(sc.confidence) * 100) : null;
              const open = openNight === date;
              return (
                <Fragment key={date}>
                  <tr
                    onClick={() => setOpenNight(open ? null : date)}
                    style={{ cursor: 'pointer', background: open ? 'var(--surface-hover)' : undefined }}
                    title="Clica para ver a arquitetura do sono"
                  >
                    <td style={{ fontWeight: 600, color: 'var(--text)' }}>
                      <span style={{ ...MUTED, marginRight: 6 }}>{open ? '▾' : '▸'}</span>{date}
                    </td>
                    <td style={NUM}>{localHHMM(r.start_utc, off)}</td>
                    <td style={NUM}>{localHHMM(r.end_utc, off)}</td>
                    <td style={NUM}>{fmtHhMm(durationMin(r.start_utc, r.end_utc))}</td>
                    <td style={NUM}>{light ?? <span style={MUTED}>—</span>}</td>
                    <td style={NUM}>{deep ?? <span style={MUTED}>—</span>}</td>
                    <td style={NUM}>{rem ?? <span style={MUTED}>—</span>}</td>
                    <td style={NUM}>{eff != null ? `${eff}%` : <span style={MUTED}>—</span>}</td>
                    <td style={{ ...NUM, fontWeight: 700, color: ss != null ? scoreColor100(ss) : undefined }}>
                      {ss != null ? ss : <span style={MUTED}>—</span>}
                    </td>
                    <td style={NUM}>{conf != null ? `${conf}%` : <span style={MUTED}>—</span>}</td>
                    <td style={MUTED}>{r.source}</td>
                  </tr>
                  {open && (
                    <tr>
                      <td colSpan={11} style={{ padding: 0, background: 'var(--surface-hover)' }}>
                        <Hypnogram stages={r.stages} offsetSeconds={off} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <p style={{ margin: '12px 0 0', fontSize: 11, ...MUTED }}>
        Derivados na leitura (não gravados): a noite é atribuída ao <strong>dia de acordar</strong> (<code>end_utc</code> local),
        igual aos <code>daily_metrics</code> — por isso <code>Início</code> pode ser da véspera (deitar depois das 23h);
        duração = fim − início; hora local = UTC + <code>utc_offset_seconds</code>;
        minutos por fase e eficiência lidos de <code>summary</code> (eficiência = minutesAsleep / minutesInSleepPeriod quando não explícita).
      </p>
    </>
  );
}

// ── Hipnograma (arquitetura do sono, linha em degraus) ─────────────────────────

const STAGE_LEVEL: Record<string, number> = { AWAKE: 0, REM: 1, LIGHT: 2, DEEP: 3 };
const STAGE_LABEL_PT: Record<string, string> = { AWAKE: 'Acordado', REM: 'REM', LIGHT: 'Leve', DEEP: 'Profundo' };
const STAGE_COLOR: Record<string, string> = { AWAKE: '#F59E0B', REM: '#8B5CF6', LIGHT: '#3B82F6', DEEP: '#1E40AF' };
const STAGE_ORDER = ['AWAKE', 'REM', 'LIGHT', 'DEEP'];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function Hypnogram({ stages, offsetSeconds }: { stages: any; offsetSeconds: number }) {
  // Raw stage segments → sorted {type, start, end} in UTC ms. Positions use UTC
  // ms deltas (offset-agnostic); axis labels are shifted to local for reading.
  const segs = (Array.isArray(stages) ? stages : [])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((s: any) => s && s.startTime && s.endTime && STAGE_LEVEL[s.type] !== undefined)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((s: any) => ({ type: s.type as string, s: Date.parse(s.startTime), e: Date.parse(s.endTime) }))
    .filter((s) => Number.isFinite(s.s) && Number.isFinite(s.e) && s.e > s.s)
    .sort((a, b) => a.s - b.s);

  if (!segs.length) return <p style={{ ...MUTED, fontSize: 12, margin: 14 }}>— sem arquitetura de sono registada —</p>;

  const t0 = segs[0].s;
  const t1 = segs[segs.length - 1].e;
  const span = Math.max(1, t1 - t0);

  const W = 760, H = 160, padL = 78, padR = 14, padT = 12, padB = 24;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const rowH = plotH / (STAGE_ORDER.length - 1);
  const x = (ms: number) => padL + ((ms - t0) / span) * plotW;
  const y = (type: string) => padT + STAGE_LEVEL[type] * rowH;

  // Stepped polyline: two points per segment (start,end at its level) → the
  // shared x at each boundary draws the vertical transition automatically.
  const pts: string[] = [];
  for (const seg of segs) {
    pts.push(`${x(seg.s).toFixed(1)},${y(seg.type).toFixed(1)}`);
    pts.push(`${x(seg.e).toFixed(1)},${y(seg.type).toFixed(1)}`);
  }

  // Per-stage totals (minutes) + awakenings count.
  const totals: Record<string, number> = {};
  for (const seg of segs) totals[seg.type] = (totals[seg.type] ?? 0) + (seg.e - seg.s) / 60000;
  const awakenings = segs.filter((s) => s.type === 'AWAKE').length;

  // Hourly ticks aligned to LOCAL wall-clock (:00).
  const offMs = offsetSeconds * 1000;
  const ticks: { x: number; label: string }[] = [];
  const firstLocalHour = Math.ceil((t0 + offMs) / 3_600_000) * 3_600_000 - offMs;
  for (let ms = firstLocalHour; ms <= t1; ms += 3_600_000) {
    ticks.push({ x: x(ms), label: localHHMM(new Date(ms).toISOString(), offsetSeconds) });
  }

  return (
    <div style={{ padding: 14 }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: W, display: 'block' }} role="img" aria-label="Hipnograma da noite">
        {STAGE_ORDER.map((t) => (
          <g key={t}>
            <line x1={padL} y1={y(t)} x2={W - padR} y2={y(t)} stroke="var(--border)" strokeWidth={1} strokeDasharray="2 3" />
            <text x={padL - 8} y={y(t) + 3} textAnchor="end" fontSize={10} fill="var(--muted)">{STAGE_LABEL_PT[t]}</text>
          </g>
        ))}
        {ticks.map((tk, i) => (
          <text key={i} x={tk.x} y={H - 7} textAnchor="middle" fontSize={9} fill="var(--muted)">{tk.label}</text>
        ))}
        <polyline points={pts.join(' ')} fill="none" stroke="#6366F1" strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginTop: 8, fontSize: 11 }}>
        {STAGE_ORDER.filter((t) => totals[t]).map((t) => (
          <span key={t} style={MUTED}>
            <span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 2, background: STAGE_COLOR[t], marginRight: 5, verticalAlign: 'middle' }} />
            {STAGE_LABEL_PT[t]}: <strong style={{ color: 'var(--text)' }}>{fmtHhMm(Math.round(totals[t]))}</strong>
          </span>
        ))}
        <span style={MUTED}>Despertares: <strong style={{ color: 'var(--text)' }}>{awakenings}</strong></span>
      </div>
    </div>
  );
}

// ── Secção 3: interday ──────────────────────────────────────────────────────────

function InterdaySection() {
  const [index, setIndex] = useState<DayIndexRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [openDay, setOpenDay] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.schema('wearable')
        .from('intraday_day_index')
        .select('day, hr, hrv, spo2')
        .order('day', { ascending: false });
      if (error) { setErr(errText(error)); return; }
      setIndex((data ?? []).map((r) => ({
        day: r.day as string,
        hr: Number(r.hr), hrv: Number(r.hrv), spo2: Number(r.spo2),
      })));
    })();
  }, []);

  return (
    <div style={{ marginTop: 28 }}>
      <p className="section-label">Secção 3 — interday</p>
      <p style={{ margin: '0 0 10px', fontSize: 11, ...MUTED }}>
        Séries intraday por dia UTC. Cada célula = nº de pontos dessa medida nesse dia. <strong>Clica num dia</strong> para abrir os pontos crus.
      </p>

      {err && <p className="message message-error" style={{ fontSize: 13 }}>{err}</p>}
      {!index && !err && <p style={MUTED}>A carregar…</p>}
      {index && index.length === 0 && <div className="inner-card empty-state" style={{ fontSize: 13 }}>Sem dados intraday ainda.</div>}

      {index && index.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Data (UTC)</th>
                <th style={{ textAlign: 'right' }}>HRV</th>
                <th style={{ textAlign: 'right' }}>SpO2</th>
                <th style={{ textAlign: 'right' }}>HR</th>
                <th>Medidas presentes</th>
              </tr>
            </thead>
            <tbody>
              {index.map((r) => {
                const open = openDay === r.day;
                const present = [
                  r.hrv > 0 ? 'HRV' : null,
                  r.spo2 > 0 ? 'SpO2' : null,
                  r.hr > 0 ? 'HR' : null,
                ].filter(Boolean);
                return (
                  <ReactFragmentRow
                    key={r.day}
                    row={r}
                    open={open}
                    present={present as string[]}
                    onToggle={() => setOpenDay(open ? null : r.day)}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Count({ n }: { n: number }) {
  return n > 0
    ? <span style={{ color: 'var(--text)', fontWeight: 600 }}>{n.toLocaleString()}</span>
    : <span style={MUTED}>—</span>;
}

function ReactFragmentRow({ row, open, present, onToggle }: { row: DayIndexRow; open: boolean; present: string[]; onToggle: () => void }) {
  return (
    <>
      <tr
        onClick={onToggle}
        style={{ cursor: 'pointer', background: open ? 'var(--surface-hover)' : undefined }}
        title="Clica para abrir/fechar"
      >
        <td style={{ fontWeight: 600, color: 'var(--text)' }}>
          <span style={{ ...MUTED, marginRight: 6 }}>{open ? '▾' : '▸'}</span>{row.day}
        </td>
        <td style={NUM}><Count n={row.hrv} /></td>
        <td style={NUM}><Count n={row.spo2} /></td>
        <td style={NUM}><Count n={row.hr} /></td>
        <td style={MUTED}>{present.length ? present.join(' · ') : '—'}</td>
      </tr>
      {open && (
        <tr>
          <td colSpan={5} style={{ padding: 0, background: 'var(--surface-hover)' }}>
            <DayDetail day={row.day} counts={row} />
          </td>
        </tr>
      )}
    </>
  );
}

function DayDetail({ day, counts }: { day: string; counts: DayIndexRow }) {
  const [data, setData] = useState<{ hrv: IntradayPoint[]; spo2: IntradayPoint[]; hr: IntradayPoint[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const start = `${day}T00:00:00Z`;
      const end = `${toYMD(addDays(parseYMD(day), 1))}T00:00:00Z`;
      const q = (table: string, valueCol: string) =>
        supabase.schema('wearable').from(table)
          .select(`timestamp_utc, utc_offset_seconds, ${valueCol}`)
          .gte('timestamp_utc', start).lt('timestamp_utc', end)
          .order('timestamp_utc', { ascending: true })
          .limit(DISPLAY_CAP);
      try {
        const [h, s, r] = await Promise.all([
          q('hrv_instant', 'rmssd_ms'),
          q('spo2', 'percentage'),
          q('heart_rate', 'bpm'),
        ]);
        if (h.error) throw h.error;
        if (s.error) throw s.error;
        if (r.error) throw r.error;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const map = (rows: any[], k: string): IntradayPoint[] =>
          (rows ?? []).map((x) => ({ timestamp_utc: x.timestamp_utc, utc_offset_seconds: x.utc_offset_seconds, value: Number(x[k]) }));
        setData({ hrv: map(h.data as [], 'rmssd_ms'), spo2: map(s.data as [], 'percentage'), hr: map(r.data as [], 'bpm') });
      } catch (e) {
        setErr(errText(e));
      }
    })();
  }, [day]);

  if (err) return <p className="message message-error" style={{ fontSize: 12, margin: 12 }}>{err}</p>;
  if (!data) return <p style={{ ...MUTED, fontSize: 12, margin: 12 }}>A carregar {day}…</p>;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, padding: 14 }}>
      <SeriesBox label="HRV — rmssd_ms" unit="ms" total={counts.hrv} points={data.hrv} />
      <SeriesBox label="SpO2 — percentage" unit="%" total={counts.spo2} points={data.spo2} />
      <SeriesBox label="HR — bpm" unit="bpm" total={counts.hr} points={data.hr} />
    </div>
  );
}

function SeriesBox({ label, unit, total, points }: { label: string; unit: string; total: number; points: IntradayPoint[] }) {
  const first = points[0];
  const last = points[points.length - 1];
  return (
    <div className="inner-card" style={{ padding: 10 }}>
      <p style={{ margin: '0 0 4px', fontSize: 11, fontWeight: 700, color: 'var(--text)' }}>{label}</p>
      <p style={{ margin: '0 0 8px', fontSize: 11, ...MUTED }}>
        {total.toLocaleString()} pontos
        {first && last ? <> · {localHHMMSS(first.timestamp_utc, first.utc_offset_seconds)}–{localHHMMSS(last.timestamp_utc, last.utc_offset_seconds)} (local)</> : null}
      </p>
      {points.length === 0 ? (
        <p style={{ ...MUTED, fontSize: 12, margin: 0 }}>— sem dados —</p>
      ) : (
        <>
          <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 6 }}>
            <table className="table" style={{ margin: 0 }}>
              <tbody>
                {points.map((p, i) => (
                  <tr key={i}>
                    <td style={{ ...MUTED, fontSize: 11, padding: '3px 8px' }}>{localHHMMSS(p.timestamp_utc, p.utc_offset_seconds)}</td>
                    <td style={{ ...NUM, fontSize: 11, padding: '3px 8px' }}>{p.value}<span style={{ ...MUTED, marginLeft: 3 }}>{unit}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {total > points.length && (
            <p style={{ margin: '6px 0 0', fontSize: 10, ...MUTED }}>a mostrar os primeiros {points.length.toLocaleString()} de {total.toLocaleString()}</p>
          )}
        </>
      )}
    </div>
  );
}
