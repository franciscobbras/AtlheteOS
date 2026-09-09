// HTTP handler da Edge Function compute-divergence.
//
// Calcula a divergência objetivo↔subjetivo e faz upsert em metrics.daily_scores.
//   ?series=sleep              → par (default: sleep = sleep_score↔sleep_perceived)
//   ?date=YYYY-MM-DD           → uma data
//   ?from=YYYY-MM-DD&to=...    → intervalo (recompute/backfill), inclusivo
//   (sem date/from/to)         → backfill completo (1º check-in → último dia com dados)
//
// Idempotente: upsert por (metric_type, date). Escreve UMA linha por data-alvo,
// incluindo insufficient_data (um dia sem check-in conta na série). A lógica vive
// em src/lib/metrics.ts; aqui é só transporte HTTP + IO (via _shared).

import { createClient } from "npm:@supabase/supabase-js@2";
import { computeDivergence } from "../_shared/divergence.ts";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const series = url.searchParams.get("series") ?? undefined;
  const date = url.searchParams.get("date") ?? undefined;
  const from = url.searchParams.get("from") ?? undefined;
  const to = url.searchParams.get("to") ?? undefined;

  const client = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  try {
    const result = await computeDivergence(client, { series, date, from, to });
    return json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[compute-divergence] falha: ${message}`);
    return json({ ok: false, error: message }, 500);
  }
});
