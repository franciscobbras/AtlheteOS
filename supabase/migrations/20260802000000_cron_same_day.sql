-- ============================================================
-- NEXUS — Cron passa a puxar os dados do PRÓPRIO DIA
--
-- Motivo: a readiness do dia D precisa do sono + agregados diários
-- (resting_hr, daily_hrv_rmssd, temperatura) e do HRV/SpO2 da noite
-- que se acordou nessa manhã. O agendamento anterior apontava para
-- "ontem" (dados garantidamente completos), o que introduzia um lag
-- de ~1 dia e impedia calcular readiness no próprio dia.
--
-- Verificado antes de mudar: fuso do utilizador = UTC+1, acorda por
-- volta das ~07-08h UTC, e `ingest-wearable?date=D` / `ingest-intraday
-- ?date=D` devolvem a noite que ACABA (se acorda) no dia D. Como as
-- corridas são de manhã (08-13h UTC), a data UTC == data local, sem
-- problemas de meia-noite.
--
-- Estratégia:
--   · Escada de retries de manhã, a apontar para HOJE — porque os
--     dados de hoje podem ainda não estar na API às 08:00 (latência
--     de batch da Google + sync do relógio). Os retries (idempotentes)
--     apanham-nos assim que aparecem.
--   · Ordem: ingest-wearable (sono+daily) corre :00/:30; o HRV/SpO2
--     corre :10/:40, 10 min depois — o HRV/SpO2 depende do sono já
--     estar ingerido. Se ainda não estiver, faz no-op e apanha no tick
--     seguinte (tolerante a ordem).
--   · Rede de segurança: uma corrida às 13:00 UTC a apontar para
--     ONTEM, para nunca perder uma noite em que o pull do próprio dia
--     tenha falhado por completo (ex.: relógio sincronizou tarde).
--
-- Os jobs de HR (nexus-hr-intraday*) NÃO são tocados — o HR é forward-
-- only e já puxa o fluxo recente de 3 em 3h.
-- ============================================================

-- Remover os 4 jobs antigos (apontavam para "ontem" via default da função).
do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'nexus-sleep-daily';
  perform cron.unschedule(jobid) from cron.job where jobname = 'nexus-hrv-spo2-early';
  perform cron.unschedule(jobid) from cron.job where jobname = 'nexus-hrv-spo2-retry';
  perform cron.unschedule(jobid) from cron.job where jobname = 'nexus-hrv-spo2-final';
end $$;

-- ── HOJE — sono + agregados diários ──────────────────────────
-- :00 e :30, de hora 8 a 12 UTC (09:00-13:30 local). Idempotente:
-- assim que hoje entra, os ticks seguintes são upserts sem efeito.
select cron.schedule(
  'nexus-wearable-today',
  '0,30 8-12 * * *',
  $$select ops.trigger_edge_function('ingest-wearable?date=' || to_char((now() at time zone 'utc')::date, 'YYYY-MM-DD'))$$
);

-- ── HOJE — HRV + SpO2 ────────────────────────────────────────
-- :10 e :40 (10 min depois do sono), mesmas horas. O último tick
-- cai às 12:40 UTC — hora 12 == SLEEP_FINAL_HOUR no código, por isso
-- se o HRV/SpO2 continuar vazio a essa hora dispara data_missing.
select cron.schedule(
  'nexus-intraday-today',
  '10,40 8-12 * * *',
  $$select ops.trigger_edge_function('ingest-intraday?series=hrv,spo2&date=' || to_char((now() at time zone 'utc')::date, 'YYYY-MM-DD'))$$
);

-- ── REDE DE SEGURANÇA — ontem, uma vez ───────────────────────
-- Se o pull do próprio dia falhou de todo, apanha-se a noite no dia
-- seguinte às 13:00 UTC. Não re-notifica (hora 13 ≠ 12); o aviso de
-- data_missing, se aplicável, já terá sido criado ao meio-dia do dia
-- em que a noite era "hoje".
select cron.schedule(
  'nexus-wearable-catchup',
  '0 13 * * *',
  $$select ops.trigger_edge_function('ingest-wearable?date=' || to_char((now() at time zone 'utc')::date - 1, 'YYYY-MM-DD'))$$
);

select cron.schedule(
  'nexus-intraday-catchup',
  '10 13 * * *',
  $$select ops.trigger_edge_function('ingest-intraday?series=hrv,spo2&date=' || to_char((now() at time zone 'utc')::date - 1, 'YYYY-MM-DD'))$$
);

-- Verificação: confirmar o conjunto final de jobs.
select jobname, schedule, active from cron.job order by jobname;
