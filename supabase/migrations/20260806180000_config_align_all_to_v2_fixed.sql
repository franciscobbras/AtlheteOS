-- =====================================================================
-- NEXUS — metrics.config: realinhar TODAS as linhas ativas a 'v2'
-- =====================================================================
-- MOTIVO:
--   A convenção decidida é versão GLOBAL: todas as linhas ativas partilham a
--   mesma etiqueta, para que o config_version escrito em metrics.daily_scores
--   aponte para um conjunto coerente de parâmetros. Após os seeds recentes,
--   sleep_score / shared / sri / checkin_reliability estão em 'v2', mas
--   readiness (13 linhas) e divergence_readiness / divergence_sleep (1 cada)
--   continuam em 'v1'.
--
-- ⚠️ CUSTO REGISTADO — LER ANTES DE INTERPRETAR O HISTÓRICO:
--   Estas 15 linhas mudam de etiqueta mas NÃO de valor. Como nada se
--   sobrescreve, relabelar exige supersede, e o supersede reescreve o
--   valid_from para hoje. A partir daqui, a config afirma que os pesos da
--   readiness passaram a vigorar hoje, quando estão em vigor desde
--   2026-07-26. O valid_from dessas linhas NÃO representa uma calibração
--   real — a calibração original está na linha fechada, com o valid_from
--   verdadeiro.
--
--   Este é o custo estrutural da versão global. A alternativa (versão por
--   metric_type) evitava-o mas tornava o config_version insuficiente para
--   fixar os parâmetros partilhados. Decisão tomada; fica documentada aqui
--   para que ninguém leia estes valid_from como eventos.
--
-- NOTA: metrics.config e _cfg_meta têm ambas uma coluna `version` — TODAS as
-- referências têm de ser qualificadas.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 0. Alvo
-- ---------------------------------------------------------------------
create temporary table _cfg_meta on commit drop as
select 'v2'::text as version, current_date as valid_from;


-- ---------------------------------------------------------------------
-- 1. Linhas a relabelar: ativas com versão diferente do alvo
-- ---------------------------------------------------------------------
create temporary table _relabel on commit drop as
select c.id, c.metric_type, c.param_key, c.param_value, c.version as old_version, c.notes
from metrics.config c, _cfg_meta m
where c.valid_to is null
  and c.version is distinct from m.version;

create temporary table _counts on commit drop as
select count(*) filter (where valid_to is null) as ativas_antes
from metrics.config;


-- ---------------------------------------------------------------------
-- 2. Guarda: nenhuma linha a relabelar pode ter valid_from >= hoje
--    (fechá-la hoje daria intervalo vazio)
-- ---------------------------------------------------------------------
do $$
declare
  v_conflito text;
begin
  select string_agg(format('%s.%s (valid_from=%s)', c.metric_type, c.param_key, c.valid_from), ', ')
    into v_conflito
  from metrics.config c
  join _relabel r on r.id = c.id, _cfg_meta m
  where c.valid_from >= m.valid_from;

  if v_conflito is not null then
    raise exception 'Linhas a relabelar com valid_from >= hoje: %. Resolver à mão.', v_conflito;
  end if;
end
$$;


-- ---------------------------------------------------------------------
-- 3. Fechar as antigas
-- ---------------------------------------------------------------------
update metrics.config c
set valid_to = m.valid_from
from _relabel r, _cfg_meta m
where c.id = r.id;


-- ---------------------------------------------------------------------
-- 4. Abrir as novas — valor e notas IDÊNTICOS, só a etiqueta muda
-- ---------------------------------------------------------------------
insert into metrics.config
  (metric_type, param_key, param_value, version, valid_from, valid_to, notes)
select r.metric_type, r.param_key, r.param_value, m.version, m.valid_from, null, r.notes
from _relabel r
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
  v_soma       numeric;
  v_n_pesos    integer;
begin
  -- 5a. Nenhuma linha ativa fora do alvo
  --     (v_alvo resolvido antes; evita juntar _cfg_meta e a ambiguidade de `version`)
  select string_agg(distinct format('%s(%s)', c.metric_type, c.version), ', ') into v_fora
  from metrics.config c
  where c.valid_to is null
    and c.version is distinct from v_alvo;

  if v_fora is not null then
    raise exception 'Linhas ativas fora de %: %', v_alvo, v_fora;
  end if;

  -- 5b. O número de linhas ativas não pode ter mudado — isto é relabel,
  --     não seed. Se mudou, o supersede e o insert desalinharam.
  select ativas_antes into v_antes from _counts;
  select count(*) into v_depois from metrics.config where valid_to is null;

  if v_antes <> v_depois then
    raise exception 'Linhas ativas antes=% depois=% — relabel desalinhado.', v_antes, v_depois;
  end if;

  -- 5c. Sem duplicados ativos
  select string_agg(format('%s.%s', d.metric_type, d.param_key), ', ') into v_duplicados
  from (
    select c.metric_type, c.param_key
    from metrics.config c
    where c.valid_to is null
    group by 1, 2
    having count(*) > 1
  ) d;

  if v_duplicados is not null then
    raise exception 'Duplicados ativos: %', v_duplicados;
  end if;

  -- 5d. Pesos do sleep_score intactos
  select count(*), sum(c.param_value) into v_n_pesos, v_soma
  from metrics.config c
  where c.valid_to is null
    and c.metric_type = 'sleep_score'
    and c.param_key like 'weight\_%';

  if v_n_pesos <> 4 or v_soma is distinct from 1.00 then
    raise exception 'Pesos de arquitetura alterados: % pesos somando %', v_n_pesos, v_soma;
  end if;

  raise notice 'Relabel OK — % linhas ativas, todas em %.', v_depois, v_alvo;
end
$$;


-- ---------------------------------------------------------------------
-- Verificação pós-push:
--
--   select version, count(*) from metrics.config
--   where valid_to is null group by version;      -- deve dar só v2
--
--   select metric_type, param_key, param_value, version, valid_from, valid_to
--   from metrics.config where valid_to = current_date
--   order by metric_type, param_key;              -- as 15 relabeladas
-- ---------------------------------------------------------------------
