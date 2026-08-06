-- ============================================================
-- NEXUS — Cron do próprio dia ancorado à hora de parede de Lisboa
--
-- Corrige a migração anterior (20260802000000): aquela usava horas
-- UTC fixas e uma cadência de 30 min que era mais grosseira do que a
-- escada fina que já existia. Esta repõe a escada fina e ancora-a à
-- hora LOCAL (Europe/Lisbon), que é o que interessa para a readiness.
--
-- pg_cron corre sempre em UTC e não sabe de fusos/DST. Padrão usado:
--   1. Agendar a UNIÃO das janelas UTC que podem corresponder à janela
--      local pretendida nas duas estações:
--        Lisboa 08:00–12:00  →  verão (WEST, UTC+1): 07:00–11:00 UTC
--                                inverno (WET, UTC+0): 08:00–12:00 UTC
--        união = horas UTC 7..12.
--   2. GUARD dentro do comando: só dispara de facto o pull quando a
--      hora de parede em Europe/Lisbon está mesmo dentro da janela.
--      Assim o DST trata-se sozinho — em verão o degrau UTC 12:xx cai
--      fora (Lisboa 13:xx) e é bloqueado; em inverno o degrau UTC 07:xx
--      cai fora (Lisboa 07:xx) e é bloqueado.
--
-- Escada:
--   · Sono (ingest-wearable): degraus de 20 min, Lisboa 08:00→12:00.
--   · HRV/SpO2 (ingest-intraday): 10 min ATRÁS de cada degrau do sono
--     (Lisboa 08:10→12:10) — o HRV/SpO2 depende do sono já ingerido.
--   · Intercalados, corre algo de 10 em 10 min (fina), sem colisão no
--     mesmo minuto.
--   · A data alvo é a data LOCAL de Lisboa (durante a manhã, coincide
--     com o dia da noite que se acordou).
--
-- O último degrau de HRV/SpO2 é 12:10 Lisboa (hora local 12), que é o
-- que a função usa (lisbonHour === 12) para disparar data_missing.
--
-- HR fica INTOCADO e em UTC — para um watermark forward-only a hora de
-- parede é irrelevante.
-- ============================================================

-- Remover os jobs da migração anterior (mantém os de HR).
do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'nexus-wearable-today';
  perform cron.unschedule(jobid) from cron.job where jobname = 'nexus-intraday-today';
  perform cron.unschedule(jobid) from cron.job where jobname = 'nexus-wearable-catchup';
  perform cron.unschedule(jobid) from cron.job where jobname = 'nexus-intraday-catchup';
end $$;

-- ── HOJE — sono + agregados diários ──────────────────────────
-- União UTC: minutos 0,20,40 das horas 7..12. Guard: hora local de
-- Lisboa entre 08:00 e 12:00.
select cron.schedule(
  'nexus-wearable-today',
  '0,20,40 7-12 * * *',
  $$
  do $guard$
  begin
    if (now() at time zone 'Europe/Lisbon')::time between '08:00' and '12:00' then
      perform ops.trigger_edge_function(
        'ingest-wearable?date=' || to_char((now() at time zone 'Europe/Lisbon')::date, 'YYYY-MM-DD'));
    end if;
  end
  $guard$;
  $$
);

-- ── HOJE — HRV + SpO2, 10 min atrás do sono ──────────────────
-- União UTC: minutos 10,30,50 das horas 7..12. Guard: hora local
-- entre 08:10 e 12:10.
select cron.schedule(
  'nexus-intraday-today',
  '10,30,50 7-12 * * *',
  $$
  do $guard$
  begin
    if (now() at time zone 'Europe/Lisbon')::time between '08:10' and '12:10' then
      perform ops.trigger_edge_function(
        'ingest-intraday?series=hrv,spo2&date=' || to_char((now() at time zone 'Europe/Lisbon')::date, 'YYYY-MM-DD'));
    end if;
  end
  $guard$;
  $$
);

-- ── REDE DE SEGURANÇA — ontem (local), uma vez ───────────────
-- 13:00/13:10 UTC = Lisboa 13:xx (inverno) / 14:xx (verão), sempre
-- depois da janela da manhã. Apanha uma noite que o pull do próprio
-- dia tenha falhado por completo. Sem guard — corre uma vez por dia.
select cron.schedule(
  'nexus-wearable-catchup',
  '0 13 * * *',
  $$select ops.trigger_edge_function('ingest-wearable?date=' || to_char((now() at time zone 'Europe/Lisbon')::date - 1, 'YYYY-MM-DD'))$$
);

select cron.schedule(
  'nexus-intraday-catchup',
  '10 13 * * *',
  $$select ops.trigger_edge_function('ingest-intraday?series=hrv,spo2&date=' || to_char((now() at time zone 'Europe/Lisbon')::date - 1, 'YYYY-MM-DD'))$$
);

-- Verificação: conjunto final de jobs.
select jobname, schedule, active from cron.job order by jobname;
