-- =====================================================================
-- NEXUS — bump de config para 'v3' + sri.min_days 14 → 10
-- =====================================================================
-- CONTEXTO:
--   metrics.daily_scores já tem 56 linhas (28 sleep_score + 28 sri) escritas
--   com config_version = 'v2'. A etiqueta passou a designar output real,
--   portanto alterar um parâmetro sem bump tornaria 'v2' ambígua.
--
-- MUDANÇA DE VALOR:
--   sri.min_days   14 → 10.   sri.window_days MANTÉM-SE em 14.
--   Com os dois iguais, qualquer data publicada tinha janela cheia e a
--   confidence era sempre 1.0 (campo morto), e uma única noite em falta
--   fazia a data desaparecer. Com o gate a 10 publica-se com janela parcial
--   e a confidence reflete a fração real de pares válidos.
--
-- PORQUÊ BUMP E NÃO MANTER 'v2':
--   min_days só afeta o metric_type 'sri', logo o recálculo é PARCIAL por
--   natureza (as 28 linhas de sleep_score não mudam). Mantendo 'v2' não
--   haveria forma de distinguir uma linha de SRI já recalculada de uma que
--   ficou para trás. Com bump, qualquer linha que continue a dizer 'v2'
--   depois do recálculo é visivelmente obsoleta — a etiqueta passa a ser o
--   detetor de recálculo incompleto.
--
-- ⚠️ CUSTO REGISTADO: relabelar reescreve o valid_from de todas as linhas
--   ativas. Esses valid_from NÃO representam calibrações reais — só a linha
--   de sri.min_days mudou de valor. As calibrações verdadeiras estão nas
--   linhas fechadas, com os valid_from originais.
--
-- ⚠️ DEPOIS DESTA MIGRAÇÃO: recalcular o histórico COMPLETO (sleep_score e
--   sri) para que todas as linhas de daily_scores fiquem em 'v3'. Verificação
--   permanente de saúde:
--     select count(*) from metrics.daily_scores
--     where config_version <> (select distinct version from metrics.config
--                              where valid_to is null);
--   Diferente de zero = há histórico por recalcular.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 0. Alvo
-- ---------------------------------------------------------------------
create temporary table _cfg_meta on commit drop as
select 'v3'::text as version, current_date as valid_from;


-- ---------------------------------------------------------------------
-- 1. Snapshot do estado desejado: todas as linhas ativas, com o override
--    de sri.min_days já aplicado.
-- ---------------------------------------------------------------------
create temporary table _target on commit drop as
select
  c.id as old_id,
  c.metric_type,
  c.param_key,
  case when c.metric_type = 'sri' and c.param_key = 'min_days'
       then 10::numeric else c.param_value end as param_value,
  case when c.metric_type = 'sri' and c.param_key = 'min_days'
       then 'Mínimo de dias com dados para publicar SRI. DELIBERADAMENTE MENOR que window_days (14): com os dois iguais, qualquer data publicada tinha janela cheia e a confidence era sempre 1.0 (campo morto), e uma única noite em falta fazia a data desaparecer. Com o gate a 10 publica-se com janela parcial e a confidence reflete a fração real de pares válidos (pares_válidos / pares_possíveis).'
       else c.notes end as notes
from metrics.config c
where c.valid_to is null;


-- ---------------------------------------------------------------------
-- 2. Guardas
-- ---------------------------------------------------------------------
do $$
declare
  v_conflito text;
  v_min_days integer;
begin
  -- 2a. Nenhuma linha ativa pode ter valid_from >= hoje
  select string_agg(format('%s.%s (valid_from=%s)', c.metric_type, c.param_key, c.valid_from), ', ')
    into v_conflito
  from metrics.config c, _cfg_meta m
  where c.valid_to is null and c.valid_from >= m.valid_from;

  if v_conflito is not null then
    raise exception 'Linhas ativas com valid_from >= hoje: %. Fechá-las hoje daria intervalo vazio.', v_conflito;
  end if;

  -- 2b. A chave alvo tem de existir (convenção inglesa: min_days, não dias_minimos)
  select count(*) into v_min_days
  from _target where metric_type = 'sri' and param_key = 'min_days';

  if v_min_days <> 1 then
    raise exception 'Esperada 1 linha ativa de sri.min_days, encontradas %. Verificar o nome da chave.', v_min_days;
  end if;
