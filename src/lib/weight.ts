import { supabase } from '@/lib/supabaseClient';
import { getWeightTrend, type WeightPoint, type WeightTrendConfig, type WeightTrendResult } from '@/lib/metrics';
import { localTodayYMD, localOffsetSeconds } from '@/components/CheckinForm';

/**
 * Registo de peso + leitura da trend. A LÓGICA (EMA por tempo, velocidade) vive
 * em src/lib/metrics.ts (getWeightTrend) — aqui só IO: escrever a pesagem do dia
 * e ler a série + a config para calcular a trend na leitura (nunca guardada).
 *
 * ⚠️ O schema `body` TEM de estar exposto ao PostgREST (hoje só estão public,
 * wearable, subjective, metrics, ops, training). Sem isso estas chamadas dão
 * PGRST106. E o nome da coluna do peso está numa constante — AJUSTAR se o schema
 * usar outro nome que não `weight_kg`.
 */

// Coluna numérica do peso em body.weight. Mudar aqui se o schema diferir.
const WEIGHT_KG_COL = 'weight_kg';

// deno-lint-ignore no-explicit-any — schema `body` é destipado (não está nos tipos gerados)
type Row = Record<string, any>;

export async function listWeights(): Promise<WeightPoint[]> {
  const { data, error } = await supabase
    .schema('body').from('weight')
    .select(`date, ${WEIGHT_KG_COL}`)
    .order('date', { ascending: true })
    .limit(400);
  if (error) throw error;
  return ((data ?? []) as Row[])
    .map((r) => ({ date: r.date as string, kg: Number(r[WEIGHT_KG_COL]) }))
    .filter((p) => isFinite(p.kg));
}

export async function getTodayWeight(): Promise<number | null> {
  const { data, error } = await supabase
    .schema('body').from('weight')
    .select(WEIGHT_KG_COL)
    .eq('date', localTodayYMD())
    .maybeSingle();
  if (error || !data) return null;
  const v = Number((data as Row)[WEIGHT_KG_COL]);
  return isFinite(v) ? v : null;
}

/** Um peso por dia — upsert por `date`. Guarda o offset como todo o resto. */
export async function upsertWeight(kg: number): Promise<void> {
  const { error } = await supabase
    .schema('body').from('weight')
    .upsert(
      { date: localTodayYMD(), [WEIGHT_KG_COL]: kg, utc_offset_seconds: localOffsetSeconds() },
      { onConflict: 'date' },
    );
  if (error) throw error;
}

export async function loadWeightTrendConfig(): Promise<WeightTrendConfig> {
  const { data, error } = await supabase
    .schema('metrics').from('config')
    .select('param_key, param_value')
    .eq('metric_type', 'weight')
    .is('valid_to', null);
  if (error) throw error;
  const p = new Map(((data ?? []) as Row[]).map((r) => [r.param_key as string, Number(r.param_value)]));
  const need = (k: string): number => {
    const v = p.get(k);
    if (v == null || !isFinite(v)) throw new Error(`config em falta: weight.${k}`);
    return v;
  };
  return {
    ema_half_life_days: need('ema_half_life_days'),
    velocity_window_days: need('velocity_window_days'),
    min_days: need('min_days'),
  };
}

/** Conveniência: lê série + config e devolve a trend calculada. */
export async function loadWeightTrend(): Promise<WeightTrendResult> {
  const [pts, cfg] = await Promise.all([listWeights(), loadWeightTrendConfig()]);
  return getWeightTrend(pts, cfg);
}
