// Divergência objetivo↔subjetivo — IO para as Edge Functions (Deno). A LÓGICA
// NÃO vive aqui: getDivergence é importado, sem alterações, de src/lib/metrics.ts
// (fonte única, tal como o sleep-score e o SRI). Aqui só há IO: ler config, ler a
// série objetiva (metrics.daily_scores) e a subjetiva (subjective.morning_checkin),
// alinhar por data, correr getDivergence e upsert em metrics.daily_scores.
//
// Hoje só o par SONO: objetivo = sleep_score (0-100), subjetivo = sleep_perceived
// (0-10). A estrutura já prevê 'readiness' (readiness↔recovery_feeling) — quando
// existir a série objetiva de readiness, acrescenta-se uma entrada em SERIES.

import { getDivergence, type DivergenceConfig, type DivergenceDay } from "../../../src/lib/metrics.ts";

// deno-lint-ignore no-explicit-any
type Client = any;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Definição de um par objetivo↔subjetivo.
interface SeriesDef {
  metricType: string;        // metric_type a escrever (ex.: 'divergence_sleep')
  objMetricType: string;     // metric_type da série objetiva em daily_scores
  subColumn: string;         // coluna subjetiva em morning_checkin
}
const SERIES: Record<string, SeriesDef> = {
  sleep: { metricType: "divergence_sleep", objMetricType: "sleep_score", subColumn: "sleep_perceived" },
  // readiness: { metricType: "divergence_readiness", objMetricType: "readiness", subColumn: "recovery_feeling" },
};

