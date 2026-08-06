-- ============================================================
-- NEXUS — TAREFA 2: pg_cron
--
-- PRÉ-REQUISITOS (fazer ANTES de aplicar esta migração):
--
-- 1. Ativar as extensões pg_cron e pg_net, se ainda não estiverem.
--    Se o CREATE EXTENSION abaixo falhar por permissões, ativa-as
--    pelo Dashboard: Database → Extensions → procurar "pg_cron"
--    e "pg_net" → Enable.
--
-- 2. Voltar a exigir JWT na função (estava com verify_jwt=false,
--    o que deixava o endpoint aberto a qualquer pedido HTTP sem
--    autenticação — tolerável enquanto só invocavas à mão, não
--    agora que fica num cron autónomo e público):
--      npx supabase functions deploy ingest-wearable --no-verify-jwt=false
--    (ou remove a flag --no-verify-jwt do deploy, consoante a
--    versão do CLI; confirma no dashboard da função que
--    "Enforce JWT Verification" está ativo)
--
-- 3. Adicionar ao Vault um QUARTO secret — a service_role key do
--    projeto (a mesma que usaste no curl manual):
--      nome: service_role_key
--    Sem isto, o wrapper abaixo não consegue autenticar os
--    pedidos e todos os cron jobs falham.
-- ============================================================

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;


-- ------------------------------------------------------------
-- Wrapper: invoca uma Edge Function autenticada, lendo a
-- service_role key do Vault em vez de a embutir na definição do
-- cron job (que ficaria visível em texto simples em cron.job a
-- qualquer leitor com SELECT nesse catálogo).
-- ------------------------------------------------------------
create or replace function ops.trigger_edge_function(function_path text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_service_key text;
  v_project_url text := 'https://owdabspslxibnyybtcxx.supabase.co';
begin
  select decrypted_secret into v_service_key
  from vault.decrypted_secrets
  where name = 'service_role_key';

  if v_service_key is null then
    raise exception 'service_role_key não encontrada no Vault — ver pré-requisito 3 da migração';
  end if;

  perform net.http_post(
    url := v_project_url || '/functions/v1/' || function_path,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_service_key,
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
end;
$$;

comment on function ops.trigger_edge_function is
  'Invoca uma Edge Function do projeto, autenticada com a service_role key lida do Vault em runtime. Usada exclusivamente pelos jobs do pg_cron — nunca embutir a key diretamente numa definição de cron job.';

-- Só o postgres/service_role deve poder chamar isto diretamente
-- (o pg_cron corre como o role que agendou o job, tipicamente
-- postgres, que já tem privilégio).
revoke all on function ops.trigger_edge_function(text) from public;


-- ==============================================================
-- HR intraday — a cada 3h, com retries de 5 em 5 min até ~30 min
-- ==============================================================

-- Chamada base, a cada 3 horas em ponto.
select cron.schedule(
  'nexus-hr-intraday',
  '0 */3 * * *',
  $$select ops.trigger_edge_function('ingest-intraday?series=hr')$$
);

-- Retries: só disparam dentro das MESMAS horas da base (0,3,6...),
-- nos minutos 5/10/15/20/25/30. A função tem de ser idempotente
-- (já é, via ON CONFLICT nas constraints únicas) — se a chamada
-- base já tiver tido sucesso, o retry é um upsert sem efeito.
select cron.schedule(
  'nexus-hr-intraday-retry',
  '5,10,15,20,25,30 0,3,6,9,12,15,18,21 * * *',
  $$select ops.trigger_edge_function('ingest-intraday?series=hr')$$
);


-- ==============================================================
-- Sono — agregados diários às ~8:30
-- ==============================================================

select cron.schedule(
  'nexus-sleep-daily',
  '30 8 * * *',
  $$select ops.trigger_edge_function('ingest-wearable')$$
);


-- ==============================================================
-- HRV + SpO2 — depois do sono, retries de 10 em 10 min até ~12:00
-- ==============================================================

-- Duas tentativas base logo a seguir ao sono (8:40 e 8:50), depois
-- de 10 em 10 min durante 9h-11h, e uma última tentativa às 12:00.
select cron.schedule(
  'nexus-hrv-spo2-early',
  '40,50 8 * * *',
  $$select ops.trigger_edge_function('ingest-intraday?series=hrv,spo2')$$
);

select cron.schedule(
  'nexus-hrv-spo2-retry',
  '*/10 9,10,11 * * *',
  $$select ops.trigger_edge_function('ingest-intraday?series=hrv,spo2')$$
);

select cron.schedule(
  'nexus-hrv-spo2-final',
  '0 12 * * *',
  $$select ops.trigger_edge_function('ingest-intraday?series=hrv,spo2')$$
);


-- ------------------------------------------------------------
-- Verificação: confirma os 5 jobs agendados e o seu estado.
-- ------------------------------------------------------------
select jobname, schedule, active from cron.job order by jobname;
