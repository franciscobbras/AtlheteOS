-- =====================================================================
-- Correção de segurança — schema `ops`
-- =====================================================================
-- Contexto:
--   O schema `ops` foi exposto ao PostgREST para a UI ler `ops.notifications`.
--   Isso expôs também `ops.trigger_edge_function`, que é SECURITY DEFINER e lê
--   a service_role_key do Vault. O Postgres concede EXECUTE a PUBLIC por omissão
--   em funções novas (proacl NULL = privilégios por omissão = PUBLIC tem EXECUTE),
--   por isso um utilizador `authenticated` pode invocá-la via RPC e fazer o
--   servidor emitir um http_post autenticado com a service_role key.
--
-- Efeito:
--   Revoga EXECUTE a public, anon e authenticated em TODAS as sobrecargas de
--   `ops.trigger_edge_function`. O owner (postgres) mantém EXECUTE, por isso os
--   jobs de pg_cron — que correm como postgres — continuam a disparar.
--
-- Nota: REVOKE é idempotente; correr esta migração mais do que uma vez é seguro.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Revogar EXECUTE em todas as sobrecargas de ops.trigger_edge_function
--    (itera sobre pg_proc para não depender da assinatura exata)
-- ---------------------------------------------------------------------
do $$
declare
  fn record;
  found_any boolean := false;
begin
  for fn in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'ops'
      and p.proname = 'trigger_edge_function'
  loop
    found_any := true;
    execute format(
      'revoke execute on function %s from public, anon, authenticated',
      fn.sig
    );
    raise notice 'REVOKE EXECUTE aplicado em %', fn.sig;
  end loop;

  if not found_any then
    raise notice 'ops.trigger_edge_function não existe — nada a revogar.';
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- 2. Evitar recorrência: funções futuras criadas neste schema já não
--    nascem com EXECUTE para PUBLIC.
--    (Se alguma função de `ops` vier a precisar de ser chamada pelo
--     frontend, concede-se EXECUTE explicitamente a `authenticated`.)
-- ---------------------------------------------------------------------
alter default privileges in schema ops
  revoke execute on functions from public;

-- ---------------------------------------------------------------------
-- Verificação pós-aplicação (correr manualmente, não faz parte da migração):
--
--   select p.proname,
--          p.oid::regprocedure as assinatura,
--          p.prosecdef        as security_definer,
--          p.proacl           as acl
--   from pg_proc p
--   join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'ops';
--
-- Esperado depois do revoke: proacl deixa de ser NULL e passa a listar apenas
-- o owner, algo como {postgres=X/postgres}. Se ainda aparecer `=X/` (entrada
-- sem role à esquerda = PUBLIC) ou `authenticated=X/`, o revoke não pegou.
-- ---------------------------------------------------------------------
