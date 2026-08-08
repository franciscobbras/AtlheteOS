// Sleep Regularity Index (SRI) IO para as Edge Functions (Deno) e para o runner
// de backfill (Node — este módulo não usa globais do Deno). A LÓGICA vive em
// src/lib/metrics.ts (getSRI), importada — fonte única, provada a correr em Deno.
//
// Guarda em metrics.daily_scores com metric_type = 'sri' (é o valor aceite pelo
// CHECK da tabela e o metric_type da config; a config está semeada como 'sri').
// O SRI de uma data depende dos window_days dias anteriores — lê-se a janela
// inteira, não só a noite nova.

import { getSRI, type RawSleepBlock, type SRIConfig } from "../../../src/lib/metrics.ts";

// deno-lint-ignore no-explicit-any
type Client = any;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const METRIC = "sri";

function addDaysISO(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}
function addDaysYMD(ymd: string, days: number): string {
  return addDaysISO(ymd, days).slice(0, 10);
}

export interface SRIComputeResult {
  written: number;
  published: string[];         // datas com SRI publicado
  insufficient: string[];      // datas escritas como insufficient_data
}

export async function computeSRI(
  client: Client,
  opts: { date?: string; from?: string; to?: string },
): Promise<SRIComputeResult> {
  let from: string, to: string;
  if (opts.date) {
    if (!DATE_RE.test(opts.date)) throw new Error(`date inválida: "${opts.date}"`);
    from = opts.date; to = opts.date;
  } else if (opts.from && opts.to) {
    if (!DATE_RE.test(opts.from) || !DATE_RE.test(opts.to)) throw new Error(`from/to inválidos`);
    if (opts.from > opts.to) throw new Error(`from > to`);
    from = opts.from; to = opts.to;
  } else {
    throw new Error("faltam parâmetros: ?date=YYYY-MM-DD ou ?from=&to=");
  }

  // 1. Config ativa do SRI.
  const { data: cfgRows, error: cfgErr } = await client
    .schema("metrics").from("config")
    .select("param_key, param_value, version")
    .is("valid_to", null)
    .eq("metric_type", "sri");
  if (cfgErr) throw new Error(`ler metrics.config (sri) falhou: ${cfgErr.message}`);

  const p = new Map<string, number>();
  const versions: string[] = [];
  for (const r of cfgRows as Array<{ param_key: string; param_value: number | string; version: string }>) {
    p.set(r.param_key, Number(r.param_value));
    versions.push(r.version);
  }
  const configVersion = versions.sort().at(-1) ?? "v?";
  const need = (k: string): number => {
    if (!p.has(k)) throw new Error(`config sri em falta: ${k}`);
    return p.get(k)!;
  };
  const cfg: SRIConfig = {
    epoch_seconds: need("epoch_seconds"),
    window_days: need("window_days"),
    waso_min_minutes: need("waso_min_minutes"),
    min_days: need("min_days"),
  };

  // 2. Ler sono a cobrir a união das janelas: [from - window_days - 1 .. to + 1).
  const winFrom = addDaysISO(from, -(cfg.window_days + 1));
  const winTo = addDaysISO(to, 1);
  const { data: sleepRows, error: slErr } = await client
    .schema("wearable").from("sleep")
    .select("start_utc, end_utc, utc_offset_seconds, stages")
    .gte("end_utc", winFrom)
    .lt("end_utc", winTo)
    .order("start_utc", { ascending: true });
  if (slErr) throw new Error(`ler wearable.sleep falhou: ${slErr.message}`);
  const blocks = (sleepRows ?? []) as RawSleepBlock[];

  // 3. Calcular por data-alvo + upsert. getSRI só amostra a sua janela, por isso
  //    passar todos os blocos é correto (os de fora não são amostrados).
  const rows: Array<Record<string, unknown>> = [];
  const published: string[] = [];
  const insufficient: string[] = [];
  const nowUtc = new Date().toISOString();

  for (let dt = from; dt <= to; dt = addDaysYMD(dt, 1)) {
    const r = getSRI(blocks, cfg, dt);
    rows.push({
      date: dt,
      metric_type: METRIC,
      score: r.score,
      drivers: r.drivers,
      vs_baseline: r.vs_baseline,
      confidence: r.confidence,
      context: r.context,
      computed_at_utc: nowUtc,
      config_version: configVersion,
    });
    if (r.context.status === "insufficient_data") insufficient.push(dt);
    else published.push(dt);
  }

  if (rows.length) {
    const { error: upErr } = await client
      .schema("metrics").from("daily_scores")
      .upsert(rows, { onConflict: "metric_type,date" });
    if (upErr) throw new Error(`upsert metrics.daily_scores (sri) falhou: ${upErr.message}`);
  }

  return { written: rows.length, published, insufficient };
}
