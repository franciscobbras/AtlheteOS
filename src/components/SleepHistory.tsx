'use client';

/**
 * Histórico do Sleep Score (tab Life). Reutiliza EXATAMENTE o ecrã de detalhe do
 * dashboard (ScoreDetailBody de SleepScoreCard) mas para qualquer dia:
 *
 *   ◀  [ sáb, 5 setembro 2026 ]  ▶      ← setas: dia anterior/seguinte COM score
 *        (clicar na data → calendário)
 *
 * O calendário mostra um mês de cada vez, cada dia com o seu sleep score (a cor
 * do score), e navega mês a mês. Clicar num dia abre-o no detalhe.
 *
 * Só LÊ: metrics.daily_scores (sleep_score + sri) e subjective.morning_checkin,
 * por data. O cálculo vive em src/lib/metrics.ts.
 */

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { ScoreDetailBody, scoreColor, type SriRow, type SriPub } from '@/components/SleepScoreCard';
import { Hypnogram, durationMin, fmtHhMm, efficiencyPct, localHHMM, localDate, type SleepRow } from '@/components/WearableRawInspector';
import { localTodayYMD } from '@/components/CheckinForm';
import type { DayScore, DayCheckin } from '@/contexts/DayDataContext';

// ── Helpers de data (âncora local, sem TZ — as datas são wake-days YYYY-MM-DD) ──
function parseYMD(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function ymd(dt: Date): string {
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}
function addDays(s: string, n: number): string {
  const d = parseYMD(s); d.setDate(d.getDate() + n); return ymd(d);
}
function friendly(s: string): string {
  return parseYMD(s).toLocaleDateString('pt-PT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}
function monthLabel(y: number, m0: number): string {
  return new Date(y, m0, 1).toLocaleDateString('pt-PT', { month: 'long', year: 'numeric' });
}
const WEEKDAYS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];

export default function SleepHistory() {
  // Overview: todos os dias com sleep score (para setas + calendário).
  const [scoresByDate, setScoresByDate] = useState<Map<string, number>>(new Map());
  const [scoreDates, setScoreDates] = useState<string[]>([]); // ordenadas asc, só com score
  const [sriPub, setSriPub] = useState<SriPub[]>([]);
  const [overviewLoaded, setOverviewLoaded] = useState(false);

  // Dia selecionado + o seu detalhe completo.
  const [selDate, setSelDate] = useState<string | null>(null);
  const [dayScore, setDayScore] = useState<DayScore | null>(null);
  const [checkin, setCheckin] = useState<DayCheckin | null>(null);
  const [mainSleep, setMainSleep] = useState<SleepRow | null>(null); // bloco principal (mais longo) dessa noite
  const [sleepBlocks, setSleepBlocks] = useState(0);
  const [dayLoading, setDayLoading] = useState(false);

  // Calendário.
  const [calOpen, setCalOpen] = useState(false);
  const [calYM, setCalYM] = useState<{ y: number; m0: number } | null>(null);

  // 1. Overview (uma vez): mapa data→score, série do SRI.
  useEffect(() => {
    (async () => {
      const [sc, sri] = await Promise.all([
        supabase.schema('metrics').from('daily_scores')
          .select('date, score').eq('metric_type', 'sleep_score')
          .order('date', { ascending: true }),
        supabase.schema('metrics').from('daily_scores')
          .select('date, score, confidence, drivers, context').eq('metric_type', 'sri')
          .order('date', { ascending: true }),
      ]);
      const map = new Map<string, number>();
      const dates: string[] = [];
      for (const r of (sc.data as { date: string; score: number | null }[] | null) ?? []) {
        if (r.score != null) { map.set(r.date, Number(r.score)); dates.push(r.date); }
      }
      setScoresByDate(map);
      setScoreDates(dates);
      setSriPub(((sri.data as SriRow[] | null) ?? []).filter((r): r is SriPub => r.score != null));
      const initial = dates.length ? dates[dates.length - 1] : localTodayYMD();
      setSelDate(initial);
      setCalYM({ y: parseYMD(initial).getFullYear(), m0: parseYMD(initial).getMonth() });
      setOverviewLoaded(true);
    })();
  }, []);

  // 2. Detalhe do dia selecionado.
  useEffect(() => {
    if (!selDate) return;
    let cancelled = false;
    setDayLoading(true);
    (async () => {
      // Sono é keyed por start_utc, não por dia. A noite pertence ao DIA DE
      // ACORDAR (localDate do end_utc). Puxo a janela à volta do dia e escolho os
      // blocos cujo wake-day == selDate; o principal é o mais longo (como no wearable).
      const [sc, ci, sl] = await Promise.all([
        supabase.schema('metrics').from('daily_scores')
          .select('date, score, confidence, config_version, drivers, context')
          .eq('metric_type', 'sleep_score').eq('date', selDate).maybeSingle(),
        supabase.schema('subjective').from('morning_checkin')
          .select('date, sleep_perceived, recovery_feeling, mood_energy, notes')
          .eq('date', selDate).maybeSingle(),
        supabase.schema('wearable').from('sleep')
          .select('start_utc, end_utc, utc_offset_seconds, summary, stages, source')
          .gte('end_utc', `${addDays(selDate, -1)}T00:00:00Z`)
          .lte('end_utc', `${addDays(selDate, 1)}T00:00:00Z`)
          .order('end_utc', { ascending: true }),
      ]);
      if (cancelled) return;
      setDayScore(sc.error ? null : ((sc.data as DayScore) ?? null));
      setCheckin(ci.error ? null : ((ci.data as DayCheckin) ?? null));
      const blocks = ((sl.data as SleepRow[] | null) ?? [])
        .filter((r) => localDate(r.end_utc, r.utc_offset_seconds) === selDate);
      const main = blocks.reduce<SleepRow | null>((best, r) =>
        !best || durationMin(r.start_utc, r.end_utc) > durationMin(best.start_utc, best.end_utc) ? r : best, null);
      setMainSleep(main);
      setSleepBlocks(blocks.length);
      setDayLoading(false);
    })();
    return () => { cancelled = true; };
  }, [selDate]);

  // Setas: dia de calendário anterior/seguinte (podem aterrar em dias VAZIOS).
  // Limite inferior = primeiro dia com score; superior = hoje (sem futuro).
  const { prevDate, nextDate } = useMemo(() => {
    if (!selDate) return { prevDate: null as string | null, nextDate: null as string | null };
    const floor = scoreDates[0];
    const today = localTodayYMD();
    return {
      prevDate: floor && selDate > floor ? addDays(selDate, -1) : null,
      nextDate: selDate < today ? addDays(selDate, 1) : null,
    };
  }, [scoreDates, selDate]);

  // SRI "à data": a última leitura do SRI em/antes do dia selecionado.
  const sriLatest = useMemo(() => {
    if (!selDate || !sriPub.length) return null;
    const upto = sriPub.filter((r) => r.date <= selDate);
    return upto.length ? upto[upto.length - 1] : sriPub[0];
  }, [sriPub, selDate]);

  function pick(date: string) {
    setSelDate(date);
    setCalYM({ y: parseYMD(date).getFullYear(), m0: parseYMD(date).getMonth() });
    setCalOpen(false);
  }

  if (!overviewLoaded) {
    return <p style={{ color: 'var(--muted)', fontSize: 14 }}>A carregar…</p>;
  }
  if (!scoreDates.length) {
    return <div className="card" style={{ fontSize: 13, color: 'var(--muted)' }}>Sem sleep scores registados ainda.</div>;
  }

  const score = dayScore && dayScore.score != null ? Math.round(Number(dayScore.score)) : null;
  const conf = dayScore && dayScore.confidence != null ? Math.round(Number(dayScore.confidence) * 100) : null;
  const color = score != null ? scoreColor(score) : 'var(--muted)';

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {/* Navegador de dia */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
        <button className="btn btn-ghost" aria-label="Dia anterior" disabled={!prevDate}
          onClick={() => prevDate && pick(prevDate)} style={{ fontSize: 18, padding: '4px 12px' }}>‹</button>
        <button className="btn btn-secondary" onClick={() => setCalOpen((o) => !o)}
          style={{ minWidth: 240, justifyContent: 'center', textTransform: 'capitalize', fontWeight: 600 }}>
          {selDate ? friendly(selDate) : '—'}
        </button>
        <button className="btn btn-ghost" aria-label="Dia seguinte" disabled={!nextDate}
          onClick={() => nextDate && pick(nextDate)} style={{ fontSize: 18, padding: '4px 12px' }}>›</button>
      </div>

      {/* Calendário mensal */}
      {calOpen && calYM && (
        <Calendar
          y={calYM.y} m0={calYM.m0} selDate={selDate} today={localTodayYMD()}
          scoresByDate={scoresByDate}
          onMonth={(dy) => {
            const d = new Date(calYM.y, calYM.m0 + dy, 1);
            setCalYM({ y: d.getFullYear(), m0: d.getMonth() });
          }}
          onPick={pick}
        />
      )}

      {dayLoading ? (
        <div className="card"><p style={{ color: 'var(--muted)', fontSize: 14, margin: 0 }}>A carregar…</p></div>
      ) : (
        <>
          {/* Arquitetura do sono + tempo dormido — o que existir, mesmo sem score */}
          {mainSleep ? (
            <SleepArchitecture sleep={mainSleep} blocks={sleepBlocks} />
          ) : (
            <div className="card">
              <p style={{ color: 'var(--muted)', fontSize: 13, margin: 0 }}>
                Sem dados de sono para {selDate ? friendly(selDate) : 'este dia'}.
              </p>
            </div>
          )}

          {/* Sleep score — o mesmo detalhe do dashboard, ou aviso se não houver */}
          <div className="card">
            {dayScore && score != null ? (
              <ScoreDetailBody
                row={dayScore} score={score} conf={conf} color={color}
                checkin={checkin} sriPub={sriPub} sriLatest={sriLatest}
              />
            ) : (
              <p style={{ color: 'var(--muted)', fontSize: 13, margin: 0 }}>
                <strong style={{ color: 'var(--text)' }}>Sem sleep score para esta noite.</strong>{' '}
                {mainSleep ? 'Há dados de sono (acima), mas o score não foi calculado para este dia.' : ''}
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── Arquitetura do sono: tempo dormido em grande + info principal + hipnograma ──
function SleepArchitecture({ sleep, blocks }: { sleep: SleepRow; blocks: number }) {
  const off = sleep.utc_offset_seconds;
  const summary = sleep.summary ?? {};
  const asleep = Number(summary.minutesAsleep);
  const inBed = Number(summary.minutesInSleepPeriod);
  const dur = durationMin(sleep.start_utc, sleep.end_utc);
  const eff = efficiencyPct(summary);
  return (
    <div className="card">
      <p className="section-label" style={{ marginTop: 0 }}>Arquitetura do sono</p>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 44, fontWeight: 800, lineHeight: 1, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>
          {fmtHhMm(Number.isFinite(asleep) ? asleep : dur)}
        </span>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>dormido</span>
      </div>
      <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--muted)' }}>
        {localHHMM(sleep.start_utc, off)} → {localHHMM(sleep.end_utc, off)}
        {' · '}na cama <strong style={{ color: 'var(--text)' }}>{fmtHhMm(Number.isFinite(inBed) ? inBed : dur)}</strong>
        {eff != null ? <> · eficiência <strong style={{ color: 'var(--text)' }}>{eff}%</strong></> : null}
        {blocks > 1 ? <> · bloco principal de <strong style={{ color: 'var(--text)' }}>{blocks}</strong> da noite</> : null}
      </p>
      <Hypnogram stages={sleep.stages} offsetSeconds={off} />
    </div>
  );
}

// ── Grelha do mês ─────────────────────────────────────────────────────────────
function Calendar({
  y, m0, selDate, today, scoresByDate, onMonth, onPick,
}: {
  y: number; m0: number; selDate: string | null; today: string;
  scoresByDate: Map<string, number>;
  onMonth: (deltaMonths: number) => void;
  onPick: (date: string) => void;
}) {
  const daysInMonth = new Date(y, m0 + 1, 0).getDate();
  const leading = (new Date(y, m0, 1).getDay() + 6) % 7; // Seg=0
  const cells: (string | null)[] = [
    ...Array(leading).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => ymd(new Date(y, m0, i + 1))),
  ];

  return (
    <div className="card" style={{ padding: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <button className="btn btn-ghost btn-sm" aria-label="Mês anterior" onClick={() => onMonth(-1)}>‹</button>
        <span style={{ fontWeight: 600, textTransform: 'capitalize' }}>{monthLabel(y, m0)}</span>
        <button className="btn btn-ghost btn-sm" aria-label="Mês seguinte" onClick={() => onMonth(1)}>›</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
        {WEEKDAYS.map((w) => (
          <div key={w} style={{ textAlign: 'center', fontSize: 10, color: 'var(--muted)', fontWeight: 600, paddingBottom: 2 }}>{w}</div>
        ))}
        {cells.map((date, i) => {
          if (!date) return <div key={`b${i}`} />;
          const sc = scoresByDate.get(date);
          const has = sc != null;
          const isSel = date === selDate;
          const isToday = date === today;
          const future = date > today; // dias por vir não são selecionáveis
          return (
            <button
              key={date}
              onClick={() => onPick(date)}
              disabled={future}
              title={has ? `Sleep score ${Math.round(sc!)}` : future ? 'Ainda não' : 'Sem score — abre o que houver'}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                gap: 1, aspectRatio: '1', borderRadius: 8, cursor: future ? 'default' : 'pointer',
                border: isSel ? '2px solid var(--accent)' : '1px solid var(--border)',
                background: isSel ? 'var(--surface-hover)' : 'var(--surface)',
                opacity: future ? 0.3 : has ? 1 : 0.6,
              }}
            >
              <span style={{ fontSize: 11, color: isToday ? 'var(--accent)' : 'var(--text-secondary)', fontWeight: isToday ? 700 : 400 }}>
                {parseYMD(date).getDate()}
              </span>
              <span style={{ fontSize: 13, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: has ? scoreColor(Math.round(sc!)) : 'var(--muted)' }}>
                {has ? Math.round(sc!) : '·'}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
