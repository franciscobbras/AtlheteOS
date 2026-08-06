'use client';

/**
 * Morning check-in screen (sidebar route). Fill or re-fill TODAY's check-in at
 * any hour (retroactive entry is allowed and recorded via logged_at_utc), and
 * see past check-ins read-only. Editing is upsert-by-date; no delete (the
 * project never destroys raw records).
 */

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import CheckinForm, { CheckinValues, localTodayYMD } from './CheckinForm';

type Row = {
  date: string;
  logged_at_utc: string;
  utc_offset_seconds: number;
  sleep_perceived: number | null;
  recovery_feeling: number | null;
  mood_energy: number | null;
  notes: string | null;
};

function errText(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === 'object') {
    const o = e as Record<string, unknown>;
    const parts = [o.message, o.details, o.hint, o.code].filter(Boolean).map(String);
    if (parts.length) return parts.join(' · ');
  }
  return String(e);
}

function localDateTime(utcIso: string, offsetSeconds: number): string {
  const d = new Date(new Date(utcIso).getTime() + offsetSeconds * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}
function localHM(utcIso: string, offsetSeconds: number): string {
  const d = new Date(new Date(utcIso).getTime() + offsetSeconds * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}
// Wake day = local date of the sleep's end (same wake-day convention as
// wearable.sleep / the wearable_raw inspector).
function wakeDayYMD(endUtcIso: string, offsetSeconds: number): string {
  const d = new Date(new Date(endUtcIso).getTime() + offsetSeconds * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}
// Real elapsed time between waking and logging (both absolute UTC instants,
// so timezone-agnostic). This is the raw input to the reliability model — the
// decay curve itself is intentionally deferred (windows tuned later).
function fmtLatency(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 0) return '—';
  const h = Math.floor(minutes / 60), m = Math.round(minutes % 60);
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

type SleepRow = { start_utc: string; end_utc: string; utc_offset_seconds: number };

export default function CheckinScreen() {
  const [rows, setRows] = useState<Row[] | null>(null);
  // wake day (YMD) → main sleep's end_utc, for the "após acordar" latency.
  const [wake, setWake] = useState<Map<string, string>>(new Map());
  // Reliability params from metrics.config (never hardcoded). null until loaded.
  const [rel, setRel] = useState<{ grace: number; halfLife: number; floor: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [savedTick, setSavedTick] = useState(0);

  const today = localTodayYMD();

  async function load() {
    try {
      const [ci, sl, cf] = await Promise.all([
        supabase
          .schema('subjective')
          .from('morning_checkin')
          .select('date, logged_at_utc, utc_offset_seconds, sleep_perceived, recovery_feeling, mood_energy, notes')
          .order('date', { ascending: false })
          .limit(60),
        supabase
          .schema('wearable')
          .from('sleep')
          .select('start_utc, end_utc, utc_offset_seconds')
          .order('end_utc', { ascending: false })
          .limit(120),
        supabase
          .schema('metrics')
          .from('config')
          .select('param_key, param_value')
          .eq('metric_type', 'checkin_reliability')
          .is('valid_to', null),
      ]);
      if (ci.error) throw ci.error;
      // Sleep is best-effort: if it fails, the screen still works without latency.
      const m = new Map<string, { end: string; dur: number }>();
      if (!sl.error) {
        for (const s of (sl.data as SleepRow[] ?? [])) {
          const wd = wakeDayYMD(s.end_utc, s.utc_offset_seconds);
          const dur = Date.parse(s.end_utc) - Date.parse(s.start_utc);
          const cur = m.get(wd);
          if (!cur || dur > cur.dur) m.set(wd, { end: s.end_utc, dur }); // longest session wins (main sleep, not a nap)
        }
      }
      setWake(new Map([...m].map(([k, v]) => [k, v.end])));
      // Reliability is driven solely by config; if it's absent, we show no score.
      const p = new Map((cf.data ?? []).map((r: { param_key: string; param_value: number | string }) => [r.param_key, Number(r.param_value)]));
      if (p.has('grace_hours') && p.has('half_life_hours') && p.has('floor')) {
        setRel({ grace: p.get('grace_hours')!, halfLife: p.get('half_life_hours')!, floor: p.get('floor')! });
      }
      setRows((ci.data as Row[]) ?? []);
      setErr(null);
    } catch (e) {
      setErr(errText(e));
    }
  }

  function latencyMin(r: Row): number | null {
    const end = wake.get(r.date);
    if (!end) return null;
    return (Date.parse(r.logged_at_utc) - Date.parse(end)) / 60000;
  }

  // fiabilidade = piso + (1 − piso) × 2^(−excesso / meia_vida), excesso em horas.
  function reliability(latMin: number | null): number | null {
    if (latMin == null || !rel) return null;
    const excesso = Math.max(0, latMin / 60 - rel.grace);
    return rel.floor + (1 - rel.floor) * Math.pow(2, -excesso / rel.halfLife);
  }
  function relColor(f: number): string {
    return f >= 0.8 ? '#22C55E' : f >= 0.5 ? '#F59E0B' : '#EF4444';
  }

  useEffect(() => { load(); }, [savedTick]);

  const todayRow = rows?.find((r) => r.date === today) ?? null;
  const initial: Partial<CheckinValues> | null = todayRow
    ? {
        sleep_perceived: todayRow.sleep_perceived,
        recovery_feeling: todayRow.recovery_feeling,
        mood_energy: todayRow.mood_energy,
        notes: todayRow.notes ?? '',
      }
    : null;

  return (
    <div style={{ display: 'grid', gap: 16 }} className="animate-fade-in">
      <div className="page-header">
        <h1 className="page-title">Check-in matinal</h1>
        <p className="page-subtitle">Como te sentes hoje — a camada subjetiva, respondida antes dos números.</p>
      </div>

      <div className="card" style={{ maxWidth: 520 }}>
        <p className="section-label" style={{ marginTop: 0 }}>
          {todayRow ? `Hoje (${today}) — editar` : `Hoje (${today})`}
        </p>
        {rows === null ? (
          <p style={{ color: 'var(--muted)' }}>A carregar…</p>
        ) : (
          <CheckinForm
            key={todayRow ? 'edit' : 'new'}
            initial={initial}
            onSaved={() => setSavedTick((t) => t + 1)}
          />
        )}
        {todayRow && (() => {
          const lat = latencyMin(todayRow);
          const f = reliability(lat);
          return (
            <p style={{ margin: '10px 0 0', fontSize: 11, color: 'var(--muted)' }}>
              Registado em {localDateTime(todayRow.logged_at_utc, todayRow.utc_offset_seconds)} (local)
              {wake.get(today) ? <> · acordaste às {localHM(wake.get(today)!, todayRow.utc_offset_seconds)} → <strong style={{ color: 'var(--text)' }}>{fmtLatency(lat ?? NaN)}</strong> depois</> : null}
              {f != null ? <> · fiabilidade <strong style={{ color: relColor(f) }}>{Math.round(f * 100)}%</strong></> : null}.
              Voltar a guardar atualiza os valores; o momento do primeiro registo mantém-se.
            </p>
          );
        })()}
        {!todayRow && rows !== null && (
          <p style={{ margin: '10px 0 0', fontSize: 11, color: 'var(--muted)' }}>
            A fiabilidade do check-in é maior quanto mais cedo após acordares o preencheres — sem prazo, mas o atraso conta.
          </p>
        )}
      </div>

      <div className="card">
        <p className="section-label" style={{ marginTop: 0 }}>Histórico</p>
        {err && <p className="message message-error" style={{ fontSize: 13 }}>{err}</p>}
        {rows && rows.length === 0 && <p style={{ color: 'var(--muted)', fontSize: 13 }}>Sem check-ins ainda.</p>}
        {rows && rows.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Data (acordar)</th>
                  <th style={{ textAlign: 'right' }}>Sono</th>
                  <th style={{ textAlign: 'right' }}>Recuperação</th>
                  <th style={{ textAlign: 'right' }}>Energia</th>
                  <th style={{ textAlign: 'right' }}>Após acordar</th>
                  <th style={{ textAlign: 'right' }}>Fiabilidade</th>
                  <th>Notas</th>
                  <th>Registado (local)</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const lat = latencyMin(r);
                  const f = reliability(lat);
                  return (
                  <tr key={r.date} style={r.date === today ? { background: 'var(--surface-hover)' } : undefined}>
                    <td style={{ fontWeight: 600, color: 'var(--text)' }}>{r.date}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.sleep_perceived ?? '—'}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.recovery_feeling ?? '—'}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.mood_energy ?? '—'}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: lat != null ? 'var(--text)' : 'var(--muted)' }} title="tempo entre acordar (Fitbit) e o registo">{lat != null ? fmtLatency(lat) : '—'}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: f != null ? relColor(f) : 'var(--muted)' }} title="piso + (1−piso)·2^(−excesso/meia_vida)">{f != null ? `${Math.round(f * 100)}%` : '—'}</td>
                    <td style={{ color: 'var(--muted)', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.notes ?? ''}</td>
                    <td style={{ color: 'var(--muted)', fontSize: 11 }}>{localDateTime(r.logged_at_utc, r.utc_offset_seconds)}</td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