end
$$;


-- ---------------------------------------------------------------------
-- 3. Fechar TODAS as linhas ativas
-- ---------------------------------------------------------------------
update metrics.config c
set valid_to = m.valid_from
from _target t, _cfg_meta m
where c.id = t.old_id;


-- ---------------------------------------------------------------------
-- 4. Reabrir em 'v3'
-- ---------------------------------------------------------------------
insert into metrics.config
  (metric_type, param_key, param_value, version, valid_from, valid_to, notes)
select t.metric_type, t.param_key, t.param_value, m.version, m.valid_from, null, t.notes
from _target t
cross join _cfg_meta m;


-- ---------------------------------------------------------------------
-- 5. Verificações
-- ---------------------------------------------------------------------
do $$
declare
  v_alvo       text := (select version from _cfg_meta);
  v_fora       text;
  v_antes      integer;
  v_depois     integer;
  v_duplicados text;
  v_min_days   numeric;
  v_window     numeric;
  v_n_pesos    integer;
  v_soma       numeric;
  v_fechadas   integer;
begin
  -- 5a. Nenhuma linha ativa fora do alvo
  select string_agg(distinct format('%s(%s)', c.metric_type, c.version), ', ') into v_fora
  from metrics.config c
  where c.valid_to is null and c.version is distinct from v_alvo;

  if v_fora is not null then
    raise exception 'Linhas ativas fora de %: %', v_alvo, v_fora;
  end if;

  -- 5b. Contagem de ativas inalterada (relabel + override, não seed)
  select count(*) into v_antes from _target;
  select count(*) into v_depois from metrics.config where valid_to is null;

  if v_antes <> v_depois then
    raise exception 'Ativas antes=% depois=% — relabel desalinhado.', v_antes, v_depois;
  end if;

  -- 5c. Sem duplicados ativos
  select string_agg(format('%s.%s', d.metric_type, d.param_key), ', ') into v_duplicados
  from (
    select c.metric_type, c.param_key from metrics.config c
    where c.valid_to is null group by 1,2 having count(*) > 1
  ) d;

  if v_duplicados is not null then
    raise exception 'Duplicados ativos: %', v_duplicados;
  end if;

  -- 5d. O valor novo, e window_days intocada
  select c.param_value into v_min_days from metrics.config c
  where c.valid_to is null and c.metric_type = 'sri' and c.param_key = 'min_days';

  select c.param_value into v_window from metrics.config c
  where c.valid_to is null and c.metric_type = 'sri' and c.param_key = 'window_days';

  if v_min_days is distinct from 10 then
    raise exception 'sri.min_days = %, esperado 10', v_min_days;
  end if;

  if v_window is distinct from 14 then
    raise exception 'sri.window_days = %, esperado 14 (não devia ter sido tocada)', v_window;
  end if;

  -- 5e. Histórico preservado (a linha antiga foi fechada, não apagada)
  select count(*) into v_fechadas from metrics.config c
  where c.metric_type = 'sri' and c.param_key = 'min_days' and c.valid_to is not null;

  if v_fechadas < 1 then
    raise exception 'Nenhuma linha histórica de sri.min_days — foi apagada em vez de fechada.';
  end if;

  -- 5f. Pesos do sleep_score intactos
  select count(*), sum(c.param_value) into v_n_pesos, v_soma
  from metrics.config c
  where c.valid_to is null and c.metric_type = 'sleep_score' and c.param_key like 'weight\_%';

  if v_n_pesos <> 4 or v_soma is distinct from 1.00 then
    raise exception 'Pesos de arquitetura alterados: % pesos somando %', v_n_pesos, v_soma;
  end if;

  raise notice 'OK — % linhas ativas em %, sri.min_days=10, window_days=14. RECALCULAR daily_scores (56 linhas em v2).', v_depois, v_alvo;
end
$$;


-- ---------------------------------------------------------------------
-- Verificação pós-push:
--
--   select version, count(*) from metrics.config
--   where valid_to is null group by version;        -- só v3
--
--   -- histórico por recalcular (deve ir a 0 depois do recálculo)
--   select config_version, metric_type, count(*)
--   from metrics.daily_scores group by 1,2 order by 1,2;
-- ---------------------------------------------------------------------
