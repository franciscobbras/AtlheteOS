// Thin HTTP handler for the ingest-wearable Edge Function.
//
// Responsibilities kept here (and out of ingest()):
//   - resolve the target date (?date=YYYY-MM-DD, else yesterday UTC)
//   - read secrets from the Vault (service_role)
//   - run ingest()
//   - persist a rotated refresh token back to the Vault, if any
//   - shape the JSON response and map errors
//
// The same code runs unchanged in phase 2 (pg_cron just hits this URL).

import { createClient } from "npm:@supabase/supabase-js@2";
import { ingest } from "./ingest.ts";
import { readGoogleSecrets, writeSecret } from "./vault.ts";
import { ReauthRequiredError } from "./google.ts";
import { notifyOnce } from "../_shared/notify.ts";
import { computeSleepScores, wakeDay } from "../_shared/sleep-score.ts";
import { computeSRI } from "../_shared/sri.ts";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function yesterdayUtc(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const dateParam = url.searchParams.get("date");
  const date = dateParam ?? yesterdayUtc();
  const dryRun = url.searchParams.get("dryRun") === "true";
  // final: set by the cron on the LAST tick of the sleep/daily retry ladder.
  // Only a final tick escalates a failure; earlier ticks self-heal on retry.
  // reauth is exempt (always fires). The daily schedule is now a morning ladder,
  // not a once/day shot, so an unconditional alert would fire on every tick.
  const finalParam = url.searchParams.get("final");
  const isFinal = finalParam === "1" || finalParam === "true";

  if (dateParam && !DATE_RE.test(dateParam)) {
    return json({ ok: false, error: `date inválida: "${dateParam}" (esperado YYYY-MM-DD)` }, 400);
  }

  const client = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  try {
    const secrets = await readGoogleSecrets(client);
    const result = await ingest(date, secrets, client, dryRun);

    // Persist a rotated refresh token even on dryRun: the refresh already happened,
    // so skipping this would strand the new token and break the next call.
    let refreshTokenRotated = false;
    if (result.rotatedRefreshToken) {
      await writeSecret(client, "google_refresh_token", result.rotatedRefreshToken);
      refreshTokenRotated = true;
    }

    // Sono novo ingerido com sucesso → calcular o sleep score já, para a manhã
    // ter score sem esperar por um cron separado. Só quando HÁ sono de facto
    // (não em cada tick da escada de retry) e nunca em dryRun.
    //
    // O wake-day é derivado do end_utc do PRÓPRIO sono, não da `date` da
    // ingestão: no inverno (UTC+0) uma noite que acaba depois da meia-noite
    // local tem wake-day ≠ date, e reutilizar a `date` calcularia a noite errada.
    //
    // Isolado em try/catch: o sono já está gravado; se o cálculo falhar, é
    // recomputável depois (via compute-sleep-score ou o runner) e NÃO pode
    // partir a ingestão. Uma falha terminal vai para ops.notifications.
    let sleepScore: { written: number; dates: string[] } | null = null;
    let sri: { written: number; published: string[] } | null = null;
    if (!dryRun && result.sleep && result.sleepEndUtc) {
      const wd = wakeDay(result.sleepEndUtc, result.sleepUtcOffsetSeconds ?? 0);
      try {
        const sc = await computeSleepScores(client, { date: wd });
        sleepScore = { written: sc.written, dates: sc.dates };
      } catch (scoreErr) {
        const m = scoreErr instanceof Error ? scoreErr.message : String(scoreErr);
        console.error(`[ingest-wearable] cálculo do sleep score falhou (sono já ingerido, wake-day ${wd}): ${m}`);
        await notifyOnce(client, {
          type: "metric_computation_failure",
          severity: "error",
          title: "Cálculo do sleep score falhou",
          detail: m,
          context: { wake_day: wd, ingest_date: date, metric: "sleep_score" },
          dedupeKey: `metric_computation_failure:sleep_score:${wd}`,
        }).catch((e) => console.error(`[ingest-wearable] falha ao gravar notificação: ${e}`));
      }
      // SRI: métrica autónoma da janela de 14 dias que TERMINA nesta noite —
      // depende dos 14 dias anteriores, por isso computeSRI lê a janela inteira.
      // Isolada em try/catch próprio: falhar aqui não afeta o sleep score nem a
      // ingestão (o sono já está gravado; é recomputável).
      try {
        const sr = await computeSRI(client, { date: wd });
        sri = { written: sr.written, published: sr.published };
      } catch (sriErr) {
        const m = sriErr instanceof Error ? sriErr.message : String(sriErr);
        console.error(`[ingest-wearable] cálculo do SRI falhou (sono já ingerido, wake-day ${wd}): ${m}`);
        await notifyOnce(client, {
          type: "metric_computation_failure",
          severity: "error",
          title: "Cálculo do SRI falhou",
          detail: m,
          context: { wake_day: wd, ingest_date: date, metric: "sri" },
          dedupeKey: `metric_computation_failure:sri:${wd}`,
        }).catch((e) => console.error(`[ingest-wearable] falha ao gravar notificação: ${e}`));
      }
    }

    return json({
      ok: true,
      date: result.date,
      dry_run: result.dryRun,
      [result.dryRun ? "would_write" : "written"]: {
        daily_metrics: result.dailyMetrics,
        sleep: result.sleep,
      },
      ...(result.preview ? { preview: result.preview } : {}),
      refresh_token_rotated: refreshTokenRotated,
      ...(sleepScore ? { sleep_score: sleepScore } : {}),
      ...(sri ? { sri } : {}),
    });
  } catch (err) {
    if (err instanceof ReauthRequiredError) {
      console.error(`[ingest-wearable] ${err.message}`);
      await notifyOnce(client, {
        type: "reauth_required",
        severity: "error",
        title: "Google Health token expirado — reautenticação necessária",
        detail: err.message,
        dedupeKey: "reauth_required",
      }).catch((e) => console.error(`[ingest-wearable] falha ao gravar notificação: ${e}`));
      return json({ ok: false, error: err.message, action: "re-autenticar Google e atualizar google_refresh_token no Vault" }, 401);
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[ingest-wearable] falha: ${message}`);

    // Only the schedule's final tick (?final=1) escalates a failure. Earlier
    // ticks of the morning ladder stay silent so a transient error that clears
    // on a later retry never raises a false alarm.
    if (!dryRun && isFinal) {
      await notifyOnce(client, {
        type: "ingestion_failure",
        severity: "error",
        title: "Ingestão diária (sono + agregados) falhou",
        detail: message,
        context: { date },
        dedupeKey: `ingestion_failure:wearable:${date}`,
      }).catch((e) => console.error(`[ingest-wearable] falha ao gravar notificação: ${e}`));
    }

    return json({ ok: false, error: message }, 500);
  }
});
