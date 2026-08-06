-- ============================================================
-- NEXUS — O cron marca o último tick de cada escada com &final=1
--
-- Antes: as funções adivinhavam "sou a última tentativa?" comparando
-- o relógio com constantes que replicavam o calendário do cron
-- (HR_FINAL_RETRY_MINUTE=30, SLEEP_FINAL_HOUR=12). Acoplamento oculto,
-- e partiu quando a escada passou a Europe/Lisbon mas a função lê UTC:
-- no verão as 12:00 de Lisboa são 11:00 UTC → a função nunca via a
-- "hora 12" → o último tick não se reconhecia → falhas não notificavam.
--
-- Agora: quem sabe qual é o último tick é o calendário. Cada escada
-- passa &final=1 apenas no seu último degrau; os restantes ficam iguais.
-- As funções apagaram toda a lógica de relógio e leem só ?final.
--
-- Escadas (o resto — base do HR e catch-ups — fica intocado):
--   · sono      : último degrau = Lisboa 12:00
--   · hrv/spo2  : último degrau = Lisboa 12:10 (10 min atrás do sono)
--   · HR retry  : último degrau = minuto :30 UTC (HR mantém-se em UTC)
-- ============================================================

do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'nexus-wearable-today';
  perform cron.unschedule(jobid) from cron.job where jobname = 'nexus-intraday-today';
  perform cron.unschedule(jobid) from cron.job where jobname = 'nexus-hr-intraday-retry';
end $$;

-- ── HOJE — sono + daily (final = Lisboa 12:00) ───────────────
select cron.schedule(
  'nexus-wearable-today',
  '0,20,40 7-12 * * *',
  $$
  do $guard$
  declare
    ts timestamp := now() at time zone 'Europe/Lisbon';
    t  time := ts::time;
    d  text := to_char(ts::date, 'YYYY-MM-DD');
  begin
    if t >= '08:00' and t < '12:00' then
      perform ops.trigger_edge_function('ingest-wearable?date=' || d);
    elsif t >= '12:00' and t < '12:01' then
      perform ops.trigger_edge_function('ingest-wearable?date=' || d || '&final=1');
    end if;
  end
  $guard$;
  $$
);

-- ── HOJE — HRV + SpO2 (final = Lisboa 12:10) ─────────────────
select cron.schedule(
  'nexus-intraday-today',
  '10,30,50 7-12 * * *',
  $$
  do $guard$
  declare
    ts timestamp := now() at time zone 'Europe/Lisbon';
    t  time := ts::time;
    d  text := to_char(ts::date, 'YYYY-MM-DD');
  begin
    if t >= '08:10' and t < '12:10' then
      perform ops.trigger_edge_function('ingest-intraday?series=hrv,spo2&date=' || d);
    elsif t >= '12:10' and t < '12:11' then
      perform ops.trigger_edge_function('ingest-intraday?series=hrv,spo2&date=' || d || '&final=1');
    end if;
  end
  $guard$;
  $$
);

-- ── HR retry (final = minuto :30 UTC) ────────────────────────
-- HR fica em UTC: a hora de parede é irrelevante para um watermark
-- forward-only. Só o último minuto da escada (:30) leva &final=1.
select cron.schedule(
  'nexus-hr-intraday-retry',
  '5,10,15,20,25,30 0,3,6,9,12,15,18,21 * * *',
  $$select ops.trigger_edge_function(
      'ingest-intraday?series=hr'
      || case when extract(minute from (now() at time zone 'utc'))::int = 30 then '&final=1' else '' end)$$
);

-- Verificação: conjunto final de jobs.
select jobname, schedule, active from cron.job order by jobname;
