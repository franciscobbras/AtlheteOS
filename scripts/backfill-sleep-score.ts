/**
 * Backfill / recompute do sleep_score sobre todas as noites em wearable.sleep.
 *
 * Corre em Node (type-stripping nativo do Node ≥23) com a service_role key:
 *   node scripts/backfill-sleep-score.ts          # calcula e ESCREVE (upsert)
 *   node scripts/backfill-sleep-score.ts --dry     # calcula e imprime, NÃO escreve
 *
 * A lógica de cálculo vive em src/lib/metrics.ts (pura, partilhada com o cliente).
 * Este runner só faz IO: ler config + wearable.sleep, agrupar por data-de-acordar,
 * chamar getSleepScore e fazer upsert em metrics.daily_scores.
 *
 * Regra do handoff: sempre que a config mudar, recalcular o histórico COMPLETO
 * (é exatamente o que este script faz — reprocessa todas as noites).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import {
  getSleepScore,
  type RawSleepBlock,
  type SleepScoreConfig,
} from '../src/lib/metrics.ts';

const DRY = process.argv.includes('--dry');
const __dirname = dirname(fileURLToPath(import.meta.url));

// ── env (.env.local, sem dependência de dotenv) ────────────────────────────────
function loadEnv(): Record<string, string> {
  const raw = readFileSync(resolve(__dirname, '..', '.env.local'), 'utf8');
  const out: Record<string, string> = {};
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#') || !t.includes('=')) continue;
    const i = t.indexOf('=');
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return out;
}
const env = loadEnv();
const SUPABASE_URL = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_KEY; // service_role
if (!SUPABASE_URL || !SERVICE_KEY) throw new Error('Faltam SUPABASE_URL / SUPABASE_KEY em .env.local');

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

// ── data-de-acordar = data local de end_utc (via utc_offset_seconds) ──────────
function wakeDay(endUtc: string, offsetSeconds: number): string {
  const d = new Date(Date.parse(endUtc) + offsetSeconds * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

async function main() {
  // 1. Config ativa (valid_to IS NULL) para 'shared' + 'sleep_score'.
  const { data: cfgRows, error: cfgErr } = await db
    .schema('metrics')
    .from('config')
    .select('metric_type, param_key, param_value, version')
    .is('valid_to', null)
    .in('metric_type', ['shared', 'sleep_score']);
  if (cfgErr) throw cfgErr;

  const p = new Map<string, number>();
  const versions: string[] = [];
  for (const r of cfgRows as { metric_type: string; param_key: string; param_value: number | string; version: string }[]) {
    p.set(r.param_key, Number(r.param_value));
    if (r.metric_type === 'sleep_score') versions.push(r.version);
  }
  // config_version = versão mais recente entre os params de sleep_score consumidos
  // (lida da própria config, não hardcoded; hoje há mistura v1/v2 → 'v2').
  const configVersion = versions.sort().at(-1) ?? 'v?';

  const need = (k: string): number => {
    if (!p.has(k)) throw new Error(`Config em falta: ${k}`);
    return p.get(k)!;
  };
  const cfg: SleepScoreConfig = {
    sleep_need_hours: need('sleep_need_hours'),
    weight_deep: need('weight_deep'),
    weight_fragmentation: need('weight_fragmentation'),
    weight_rem: need('weight_rem'),
    weight_latency: need('weight_latency'),
    min_duration_publish_hours: need('min_duration_publish_hours'),
    excessive_sleep_ratio: need('excessive_sleep_ratio'),
    merge_max_gap_hours: need('merge_max_gap_hours'),
    frag_anchor_0: need('frag_anchor_0'),
    frag_anchor_50: need('frag_anchor_50'),
    frag_anchor_100: need('frag_anchor_100'),
    deep_target_min: need('deep_target_min'),
    deep_target_max: need('deep_target_max'),
    deep_zero_below: need('deep_zero_below'),
    deep_zero_above: need('deep_zero_above'),
    rem_target_min: need('rem_target_min'),
    rem_target_max: need('rem_target_max'),
    rem_zero_below: need('rem_zero_below'),
    rem_zero_above: need('rem_zero_above'),
    latency_optimal_min_mins: need('latency_optimal_min_mins'),
    latency_optimal_max_mins: need('latency_optimal_max_mins'),
    latency_zero_below_mins: need('latency_zero_below_mins'),
    latency_zero_above_mins: need('latency_zero_above_mins'),
    latency_deprivation_mins: need('latency_deprivation_mins'),
    latency_poor_mins: need('latency_poor_mins'),
    deep_shift_per_sd: need('deep_shift_per_sd'),
    load_z_min: need('load_z_min'),
    load_z_max: need('load_z_max'),
    load_window_days: need('load_window_days'),
    score_min: need('score_min'),
    score_max: need('score_max'),
  };

  // 2. Todas as noites cruas.
  const { data: sleepRows, error: slErr } = await db
    .schema('wearable')
    .from('sleep')
    .select('start_utc, end_utc, utc_offset_seconds, stages')
    .order('start_utc', { ascending: true });
  if (slErr) throw slErr;

  // 3. Agrupar blocos por data-de-acordar.
  const byDay = new Map<string, RawSleepBlock[]>();
  for (const r of sleepRows as RawSleepBlock[]) {
    const d = wakeDay(r.end_utc, r.utc_offset_seconds);
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d)!.push(r);
  }
  const days = [...byDay.keys()].sort();

  // 4. Calcular.
  const rowsToWrite: Record<string, unknown>[] = [];
  const insufficient: string[] = [];
  const table: { day: string; score: number | null; arch: number | null; dur: number; frag: number | null; deep: number | null; rem: number | null; lat: number | null; latmin: number | null; conf: number; flags: string; blocks: number }[] = [];

  for (const day of days) {
    const blocks = byDay.get(day)!;
    const r = getSleepScore(blocks, cfg, null); // loadZ null: training_load ainda não existe
    table.push({
      day, score: r.score, arch: r.architecture, dur: r.duration_factor,
      frag: r.drivers.fragmentation.points, deep: r.drivers.deep.points,
      rem: r.drivers.rem.points, lat: r.drivers.latency.points,
      latmin: r.context.latency_mins, conf: r.confidence,
      flags: r.context.flags.join(','), blocks: r.context.merged_blocks,
    });
    if (r.status === 'insufficient_data') { insufficient.push(day); continue; }
    rowsToWrite.push({
      date: day,
      metric_type: 'sleep_score',
      score: r.score,
      drivers: r.drivers,
      vs_baseline: null,
      confidence: r.confidence,
      context: r.context,
      computed_at_utc: new Date().toISOString(),
      config_version: configVersion,
    });
  }

  // 5. Relatório (secção 11).
  const scores = table.map((t) => t.score).filter((s): s is number => s != null).sort((a, b) => a - b);
  const q = (arr: number[], f: number) => {
    if (!arr.length) return NaN;
    const i = (arr.length - 1) * f;
    const lo = Math.floor(i), hi = Math.ceil(i);
    return lo === hi ? arr[lo] : arr[lo] + (arr[hi] - arr[lo]) * (i - lo);
  };
  const mean = scores.reduce((s, v) => s + v, 0) / (scores.length || 1);
  const sd = Math.sqrt(scores.reduce((s, v) => s + (v - mean) ** 2, 0) / (scores.length || 1));

  const c = (x: number | null) => (x == null ? '  —' : x.toFixed(1).padStart(5));
  console.log(`\nconfig_version=${configVersion}  |  ${DRY ? 'DRY-RUN (não escreve)' : 'WRITE'}  |  loadZ=null (modulação indisponível)\n`);
  console.log('day         score  arch   dur   frag  deep   rem   lat  lat_m  conf  blk  flags');
  for (const t of table) {
    console.log(
      `${t.day}  ${c(t.score)} ${c(t.arch)} ${t.dur.toFixed(2)}  ${c(t.frag)} ${c(t.deep)} ${c(t.rem)} ${c(t.lat)} ${String(t.latmin ?? '—').padStart(5)}  ${t.conf.toFixed(2)}  ${t.blocks}   ${t.flags}`,
    );
  }
  console.log(`\n── Distribuição do score (n=${scores.length}, insufficient_data=${insufficient.length}) ──`);
  if (scores.length) {
    console.log(`  min ${scores[0].toFixed(1)}  |  Q1 ${q(scores, 0.25).toFixed(1)}  |  mediana ${q(scores, 0.5).toFixed(1)}  |  Q3 ${q(scores, 0.75).toFixed(1)}  |  max ${scores[scores.length - 1].toFixed(1)}`);
    console.log(`  IQR ${(q(scores, 0.75) - q(scores, 0.25)).toFixed(1)}  |  média ${mean.toFixed(1)}  |  SD ${sd.toFixed(1)}`);
  }
  const lat0 = table.filter((t) => t.latmin === 0).length;
  const latAll0 = table.every((t) => t.latmin === 0 || t.latmin == null);
  console.log(`  latência 0 em ${lat0}/${table.length} noites${latAll0 ? '  ⚠️ TODAS 0 → componente possivelmente partido' : ''}`);
  if (insufficient.length) console.log(`  ⚠️ insufficient_data (score null, NÃO escrito por score NOT NULL): ${insufficient.join(', ')}`);

  // 6. Escrever.
  if (DRY) { console.log('\n[--dry] nada escrito.'); return; }
  if (!rowsToWrite.length) { console.log('\nNada a escrever.'); return; }
  const { error: upErr } = await db
    .schema('metrics')
    .from('daily_scores')
    .upsert(rowsToWrite, { onConflict: 'metric_type,date' });
  if (upErr) throw upErr;
  console.log(`\n✓ Upsert de ${rowsToWrite.length} linhas em metrics.daily_scores (metric_type=sleep_score).`);
}

main().catch((e) => { console.error('ERRO:', e.message ?? e); process.exit(1); });
