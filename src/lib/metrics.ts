/**
 * Reusable signal-processing utilities.
 * Used for weight trends on the Nutrition page and CTL/ATL training load later.
 */

/**
 * Exponentially weighted moving average.
 * Accepts nullable values — nulls carry the last computed trend forward unchanged.
 * Returns NaN for leading positions before the first non-null seed value.
 */
export function ewma(values: (number | null)[], alpha = 0.1): number[] {
  const result: number[] = [];
  let prev: number | null = null;

  for (const v of values) {
    if (prev === null) {
      if (v !== null) prev = v;
      result.push(prev ?? NaN);
    } else {
      if (v !== null) prev = alpha * v + (1 - alpha) * prev;
      result.push(prev);
    }
  }

  return result;
}

/**
 * Weekly rate of change at each point: trend[i] − trend[i−7].
 * Returns null for the first 7 positions and any index where either operand is NaN.
 */
export function weeklyRateOfChange(trend: number[]): (number | null)[] {
  return trend.map((v, i) => {
    if (i < 7 || isNaN(v) || isNaN(trend[i - 7])) return null;
    return +((v - trend[i - 7]).toFixed(2));
  });
}

/**
 * Estimates the date when the EWMA trend will reach targetValue,
 * using the slope over the last 14 valid data points.
 * Returns "—" when: slope is flat (< 0.001/day), moving the wrong direction,
 * or the projection is more than 3 years out.
 */
