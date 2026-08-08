'use client';

/**
 * Dados do DIA partilhados entre componentes, buscados UMA vez.
 *
 * Antes, no carregamento do dashboard, morning_checkin era pedido 3× (o gate no
 * mount + outra vez pelo INITIAL_SESSION do onAuthStateChange, e o SleepScoreCard
 * mais uma) e o daily_scores em série. Aqui faz-se um só getSession e depois
 * morning_checkin(hoje) + daily_scores(hoje) EM PARALELO, partilhados por quem
 * precisar (gate cego + card de score). Sem biblioteca de data-fetching nova —
 * só Context do React.
 *
 * "hoje" = wake-day local (localTodayYMD), a mesma chave do check-in e do score.
 */

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { localTodayYMD } from '@/components/CheckinForm';

export type DayCheckin = {
  date: string;
  sleep_perceived: number | null;
  recovery_feeling: number | null;
  mood_energy: number | null;
  notes: string | null;
};

export type ScoreDrivers = {
  fragmentation: { ratio: number | null; points: number | null };
  deep: { frac: number | null; points: number | null };
  rem: { frac: number | null; points: number | null };
  latency: { mins: number | null; points: number | null };
  duration_factor: number;
  architecture: number | null;
  shift: number;
  tst_hours: number;
};
export type ScoreContext = {
  status: string;
  flags: string[];
  merged_blocks: number;
  inter_block_waso_mins: number;
  tst_minutes: number;
  sleep_period_minutes: number;
  latency_mins: number | null;
};
export type DayScore = {
  date: string;
  score: number | null;
  confidence: number | null;
  config_version: string | null;
  drivers: ScoreDrivers | null;
  context: ScoreContext | null;
};

type DayData = {
  loading: boolean;
  authed: boolean;
  checkin: DayCheckin | null;
  // A leitura do check-in falhou? O gate cego usa isto para NÃO bloquear em erro
  // de leitura (comportamento fail-open original): não se distingue "sem row" de
  // "erro" só pelo checkin null.
  checkinError: boolean;
  score: DayScore | null;
  refresh: () => Promise<void>;
};

const Ctx = createContext<DayData | null>(null);

export function DayDataProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [authed, setAuthed] = useState(false);
  const [checkin, setCheckin] = useState<DayCheckin | null>(null);
  const [checkinError, setCheckinError] = useState(false);
  const [score, setScore] = useState<DayScore | null>(null);

  const load = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      setAuthed(false); setCheckin(null); setCheckinError(false); setScore(null); setLoading(false);
      return;
    }
    const today = localTodayYMD();
    const [ci, sc] = await Promise.all([
      supabase.schema('subjective').from('morning_checkin')
        .select('date, sleep_perceived, recovery_feeling, mood_energy, notes')
        .eq('date', today).maybeSingle(),
      supabase.schema('metrics').from('daily_scores')
        .select('date, score, confidence, config_version, drivers, context')
        .eq('metric_type', 'sleep_score').eq('date', today).maybeSingle(),
    ]);
    setAuthed(true);
    setCheckinError(!!ci.error);
    setCheckin(ci.error ? null : ((ci.data as DayCheckin) ?? null));
    setScore(sc.error ? null : ((sc.data as DayScore) ?? null));
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    // Só re-busca em transições reais de sessão. INITIAL_SESSION/TOKEN_REFRESHED
    // são ignorados — era o INITIAL_SESSION que causava o fetch duplicado.
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') { setLoading(true); load(); }
    });
    // Reavaliar quando o separador volta a foco (ex.: o dia local mudou).
    const onVis = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { sub.subscription.unsubscribe(); document.removeEventListener('visibilitychange', onVis); };
  }, [load]);

  return (
    <Ctx.Provider value={{ loading, authed, checkin, checkinError, score, refresh: load }}>
      {children}
    </Ctx.Provider>
  );
}

export function useDayData(): DayData {
  const v = useContext(Ctx);
  if (!v) throw new Error('useDayData tem de estar dentro de <DayDataProvider>');
  return v;
}
