-- =====================================================================
-- NEXUS — check de metric_type em metrics.daily_scores
-- =====================================================================
-- A tabela tinha apenas PK e UNIQUE (metric_type, date). Sem check, um typo
-- no metrics.ts ('sleep_scores', 'sleepscore') não colide com nada e cria
-- uma série paralela silenciosa, só detetável quando o gráfico mostrar
-- buracos semanas depois.
--
-- Aplicado com a tabela VAZIA (0 linhas), portanto sem risco de falha por
-- dados históricos fora da lista.
--
-- ⚠️ Acrescentar uma métrica nova passa a exigir migração para alargar esta
-- lista. É fricção deliberada: com ~6 valores e cadência de uma métrica nova
-- por mês, o custo é baixo face à proteção. A alternativa (tabela de tipos
-- com FK) é peso a mais para um sistema de um só utilizador.
-- =====================================================================

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'metrics.daily_scores'::regclass
      and conname  = 'daily_scores_metric_type_check'
  ) then
    raise notice 'daily_scores_metric_type_check já existe — nada a fazer.';
    return;
  end if;

  alter table metrics.daily_scores
    add constraint daily_scores_metric_type_check
    check (metric_type in (
      'readiness',
      'sleep_score',
      'training_load',
      'divergence_readiness',
      'divergence_sleep',
      'sri'
    ));

  raise notice 'daily_scores_metric_type_check criado.';
end
$$;

-- ---------------------------------------------------------------------
-- Verificação pós-push:
--
--   select conname, pg_get_constraintdef(oid)
--   from pg_constraint where conrelid = 'metrics.daily_scores'::regclass;
--
-- Deve aparecer daily_scores_metric_type_check com os 6 valores.
-- ---------------------------------------------------------------------
