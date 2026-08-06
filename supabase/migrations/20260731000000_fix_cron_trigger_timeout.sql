-- ============================================================
-- Fix: ops.trigger_edge_function used pg_net's default 5000ms
-- timeout, which cuts the request off before the ingestion
-- functions (Google OAuth + Health API roundtrip, up to ~110s
-- per their own internal wall-clock budget) can finish.
--
-- Confirmed live: a manual `select ops.trigger_edge_function(...)`
-- test recorded, in net._http_response, timed_out = true at
-- exactly 5000ms — every cron tick would have been silently cut
-- short like this, never actually reaching Google's API.
-- ============================================================

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
    body := '{}'::jsonb,
    timeout_milliseconds := 150000
  );
end;
$$;

comment on function ops.trigger_edge_function is
  'Invoca uma Edge Function do projeto, autenticada com a service_role key lida do Vault em runtime. Usada exclusivamente pelos jobs do pg_cron — nunca embutir a key diretamente numa definição de cron job. timeout_milliseconds=150000: a ingestão pode demorar até ~110s (ver BUDGET_MS em google.ts).';

revoke all on function ops.trigger_edge_function(text) from public;