export function projectedTarget(trend: number[], targetValue: number): string {
  const valid = trend.filter(v => !isNaN(v));
  if (valid.length < 15) return '—';

  const last       = valid[valid.length - 1];
  const slopePerDay = (last - valid[valid.length - 15]) / 14;

  const movingToward =
    (targetValue < last && slopePerDay < 0) ||
    (targetValue > last && slopePerDay > 0);

  if (!movingToward || Math.abs(slopePerDay) < 0.001) return '—';

  const days = Math.round((targetValue - last) / slopePerDay);
  if (days > 365 * 3) return '—';

  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

/**
 * Percentage of total calories each macro contributes.
 *   Protein & carbs = 4 kcal/g, fat = 9 kcal/g.
 */
export function macroRatios(
  protein: number,
  carbs: number,
  fat: number,
): { proteinPct: number; carbsPct: number; fatPct: number } {
  const pKcal = protein * 4;
  const cKcal = carbs   * 4;
  const fKcal = fat     * 9;
  const total = pKcal + cKcal + fKcal;

  if (total === 0) return { proteinPct: 0, carbsPct: 0, fatPct: 0 };

  return {
    proteinPct: +((pKcal / total) * 100).toFixed(1),
    carbsPct:   +((cKcal / total) * 100).toFixed(1),
    fatPct:     +((fKcal / total) * 100).toFixed(1),
  };
}

// ============================================================================
// SLEEP SCORE  (handoff Rev.2 — forma multiplicativa)
// ============================================================================
//
//   architecture    = Σ(weight_i × component_i)  sobre {deep, fragmentation, rem, latency}
//   duration_factor = min(TST_horas / sleep_need_hours, 1.0)
//   sleep_score     = clamp(architecture × duration_factor, score_min, score_max)
//
// Determinístico e PURO: sem IO, sem relógio, sem leitura de config — todos os
// parâmetros entram por `cfg` (lidos de metrics.config pelo chamador, NUNCA
// hardcoded aqui). O runner de backfill e o cliente partilham este código.
//
// Regras não-óbvias implementadas abaixo (todas do handoff):
//  · Agrupamento de blocos ANTES de calcular; a noite é o grupo de maior TST.
//  · Fragmentação, deep, rem, latência derivam SEMPRE do array `stages` —
//    nunca do campo efficiency nem de minutesToFallAsleep (ambos inúteis).
//  · Pesos re-normalizam-se sobre os componentes presentes; a confidence usa
//    a soma dos pesos BRUTOS presentes (antes de re-normalizar).
//  · Gate: TST < min_duration_publish_hours ⇒ status 'insufficient_data',
//    score null (não há piso no fator de duração por causa deste gate).

export interface SleepScoreConfig {
  // shared
  sleep_need_hours: number;
  // pesos de arquitetura (somam 1.00)
  weight_deep: number;
  weight_fragmentation: number;
  weight_rem: number;
  weight_latency: number;
  // gate / flags de duração
  min_duration_publish_hours: number;
  excessive_sleep_ratio: number;
  // agrupamento de blocos
  merge_max_gap_hours: number;
  // fragmentação
  frag_anchor_0: number;
  frag_anchor_50: number;
  frag_anchor_100: number;
  // deep (SWS)
  deep_target_min: number;
  deep_target_max: number;
  deep_zero_below: number;
  deep_zero_above: number;
  // rem
  rem_target_min: number;
  rem_target_max: number;
  rem_zero_below: number;
  rem_zero_above: number;
  // latência
  latency_optimal_min_mins: number;
  latency_optimal_max_mins: number;
  latency_zero_below_mins: number;
  latency_zero_above_mins: number;
  latency_deprivation_mins: number; // só flag
  latency_poor_mins: number;        // só flag
  // modulação por carga
  deep_shift_per_sd: number;
  load_z_min: number;
  load_z_max: number;
  load_window_days: number;
  // clamp final
  score_min: number;
  score_max: number;
}

export interface RawSleepStage {
  type: string;       // 'AWAKE' | 'LIGHT' | 'DEEP' | 'REM'
  startTime: string;  // ISO UTC
  endTime: string;    // ISO UTC
}

export interface RawSleepBlock {
  start_utc: string;
  end_utc: string;
  utc_offset_seconds: number;
  stages: RawSleepStage[] | null;
}

export type SleepFlag =
  | 'excessive_sleep'
  | 'rem_rebound'
  | 'deep_excessive'
  | 'sleep_pressure_high'
  | 'latency_poor'
  | 'load_modulation_unavailable';

export interface SleepScoreResult {
  status: 'ok' | 'insufficient_data';
  score: number | null;
  architecture: number | null;
  duration_factor: number;
  confidence: number;
  drivers: {
    fragmentation: { ratio: number | null; points: number | null };
    deep:          { frac: number | null;  points: number | null };
    rem:           { frac: number | null;  points: number | null };
    latency:       { mins: number | null;  points: number | null };
    duration_factor: number;
    architecture: number | null;
    shift: number;            // deslocamento do planalto de deep pela carga
    tst_hours: number;
  };
  context: {
    status: 'ok' | 'insufficient_data';
    flags: SleepFlag[];
    components_present: string[];
    components_absent: string[];
    merged_blocks: number;
    inter_block_waso_mins: number;
    tst_minutes: number;
    sleep_period_minutes: number;
    latency_mins: number | null;
  };
}

const SLEEP_STAGES = new Set(['LIGHT', 'DEEP', 'REM']);

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(Math.max(x, lo), hi);
}

/** Interpolação linear de x∈[x0,x1] para [y0,y1] (assume x já dentro do troço). */
function lerp(x: number, x0: number, y0: number, x1: number, y1: number): number {
  if (x1 === x0) return y0;
  return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
}

function minutesBetween(aIso: string, bIso: string): number {
  return (Date.parse(bIso) - Date.parse(aIso)) / 60000;
}

function stageMinutesByType(stages: RawSleepStage[], keep: (t: string) => boolean): number {
  let m = 0;
  for (const s of stages) {
    if (keep(s.type.toUpperCase())) m += minutesBetween(s.startTime, s.endTime);
  }
  return m;
}

/** TST de um bloco = minutos em LIGHT+DEEP+REM (exclui AWAKE). */
function blockTst(block: RawSleepBlock): number {
  if (!block.stages || block.stages.length === 0) return 0;
  return stageMinutesByType(block.stages, (t) => SLEEP_STAGES.has(t));
}

