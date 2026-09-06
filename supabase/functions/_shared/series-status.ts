// Critério ÚNICO de "dados completos" para o data_missing.
//
// Antes cada edge function contava pontos por conta própria e considerava
// completo se entrasse ≥1 ponto — uma noite truncada (13 pontos vs ~96) passava
// por completa. A verdade passa a ser da base: wearable.series_status(dia, série)
// devolve (complete, points, expected, ratio) com o critério duração/5min ≥50%.
// Assim a edge function e o job de reconciliação da base usam o MESMO critério.

import { notifyOnce, resolveByDedupe } from "./notify.ts";

// deno-lint-ignore no-explicit-any
type Client = any;

export interface SeriesStatus { complete: boolean; points: number; expected: number; ratio: number; }

// Rótulos legíveis por série / metric_type, para os títulos das notificações.
// (As CHAVES — usadas em context.series e no dedupe_key — mantêm-se cruas.)
const LABELS: Record<string, string> = {
  sleep: "sono",
  hrv: "HRV",
  spo2: "SpO2",
  daily_hrv_rmssd: "HRV diário",
  resting_hr: "FC de repouso",
  temp_nightly: "temperatura",
};
const labelOf = (series: string) => LABELS[series] ?? series;

export async function seriesStatus(client: Client, day: string, series: string): Promise<SeriesStatus> {
  // Chamada de 2 args → p_days usa o default da base (60 dias). Chega para a
  // reconciliação (só toca em D-1/D-2). Um dia mais velho que 60 viria como
  // complete=true; se um dia for preciso verificar histórico antigo, passar p_days.
  const { data, error } = await client.schema("wearable").rpc("series_status", { p_day: day, p_series: series });
  if (error) throw new Error(`series_status(${day}, ${series}) falhou: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error(`series_status(${day}, ${series}) sem resultado`);
  return {
    complete: !!row.complete,
    points: Number(row.points),
    expected: Number(row.expected),
    ratio: Number(row.ratio),
  };
}

/**
 * Uma notificação data_missing por ITEM (nunca por grupo). Por cada série:
 *   · dia corrente (ou futuro) → não avalia (a noite ainda pode encher à tarde;
 *     o critério da base só considera D-1 para trás)
 *   · complete=false → emite SÓ na tentativa final da manhã (&final=1); as
 *     tentativas intermédias e as de reconciliação calam-se (senão eram dezenas
 *     de alertas por noite falhada)
 *   · complete=true  → resolve qualquer data_missing aberta desse item/dia
 *     (fecha-se sozinha assim que os dados chegam, em qualquer tick)
 * Série que a base não modele (series_status falha) → ignora, nunca alarma.
 */
export async function reconcileDataMissing(
  client: Client,
  opts: { day: string; series: string[]; isFinal: boolean; todayLocal: string },
): Promise<SeriesStatus[]> {
  const out: SeriesStatus[] = [];
  if (opts.day >= opts.todayLocal) return out; // só D-1 para trás
  for (const series of opts.series) {
    let st: SeriesStatus;
    try {
      st = await seriesStatus(client, opts.day, series);
    } catch (e) {
      // NÃO engolir em silêncio. Um erro sistémico (42501 permission denied,
      // função em falta, base em baixo) tornaria o data_missing inerte e
      // INVISÍVEL — o mesmo modo de falha dos "trinta alertas". Sobe a
      // ops.notifications, deduplicado por dia (uma enquanto aberta), para ser
      // visível em vez de só um console.error que ninguém lê.
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[data_missing] series_status falhou (${series}, ${opts.day}): ${msg}`);
      await notifyOnce(client, {
        type: "ingestion_failure",
        severity: "error",
        title: "Verificação de completude (series_status) falhou",
        detail: `${series}/${opts.day}: ${msg}`,
        context: { day: opts.day, series, check: "series_status" },
        dedupeKey: `series_status_error:${opts.day}`,
      }).catch((e2) => console.error(`[data_missing] notificar erro de series_status falhou: ${e2}`));
      continue;
    }
    out.push(st);
    const dedupeKey = `data_missing:${series}:${opts.day}`;
    if (st.complete) {
      await resolveByDedupe(client, "data_missing", dedupeKey)
        .catch((e) => console.error(`[data_missing] resolver falhou: ${e}`));
    } else if (opts.isFinal) {
      await notifyOnce(client, {
        type: "data_missing",
        severity: "warning",
        title: `Dados de ${labelOf(series)} em falta para ${opts.day}`,
        detail: `entraram ${st.points} de ~${st.expected}`,
        context: { day: opts.day, series, points: st.points, expected: st.expected },
        dedupeKey,
      }).catch((e) => console.error(`[data_missing] notificar falhou: ${e}`));
    }
  }
  return out;
}

/** Data local de Lisboa (YYYY-MM-DD) — a fronteira do "dia corrente" do guard. */
export function lisbonToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Lisbon" });
}
