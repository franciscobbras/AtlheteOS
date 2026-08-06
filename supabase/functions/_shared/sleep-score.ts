// Sleep-score IO para as Edge Functions (Deno). A LÓGICA do score NÃO vive aqui:
// getSleepScore é importado, sem alterações, de src/lib/metrics.ts — a mesma
// fonte que o cliente e o runner manual usam. Aqui só há IO: ler config, ler
// wearable.sleep, agrupar por data-de-acordar e upsert em metrics.daily_scores.
//
// FONTE ÚNICA (não duplicar): o import relativo abaixo faz o bundler do deploy
// inlinar src/lib/metrics.ts. Se um dia divergir, é um erro de deploy barulhento
// — nunca dois números diferentes em silêncio (que é o bug que se quer evitar).

import {
  getSleepScore,
  type RawSleepBlock,
  type SleepScoreConfig,
} from "../../../src/lib/metrics.ts";

// deno-lint-ignore no-explicit-any
type Client = any;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// data-de-acordar = data local de end_utc (via utc_offset_seconds). Igual à
// convenção do runner e do resto da app. Exportada para o chamador derivar o
// wake-day do sono ingerido (NÃO reutilizar a `date` da ingestão — no inverno,
// UTC+0, uma noite que acaba depois da meia-noite local tem wake-day ≠ date).
export function wakeDay(endUtc: string, offsetSeconds: number): string {
  const d = new Date(Date.parse(endUtc) + offsetSeconds * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

function addDaysISO(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

export interface ComputeResult {
  written: number;
  dates: string[];
  skipped_no_sleep: string[];
}

// Calcula (e faz upsert) do sleep_score para uma noite (opts.date) ou um
// intervalo de datas-de-acordar (opts.from..opts.to, inclusivo). Idempotente:
// upsert por (metric_type, date). Escreve também noites 'insufficient_data' com
// score null (a coluna é nullable) — uma noite péssima é sinalizada, não some.
export async function computeSleepScores(
  client: Client,
  opts: { date?: string; from?: string; to?: string },
): Promise<ComputeResult> {
  // Alvo: conjunto de datas-de-acordar pedidas.
  let from: string, to: string;
  if (opts.date) {
    if (!DATE_RE.test(opts.date)) throw new Error(`date inválida: "${opts.date}"`);
    from = opts.date; to = opts.date;
  } else if (opts.from && opts.to) {
    if (!DATE_RE.test(opts.from) || !DATE_RE.test(opts.to)) throw new Error(`from/to inválidos: "${opts.from}".."${opts.to}"`);
    if (opts.from > opts.to) throw new Error(`from > to: "${opts.from}" > "${opts.to}"`);
    from = opts.from; to = opts.to;
  } else {
    throw new Error("faltam parâmetros: ?date=YYYY-MM-DD ou ?from=&to=");
  }

  // 1. Config ativa (sleep_score + shared).
  const { data: cfgRows, error: cfgErr } = await client
    .schema("metrics").from("config")
    .select("metric_type, param_key, param_value, version")
    .is("valid_to", null)
    .in("metric_type", ["shared", "sleep_score"]);
  if (cfgErr) throw new Error(`ler metrics.config falhou: ${cfgErr.message}`);

  const p = new Map<string, number>();
  const versions: string[] = [];
  for (const r of cfgRows as Array<{ metric_type: string; param_key: string; param_value: number | string; version: string }>) {
    p.set(r.param_key, Number(r.param_value));
    if (r.metric_type === "sleep_score") versions.push(r.version);
  }
  const configVersion = versions.sort().at(-1) ?? "v?";
  const need = (k: string): number => {
    if (!p.has(k)) throw new Error(`config em falta: ${k}`);
    return p.get(k)!;
  };
  const cfg: SleepScoreConfig = {
    sleep_need_hours: need("sleep_need_hours"),
    weight_deep: need("weight_deep"),
    weight_fragmentation: need("weight_fragmentation"),
    weight_rem: need("weight_rem"),
    weight_latency: need("weight_latency"),
    min_duration_publish_hours: need("min_duration_publish_hours"),
    excessive_sleep_ratio: need("excessive_sleep_ratio"),
    merge_max_gap_hours: need("merge_max_gap_hours"),
    frag_anchor_0: need("frag_anchor_0"),
    frag_anchor_50: need("frag_anchor_50"),
    frag_anchor_100: need("frag_anchor_100"),
    deep_target_min: need("deep_target_min"),
    deep_target_max: need("deep_target_max"),
    deep_zero_below: need("deep_zero_below"),
    deep_zero_above: need("deep_zero_above"),
    rem_target_min: need("rem_target_min"),
    rem_target_max: need("rem_target_max"),
    rem_zero_below: need("rem_zero_below"),
    rem_zero_above: need("rem_zero_above"),
    latency_optimal_min_mins: need("latency_optimal_min_mins"),
    latency_optimal_max_mins: need("latency_optimal_max_mins"),
    latency_zero_below_mins: need("latency_zero_below_mins"),
    latency_zero_above_mins: need("latency_zero_above_mins"),
    latency_deprivation_mins: need("latency_deprivation_mins"),
    latency_poor_mins: need("latency_poor_mins"),
    deep_shift_per_sd: need("deep_shift_per_sd"),
    load_z_min: need("load_z_min"),
    load_z_max: need("load_z_max"),
    load_window_days: need("load_window_days"),
    score_min: need("score_min"),
    score_max: need("score_max"),
  };

  // 2. Ler sono numa janela larga o suficiente para conter as noites do alvo,
  //    e agrupar por data-de-acordar (uma noite cruza a meia-noite; o wake-day
  //    é o critério, não a data UTC do start).
  const winFrom = addDaysISO(from, -1);
  const winTo = addDaysISO(to, 2);
  const { data: sleepRows, error: slErr } = await client
    .schema("wearable").from("sleep")
    .select("start_utc, end_utc, utc_offset_seconds, stages")
    .gte("end_utc", winFrom)
    .lt("end_utc", winTo)
    .order("start_utc", { ascending: true });
  if (slErr) throw new Error(`ler wearable.sleep falhou: ${slErr.message}`);

  const byDay = new Map<string, RawSleepBlock[]>();
  for (const r of (sleepRows ?? []) as RawSleepBlock[]) {
    const d = wakeDay(r.end_utc, r.utc_offset_seconds);
    if (d < from || d > to) continue; // fora do alvo (apanhado só pela janela larga)
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d)!.push(r);
  }

  // 3. Calcular + upsert por noite.
  const rows: Array<Record<string, unknown>> = [];
  const dates: string[] = [];
  const skipped: string[] = [];
  const nowUtc = new Date().toISOString();

  // Itera sobre TODAS as datas pedidas; as sem sono ficam registadas em skipped.
  for (let dt = from; dt <= to; dt = addDaysISO(dt, 1).slice(0, 10)) {
    const blocks = byDay.get(dt);
    if (!blocks || blocks.length === 0) { skipped.push(dt); continue; }
    const r = getSleepScore(blocks, cfg, null); // loadZ null: training_load ainda não existe
    rows.push({
      date: dt,
      metric_type: "sleep_score",
      score: r.score,
      drivers: r.drivers,
      vs_baseline: null,
      confidence: r.confidence,
      context: r.context,
      computed_at_utc: nowUtc,
      config_version: configVersion,
    });
    dates.push(dt);
  }

  if (rows.length) {
    const { error: upErr } = await client
      .schema("metrics").from("daily_scores")
      .upsert(rows, { onConflict: "metric_type,date" });
    if (upErr) throw new Error(`upsert metrics.daily_scores falhou: ${upErr.message}`);
  }

  return { written: rows.length, dates, skipped_no_sleep: skipped };
}