// ── Agrupamento de blocos ─────────────────────────────────────────────────────
// Recebe TODOS os blocos de uma data-de-acordar; devolve o grupo-noite (maior
// TST somado) e os restantes (sestas). Corta o grupo quando o intervalo entre
// blocos consecutivos ≥ merge_max_gap_hours.
export function groupSleepBlocks(
  blocks: RawSleepBlock[],
  cfg: SleepScoreConfig,
): { night: RawSleepBlock[]; naps: RawSleepBlock[][] } {
  const sorted = [...blocks].sort((a, b) => Date.parse(a.start_utc) - Date.parse(b.start_utc));
  const groups: RawSleepBlock[][] = [];
  let cur: RawSleepBlock[] = [];
  for (const b of sorted) {
    if (cur.length === 0) { cur = [b]; continue; }
    const prev = cur[cur.length - 1];
    const gapHours = minutesBetween(prev.end_utc, b.start_utc) / 60;
    if (gapHours < cfg.merge_max_gap_hours) cur.push(b);
    else { groups.push(cur); cur = [b]; }
  }
  if (cur.length) groups.push(cur);

  const tstOf = (g: RawSleepBlock[]) => g.reduce((s, b) => s + blockTst(b), 0);
  let nightIdx = 0;
  for (let i = 1; i < groups.length; i++) if (tstOf(groups[i]) > tstOf(groups[nightIdx])) nightIdx = i;

  return {
    night: groups[nightIdx] ?? [],
    naps: groups.filter((_, i) => i !== nightIdx),
  };
}

// ── Componentes (0–100). Cada um assume que o input existe. ────────────────────

/** Fragmentação: frag_ratio = TST/período, curva linear por troços. */
function fragmentationPoints(fragRatio: number, cfg: SleepScoreConfig): number {
  const { frag_anchor_0: a0, frag_anchor_50: a50, frag_anchor_100: a100 } = cfg;
  if (fragRatio <= a0) return 0;
  if (fragRatio < a50) return lerp(fragRatio, a0, 0, a50, 50);
  if (fragRatio < a100) return lerp(fragRatio, a50, 50, a100, 100);
  return 100;
}

/** Deep (SWS): planalto deslocado pela carga; âncoras de zero NÃO se deslocam. */
function deepPoints(deepFrac: number, shift: number, cfg: SleepScoreConfig): number {
  const zb = cfg.deep_zero_below;
  const za = cfg.deep_zero_above;
  const pmin = cfg.deep_target_min + shift;
  const pmax = cfg.deep_target_max + shift;
  if (deepFrac <= zb) return 0;
  if (deepFrac < pmin) return lerp(deepFrac, zb, 0, pmin, 100);
  if (deepFrac <= pmax) return 100;
  if (deepFrac < za) return lerp(deepFrac, pmax, 100, za, 0);
  return 0;
}

/** REM: estrutura idêntica, sem modulação de carga. */
function remPoints(remFrac: number, cfg: SleepScoreConfig): number {
  const zb = cfg.rem_zero_below;
  const za = cfg.rem_zero_above;
  const pmin = cfg.rem_target_min;
  const pmax = cfg.rem_target_max;
  if (remFrac <= zb) return 0;
  if (remFrac < pmin) return lerp(remFrac, zb, 0, pmin, 100);
  if (remFrac <= pmax) return 100;
  if (remFrac < za) return lerp(remFrac, pmax, 100, za, 0);
  return 0;
}

/** Latência (min): curva em U assimétrica. */
function latencyPoints(latMins: number, cfg: SleepScoreConfig): number {
  const zb = cfg.latency_zero_below_mins;
  const za = cfg.latency_zero_above_mins;
  const omin = cfg.latency_optimal_min_mins;
  const omax = cfg.latency_optimal_max_mins;
  if (latMins <= zb) return 0;
  if (latMins < omin) return lerp(latMins, zb, 0, omin, 100);
  if (latMins <= omax) return 100;
  if (latMins < za) return lerp(latMins, omax, 100, za, 0);
  return 0;
}