function addDaysISO(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// wake-day = data local de end_utc (via offset). Mesma convenção do sleep-score.
function wakeDay(endUtc: string, offsetSeconds: number): string {
  const d = new Date(Date.parse(endUtc) + offsetSeconds * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export interface ComputeDivergenceResult {
  series: string;
  written: number;
  ok: number;
  insufficient: number;
  from: string;
  to: string;
  values: Array<{ date: string; score: number | null; status: string }>;
}

// Calcula (e faz upsert) da divergência para uma data (opts.date), um intervalo
// (opts.from..opts.to) ou — sem parâmetros — todo o histórico com significado
// (do 1º check-in ao último dia com dados). ESCREVE UMA LINHA POR DATA do alvo,
// mesmo insufficient_data (dia sem check-in conta na série). Idempotente: upsert
// por (metric_type, date).
export async function computeDivergence(
  client: Client,
  opts: { series?: string; date?: string; from?: string; to?: string },
): Promise<ComputeDivergenceResult> {
  const seriesKey = opts.series ?? "sleep";
  const def = SERIES[seriesKey];
  if (!def) throw new Error(`série de divergência desconhecida: "${seriesKey}"`);

  // 1. Config ativa: divergência + fiabilidade do check-in (para o gate).
  const { data: cfgRows, error: cfgErr } = await client
    .schema("metrics").from("config")
    .select("metric_type, param_key, param_value, version")
    .is("valid_to", null)
    .in("metric_type", ["divergence", "checkin_reliability"]);
  if (cfgErr) throw new Error(`ler metrics.config falhou: ${cfgErr.message}`);

  const p = new Map<string, number>();  // divergence
  const rel = new Map<string, number>(); // checkin_reliability
  const versions: string[] = [];
  for (const r of cfgRows as Array<{ metric_type: string; param_key: string; param_value: number | string; version: string }>) {
    if (r.metric_type === "checkin_reliability") { rel.set(r.param_key, Number(r.param_value)); continue; }
    p.set(r.param_key, Number(r.param_value));
    versions.push(r.version);
  }
  const configVersion = versions.sort().at(-1) ?? "v?";
  const need = (k: string): number => {
    if (!p.has(k)) throw new Error(`config em falta: divergence.${k}`);
    return p.get(k)!;
  };
  const cfg: DivergenceConfig = {
    janela_dias: need("janela_dias"),
    dias_minimos: need("dias_minimos"),
    dias_minimos_di: need("dias_minimos_di"),
    min_dias_diferenca: need("min_dias_diferenca"),
    sd_minimo_subjetivo: need("sd_minimo_subjetivo"),
    sd_minimo_objetivo: need("sd_minimo_objetivo"),
    sd_minimo_diferenca: need("sd_minimo_diferenca"),
    limiar_divergencia: need("limiar_divergencia"),
    fiabilidade_minima: need("fiabilidade_minima"),
  };
  const N = cfg.janela_dias;

  // Params da fiabilidade (mesma curva do ecrã de check-in). Se faltarem, o gate
  // fica inerte (reliability=null → fail-open) — não parte por causa disso.
  const relParams = (rel.has("grace_hours") && rel.has("half_life_hours") && rel.has("floor"))
    ? { grace: rel.get("grace_hours")!, halfLife: rel.get("half_life_hours")!, floor: rel.get("floor")! }
    : null;

  // 2. Determinar o intervalo-alvo [from..to].
  let from: string, to: string;
  if (opts.date) {
    if (!DATE_RE.test(opts.date)) throw new Error(`date inválida: "${opts.date}"`);
    from = opts.date; to = opts.date;
  } else if (opts.from && opts.to) {
    if (!DATE_RE.test(opts.from) || !DATE_RE.test(opts.to)) throw new Error(`from/to inválidos`);
    if (opts.from > opts.to) throw new Error(`from > to`);
    from = opts.from; to = opts.to;
  } else {
    // Backfill completo: do 1º check-in ao último dia com sleep_score OU check-in.
    const [{ data: ci }, { data: ss }] = await Promise.all([
      client.schema("subjective").from("morning_checkin").select("date").order("date", { ascending: true }).limit(1),
      client.schema("metrics").from("daily_scores").select("date").eq("metric_type", def.objMetricType).order("date", { ascending: false }).limit(1),
    ]);
    const firstCheckin: string | undefined = ci?.[0]?.date;
    if (!firstCheckin) return { series: def.metricType, written: 0, ok: 0, insufficient: 0, from: "", to: "", values: [] };
    const [{ data: ciMax }] = await Promise.all([
      client.schema("subjective").from("morning_checkin").select("date").order("date", { ascending: false }).limit(1),
    ]);
    const lastCheckin: string | undefined = ciMax?.[0]?.date;
    const lastScore: string | undefined = ss?.[0]?.date;
    from = firstCheckin;
    to = [lastCheckin, lastScore].filter(Boolean).sort().at(-1) as string;
  }

  // 3. Ler ambas as séries numa janela larga: cada d_i da janela precisa do seu
  //    baseline de N dias anteriores → profundidade = 2·N − 1 antes de `from`.
  const winFrom = addDaysISO(from, -(2 * N - 1));

  // sono lido numa janela ligeiramente mais larga (o wake-day de uma noite que
  // acaba depois da meia-noite pode cair no dia seguinte ao end_utc).
  const sleepFrom = addDaysISO(winFrom, -1) + "T00:00:00Z";
  const sleepTo = addDaysISO(to, 2) + "T00:00:00Z";

  const [{ data: objRows, error: objErr }, { data: subRows, error: subErr }, { data: sleepRows, error: slErr }] = await Promise.all([
    client.schema("metrics").from("daily_scores")
      .select("date, score").eq("metric_type", def.objMetricType)
      .gte("date", winFrom).lte("date", to),
    client.schema("subjective").from("morning_checkin")
      .select(`date, logged_at_utc, utc_offset_seconds, ${def.subColumn}`)
      .gte("date", winFrom).lte("date", to),
    client.schema("wearable").from("sleep")
      .select("start_utc, end_utc, utc_offset_seconds")
      .gte("end_utc", sleepFrom).lt("end_utc", sleepTo),
  ]);
  if (objErr) throw new Error(`ler série objetiva falhou: ${objErr.message}`);
  if (subErr) throw new Error(`ler morning_checkin falhou: ${subErr.message}`);
  if (slErr) throw new Error(`ler wearable.sleep falhou: ${slErr.message}`);

  const objByDate = new Map<string, number | null>();
  for (const r of (objRows ?? []) as Array<{ date: string; score: number | null }>) objByDate.set(r.date, r.score);

  // Hora de acordar por wake-day = end_utc do bloco de sono MAIS LONGO (sono
  // principal, não sesta) — mesma regra do ecrã de check-in.
  const wakeEndByDay = new Map<string, { end: string; dur: number }>();
  for (const s of (sleepRows ?? []) as Array<{ start_utc: string; end_utc: string; utc_offset_seconds: number }>) {
    const wd = wakeDay(s.end_utc, s.utc_offset_seconds);
    const dur = Date.parse(s.end_utc) - Date.parse(s.start_utc);
    const cur = wakeEndByDay.get(wd);
    if (!cur || dur > cur.dur) wakeEndByDay.set(wd, { end: s.end_utc, dur });
  }

  // Fiabilidade do check-in: floor + (1−floor)·2^(−excesso/half_life), excesso em
  // horas desde grace após acordar. null se faltarem params ou a hora de acordar.
  function reliabilityOf(date: string, loggedAtUtc: string | null): number | null {
    if (!relParams || !loggedAtUtc) return null;
    const wake = wakeEndByDay.get(date);
    if (!wake) return null;
    const latMin = (Date.parse(loggedAtUtc) - Date.parse(wake.end)) / 60000;
    const excesso = Math.max(0, latMin / 60 - relParams.grace);
    return relParams.floor + (1 - relParams.floor) * Math.pow(2, -excesso / relParams.halfLife);
  }

  const subByDate = new Map<string, { sub: number | null; rel: number | null }>();
  for (const r of (subRows ?? []) as Array<Record<string, unknown>>) {
    const v = r[def.subColumn];
    const date = r.date as string;
    subByDate.set(date, {
      sub: v == null ? null : Number(v),
      rel: reliabilityOf(date, (r.logged_at_utc as string) ?? null),
    });
  }

  // Série alinhada por data em toda a janela.
  const days: DivergenceDay[] = [];
  for (let dt = winFrom; dt <= to; dt = addDaysISO(dt, 1)) {
    const s = subByDate.get(dt);
    days.push({ date: dt, obj: objByDate.get(dt) ?? null, sub: s?.sub ?? null, sub_reliability: s?.rel ?? null });
  }

  // 4. Calcular + upsert por data-alvo (todas, incluindo insufficient_data).
  const rows: Array<Record<string, unknown>> = [];
  const values: ComputeDivergenceResult["values"] = [];
  const nowUtc = new Date().toISOString();
  for (let dt = from; dt <= to; dt = addDaysISO(dt, 1)) {
    const r = getDivergence(days, cfg, dt);
    rows.push({
      date: dt,
      metric_type: def.metricType,
      score: r.score,
      drivers: r.drivers,
      vs_baseline: null,
      confidence: r.confidence,
      context: r.context,
      computed_at_utc: nowUtc,
      config_version: configVersion,
    });
    values.push({ date: dt, score: r.score, status: r.context.status });
  }

  if (rows.length) {
    const { error: upErr } = await client
      .schema("metrics").from("daily_scores")
      .upsert(rows, { onConflict: "metric_type,date" });
    if (upErr) throw new Error(`upsert metrics.daily_scores falhou: ${upErr.message}`);
  }

  const ok = values.filter((v) => v.status === "ok").length;
  return {
    series: def.metricType,
    written: rows.length, ok, insufficient: rows.length - ok,
    from, to, values,
  };
}
