-- ============================================================
-- NEXUS — Correção: revogar DELETE de `authenticated`
--
-- Bug: os `alter default privileges` da migração inicial
-- (20260726000000_fatia1_schema.sql) concedem ALL a authenticated,
-- incluindo DELETE. Isto contraria o princípio "nunca destrutivo"
-- (supersede/arquivar, nunca apagar). As três tabelas intraday
-- (heart_rate, hrv_instant, spo2) já corrigiram isto na própria
-- migração de criação — esta migração fecha o mesmo buraco nas
-- cinco tabelas da Fatia 1, que ficaram por trás.
--
-- Nota: isto NÃO altera o acesso de service_role (usado pela
-- ingestão), que continua com privilégio total.
-- ============================================================

revoke delete on wearable.daily_metrics       from authenticated;
revoke delete on wearable.sleep               from authenticated;
revoke delete on subjective.morning_checkin   from authenticated;
revoke delete on metrics.daily_scores         from authenticated;
revoke delete on metrics.config               from authenticated;

-- ------------------------------------------------------------
-- Corrigir também o DEFAULT para tabelas futuras nestes três
-- schemas: sem isto, a próxima tabela criada volta a herdar
-- DELETE por omissão, e o bug repete-se.
-- ------------------------------------------------------------
alter default privileges in schema wearable
  revoke delete on tables from authenticated;
alter default privileges in schema subjective
  revoke delete on tables from authenticated;
alter default privileges in schema metrics
  revoke delete on tables from authenticated;

-- ------------------------------------------------------------
-- Verificação: nenhuma linha deve ter 'DELETE' na lista de
-- privilégios de authenticated, em nenhuma tabela dos 5 schemas.
-- ------------------------------------------------------------
select table_schema, table_name, privilege_type
from information_schema.table_privileges
where grantee = 'authenticated'
  and privilege_type = 'DELETE'
  and table_schema in ('wearable', 'subjective', 'metrics');
-- resultado esperado: 0 linhas