/**
 * Sleep score de uma noite. `blocks` = todos os registos wearable.sleep da
 * data-de-acordar (o agrupamento acontece aqui dentro). `loadZ` = z-score de
 * carga (ou null enquanto training_load não existir).
 */
export function getSleepScore(
  blocks: RawSleepBlock[],
  cfg: SleepScoreConfig,
  loadZ: number | null,
): SleepScoreResult {
  const flags: SleepFlag[] = [];
  const { night } = groupSleepBlocks(blocks, cfg);

  // Grandezas derivadas do grupo-noite.
  const first = night[0];
  const last = night[night.length - 1];
  const withStages = night.filter((b) => b.stages && b.stages.length > 0);

  const tstMin = night.reduce((s, b) => s + blockTst(b), 0);
  const periodMin = first && last ? minutesBetween(first.start_utc, last.end_utc) : 0;
  const deepMin = withStages.reduce((s, b) => s + stageMinutesByType(b.stages!, (t) => t === 'DEEP'), 0);
  const remMin = withStages.reduce((s, b) => s + stageMinutesByType(b.stages!, (t) => t === 'REM'), 0);

  let interBlockWaso = 0;
  for (let i = 1; i < night.length; i++) {
    interBlockWaso += Math.max(0, minutesBetween(night[i - 1].end_utc, night[i].start_utc));
  }

  // Latência: SÓ do primeiro bloco. Início do 1.º segmento não-wake − start_utc.
  let latencyMins: number | null = null;
  if (first?.stages && first.stages.length > 0) {
    const firstSleep = first.stages.find((s) => SLEEP_STAGES.has(s.type.toUpperCase()));
    latencyMins = firstSleep ? Math.max(0, minutesBetween(first.start_utc, firstSleep.startTime)) : null;
  }

  const tstHours = tstMin / 60;
  const durationFactor = cfg.sleep_need_hours > 0 ? Math.min(tstHours / cfg.sleep_need_hours, 1.0) : 0;

  // Modulação por carga: shift do planalto de deep (só para cima com load_z_min=0).
  let shift = 0;
  if (loadZ == null) {
    flags.push('load_modulation_unavailable');
  } else {
    shift = clamp(loadZ, cfg.load_z_min, cfg.load_z_max) * cfg.deep_shift_per_sd;
  }

  // Gate: sem TST suficiente não se publica score (row com score null a jusante).
  const hasStages = withStages.length > 0;
  if (!hasStages || tstHours < cfg.min_duration_publish_hours) {
    return {
      status: 'insufficient_data',
      score: null,
      architecture: null,
      duration_factor: durationFactor,
      confidence: 0,
      drivers: {
        fragmentation: { ratio: null, points: null },
        deep: { frac: null, points: null },
        rem: { frac: null, points: null },
        latency: { mins: latencyMins, points: null },
        duration_factor: durationFactor,
        architecture: null,
        shift,
        tst_hours: +tstHours.toFixed(3),
      },
      context: {
        status: 'insufficient_data',
        flags,
        components_present: [],
        components_absent: ['fragmentation', 'deep', 'rem', 'latency'],
        merged_blocks: night.length,
        inter_block_waso_mins: +interBlockWaso.toFixed(1),
        tst_minutes: +tstMin.toFixed(1),
        sleep_period_minutes: +periodMin.toFixed(1),
        latency_mins: latencyMins == null ? null : +latencyMins.toFixed(1),
      },
    };
  }

  // ── Componentes ──────────────────────────────────────────────────────────
  const fragRatio = periodMin > 0 ? tstMin / periodMin : null;
  const deepFrac = tstMin > 0 ? deepMin / tstMin : null;
  const remFrac = tstMin > 0 ? remMin / tstMin : null;

  const fragPts = fragRatio == null ? null : fragmentationPoints(fragRatio, cfg);
  const deepPts = deepFrac == null ? null : deepPoints(deepFrac, shift, cfg);
  const remPts = remFrac == null ? null : remPoints(remFrac, cfg);
  const latPts = latencyMins == null ? null : latencyPoints(latencyMins, cfg);

  // Flags de arquitetura/latência.
  if (deepFrac != null && deepFrac > cfg.deep_target_max + shift) flags.push('deep_excessive');
  if (remFrac != null && remFrac > cfg.rem_target_max) flags.push('rem_rebound');
  if (latencyMins != null && latencyMins < cfg.latency_deprivation_mins) flags.push('sleep_pressure_high');
  if (latencyMins != null && latencyMins > cfg.latency_poor_mins) flags.push('latency_poor');
  if (tstHours / cfg.sleep_need_hours > cfg.excessive_sleep_ratio) flags.push('excessive_sleep');

  // ── Arquitetura: re-normalizar pesos sobre componentes presentes ──────────
  const parts: { key: string; w: number; pts: number }[] = [];
  if (fragPts != null) parts.push({ key: 'fragmentation', w: cfg.weight_fragmentation, pts: fragPts });
  if (deepPts != null) parts.push({ key: 'deep', w: cfg.weight_deep, pts: deepPts });
  if (remPts != null) parts.push({ key: 'rem', w: cfg.weight_rem, pts: remPts });
  if (latPts != null) parts.push({ key: 'latency', w: cfg.weight_latency, pts: latPts });

  const rawWeightSum = parts.reduce((s, p) => s + p.w, 0);
  const architecture = rawWeightSum > 0
    ? parts.reduce((s, p) => s + (p.w / rawWeightSum) * p.pts, 0)
    : null;

  // Confidence = soma dos pesos BRUTOS presentes × 0.95 se carga indisponível.
  let confidence = rawWeightSum;
  if (loadZ == null) confidence *= 0.95;

  const rawScore = architecture == null ? null : architecture * durationFactor;
  const score = rawScore == null ? null : clamp(rawScore, cfg.score_min, cfg.score_max);

  const present = parts.map((p) => p.key);
  const absent = ['fragmentation', 'deep', 'rem', 'latency'].filter((k) => !present.includes(k));

  return {
    status: 'ok',
    score: score == null ? null : +score.toFixed(1),
    architecture: architecture == null ? null : +architecture.toFixed(1),
    duration_factor: +durationFactor.toFixed(4),
    confidence: +confidence.toFixed(4),
    drivers: {
      fragmentation: { ratio: fragRatio == null ? null : +fragRatio.toFixed(4), points: fragPts == null ? null : +fragPts.toFixed(1) },
      deep: { frac: deepFrac == null ? null : +deepFrac.toFixed(4), points: deepPts == null ? null : +deepPts.toFixed(1) },
      rem: { frac: remFrac == null ? null : +remFrac.toFixed(4), points: remPts == null ? null : +remPts.toFixed(1) },
      latency: { mins: latencyMins == null ? null : +latencyMins.toFixed(1), points: latPts == null ? null : +latPts.toFixed(1) },
      duration_factor: +durationFactor.toFixed(4),
      architecture: architecture == null ? null : +architecture.toFixed(1),
      shift: +shift.toFixed(4),
      tst_hours: +tstHours.toFixed(3),
    },
    context: {
      status: 'ok',
      flags,
      components_present: present,
      components_absent: absent,
      merged_blocks: night.length,
      inter_block_waso_mins: +interBlockWaso.toFixed(1),
      tst_minutes: +tstMin.toFixed(1),
      sleep_period_minutes: +periodMin.toFixed(1),
      latency_mins: latencyMins == null ? null : +latencyMins.toFixed(1),
    },
  };
}
