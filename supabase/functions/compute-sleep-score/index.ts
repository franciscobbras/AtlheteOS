// HTTP handler da Edge Function compute-sleep-score.
//
// Calcula o sleep_score no servidor e faz upsert em metrics.daily_scores.
//   ?date=YYYY-MM-DD          → uma noite (data-de-acordar)
//   ?from=YYYY-MM-DD&to=...    → intervalo (recompute), inclusivo
//
// Idempotente: correr duas vezes sobre a mesma noite dá o mesmo resultado e não
// duplica linha (upsert por metric_type,date). A lógica do score vive em
// src/lib/metrics.ts; aqui é só o transporte HTTP + o IO (via _shared).

import { createClient } from "npm:@supabase/supabase-js@2";
import { computeSleepScores } from "../_shared/sleep-score.ts";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const date = url.searchParams.get("date") ?? undefined;
  const from = url.searchParams.get("from") ?? undefined;
  const to = url.searchParams.get("to") ?? undefined;

  if (!date && !(from && to)) {
    return json({ ok: false, error: "faltam parâmetros: ?date=YYYY-MM-DD ou ?from=&to=" }, 400);
  }

  const client = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  try {
    const result = await computeSleepScores(client, { date, from, to });
    return json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[compute-sleep-score] falha: ${message}`);
    return json({ ok: false, error: message }, 500);
  }
});
