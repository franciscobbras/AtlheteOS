-- =====================================================================
-- NEXUS — metrics.daily_scores.score passa a NULLABLE
-- =====================================================================
-- MOTIVO:
--   O sleep score não publica valor abaixo de min_duration_publish_hours
--   (3h): grava linha com score = null e context.status = 'insufficient_data'.
--
--   Hoje isto nunca acontece porque nenhuma das ~26 noites desce dos 3h. Mas
--   quando descer, o insert falha, o runner salta a noite, e a PIOR noite
--   possível desaparece da série. Como as linhas de insufficient_data contam
--   para as baselines, a omissão enviesa-as para otimista — é exatamente o
--   caso em que mais custa faltar.
--
--   A ausência é silenciosa duas vezes: falha só quando o cenário raro
--   acontece, e o efeito (baseline otimista) não se distingue de sono bom.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Largar o NOT NULL (no-op se já for nullable)
-- ---------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'metrics' and table_name = 'daily_scores'
      and column_name = 'score' and is_nullable = 'NO'
  ) then
    alter table metrics.daily_scores alter column score drop not null;
    raise notice 'metrics.daily_scores.score passou a nullable.';
  else
    raise notice 'metrics.daily_scores.score já era nullable — nada a fazer.';
  end if;
end
$$;


-- ---------------------------------------------------------------------
-- 2. Invariante: score só pode ser null com status explícito
--    Impede que um null acidental (bug de cálculo, componente em falta)
--    passe por uma não-publicação legítima. Falha alto em vez de silenciar.
--
--    ⚠️ Isto PINA a string 'insufficient_data'. O metrics.ts tem de escrever
--    exatamente context.status = 'insufficient_data'. Se surgir outro motivo
--    legítimo de não-publicação, alargar aqui por migração.
-- ---------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'metrics.daily_scores'::regclass
      and conname  = 'daily_scores_null_score_requires_status'
  ) then
    raise notice 'Invariante já existe — nada a fazer.';
    return;
  end if;

  alter table metrics.daily_scores
    add constraint daily_scores_null_score_requires_status
    check (
      score is not null
      or context->>'status' = 'insufficient_data'
    );

  raise notice 'Invariante daily_scores_null_score_requires_status criado.';
end
$$;


-- ---------------------------------------------------------------------
-- 3. Reportar outras colunas NOT NULL que possam bloquear o mesmo caso
--    (confidence e drivers podem também vir vazios numa não-publicação)
-- ---------------------------------------------------------------------
do $$
declare
  v_cols text;
begin
  select string_agg(column_name, ', ' order by column_name) into v_cols
  from information_schema.columns
  where table_schema = 'metrics' and table_name = 'daily_scores'
    and is_nullable = 'NO'
    and column_name not in ('id', 'date', 'metric_type', 'computed_at_utc');

  if v_cols is not null then
    raise notice 'ATENÇÃO — ainda NOT NULL: %. Verificar se o metrics.ts as preenche numa linha de insufficient_data.', v_cols;
  end if;
end
$$;


-- ---------------------------------------------------------------------
-- Verificação pós-push:
--   select column_name, is_nullable
--   from information_schema.columns
--   where table_schema='metrics' and table_name='daily_scores'
--   order by ordinal_position;
-- ---------------------------------------------------------------------
