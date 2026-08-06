-- ============================================================
-- NEXUS — Reconciliação intraday (T+24h e T+48h)
--
-- Motivo: a Fitbit continua a refinar uma noite durante horas e às vezes
-- só produz SpO2/HRV extra (ou uma noite inteira de SpO2) muito depois da
-- janela da manhã. A ingestão sempre foi idempotente (re-fetch + upsert =
-- puxar o que falta), mas só havia UMA passagem de recuperação no dia
-- seguinte. Esta troca-a por uma reconciliação que reprocessa os últimos
-- DOIS dias, apanhando backfills tardios que a passagem única perdia.
--
-- A função foi atualizada em paralelo para:
--   · reportar stored_before / stored_after / added (o "compara e puxa o
--     delta" fica visível na resposta), e
--   · fechar automaticamente o data_missing de (série, dia) assim que os
--     dados aparecem — o loop fecha-se sozinho.
--
-- Não leva &final=1: a reconciliação nunca escala ausência a notificação
-- (isso é o último tick da manhã); só preenche e resolve.
-- ============================================================

do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'nexus-intraday-catchup';
end $$;

select cron.schedule(
  'nexus-intraday-reconcile',
  '20 13 * * *',
  $$
  do $rec$
  declare
    d text;
  begin
    foreach d in array array[
      to_char((now() at time zone 'Europe/Lisbon')::date - 1, 'YYYY-MM-DD'),  -- T+~24h
      to_char((now() at time zone 'Europe/Lisbon')::date - 2, 'YYYY-MM-DD')   -- T+~48h
    ] loop
      perform ops.trigger_edge_function('ingest-intraday?series=hrv,spo2&date=' || d);
    end loop;
  end
  $rec$;
  $$
);

select jobname, schedule, active from cron.job order by jobname;
