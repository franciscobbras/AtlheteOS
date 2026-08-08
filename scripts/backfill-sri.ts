/**
 * Backfill / recompute do SRI (Sleep Regularity Index) sobre todas as datas com
 * histórico. Corre em Node (type-stripping nativo) com a service_role key:
 *   node scripts/backfill-sri.ts           # calcula e ESCREVE
 *   node scripts/backfill-sri.ts --dry      # calcula e imprime, NÃO escreve
 *
 * Delega em computeSRI (supabase/functions/_shared/sri.ts), que por sua vez usa
 * getSRI de src/lib/metrics.ts — a mesma lógica da Edge Function. O SRI de cada
 * data usa a janela dos 14 dias anteriores; as datas sem janela cheia saem como
 * insufficient_data (escritas na mesma, para a série não ter buracos).
 */

import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { computeSRI } from '../supabase/functions/_shared/sri.ts';

const DRY = process.argv.includes('--dry');

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const db = createClient(env.SUPABASE_URL, env.SUPABASE_KEY, { auth: { persistSession: false } });

function wakeDay(endUtc: string, offsetSeconds: number): string {
  const d = new Date(Date.parse(endUtc) + offsetSeconds * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

async function main() {
  // Amplitude de datas-de-acordar a partir do sono cru.
  const { data: sleep, error } = await db.schema('wearable').from('sleep')
    .select('end_utc, utc_offset_seconds').order('end_utc', { ascending: true });
  if (error) throw error;
  const days = (sleep ?? []).map((r: { end_utc: string; utc_offset_seconds: number }) => wakeDay(r.end_utc, r.utc_offset_seconds));
  if (!days.length) { console.log('Sem sono em wearable.sleep — nada a fazer.'); return; }
  const from = days[0], to = days[days.length - 1];
  console.log(`Datas de acordar: ${from} .. ${to} (${new Set(days).size} noites)\n`);

  if (DRY) {
    // Em dry-run não escrevemos: recalculamos e imprimimos via leitura direta.
    console.log('[--dry] a calcular sem escrever não é suportado pelo computeSRI (faz upsert).');
    console.log('        Corre sem --dry; o upsert é idempotente. A abortar.');
    return;
  }

  const r = await computeSRI(db, { from, to });
  console.log(`Escrito: ${r.written} linhas  |  publicadas: ${r.published.length}  |  insufficient_data: ${r.insufficient.length}`);
  if (r.insufficient.length) console.log(`  insufficient_data: ${r.insufficient.join(', ')}`);

  // Distribuição das publicadas (valor cru [-100,100]).
  const { data: rows } = await db.schema('metrics').from('daily_scores')
    .select('date, score, confidence, context')
    .eq('metric_type', 'sri').not('score', 'is', null).order('date', { ascending: true });
  const vals = (rows ?? []).map((x: { score: number }) => Number(x.score)).sort((a, b) => a - b);
  const q = (f: number) => { if (!vals.length) return NaN; const i = (vals.length - 1) * f, lo = Math.floor(i), hi = Math.ceil(i); return lo === hi ? vals[lo] : vals[lo] + (vals[hi] - vals[lo]) * (i - lo); };
  const mean = vals.reduce((s, v) => s + v, 0) / (vals.length || 1);

  console.log(`\n── SRI publicado (n=${vals.length}) — valor cru [-100,100] ──`);
  if (vals.length) {
    console.log(`  min ${vals[0].toFixed(1)}  |  mediana ${q(0.5).toFixed(1)}  |  média ${mean.toFixed(1)}  |  max ${vals[vals.length - 1].toFixed(1)}`);
    console.log('\n  data        SRI   conf  dias_válidos');
    for (const x of (rows ?? []) as Array<{ date: string; score: number; confidence: number; context: { dias_validos: number } }>) {
      console.log(`  ${x.date}  ${String(x.score).padStart(5)}  ${Number(x.confidence).toFixed(2)}   ${x.context?.dias_validos ?? '?'}`);
    }
  }
}

main().catch((e) => { console.error('ERRO:', e.message ?? e); process.exit(1); });
