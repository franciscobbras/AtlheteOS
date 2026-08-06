-- Vault access helpers for the ingest-wearable Edge Function.
--
-- Vault's decrypted view (vault.decrypted_secrets) is not reachable through
-- PostgREST, so the function calls these two SECURITY DEFINER wrappers via
-- client.rpc(). Both are locked to service_role.

-- Read a secret's decrypted value by name.
create or replace function public.get_secret(p_name text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret text;
begin
  select decrypted_secret
    into v_secret
    from vault.decrypted_secrets
   where name = p_name
   limit 1;
  return v_secret;
end;
$$;

-- Create the secret if absent, otherwise update it in place. Returns its id.
create or replace function public.upsert_secret(p_name text, p_secret text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  select id into v_id from vault.secrets where name = p_name limit 1;

  if v_id is null then
    v_id := vault.create_secret(p_secret, p_name);
  else
    perform vault.update_secret(v_id, p_secret);
  end if;

  return v_id;
end;
$$;

-- Lock both down: service_role only (the Edge Function runs as service_role).
revoke all on function public.get_secret(text) from public;
revoke all on function public.upsert_secret(text, text) from public;
revoke all on function public.get_secret(text) from anon, authenticated;
revoke all on function public.upsert_secret(text, text) from anon, authenticated;
grant execute on function public.get_secret(text) to service_role;
grant execute on function public.upsert_secret(text, text) to service_role;
