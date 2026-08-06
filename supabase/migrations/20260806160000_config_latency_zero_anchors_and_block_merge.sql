-- =====================================================================
-- NEXUS — sleep_score: âncoras de zero da latência + agrupamento de blocos
-- =====================================================================
-- CORREÇÃO 1 — a curva de latência estava indeterminada.
--   As quatro chaves existentes (5/10/20/30) são joelhos de PLANALTO, não
--   pontos de zero. Usá-las como ambos tornava a curva abrupta: 30 min dava
--   0, igual a nunca ter adormecido, e 9 de 26 noites reais caíam a zero.
--   30 min é o limiar clínico do INÍCIO do problema, não o extremo.
--
--   Curva final (linear entre âncoras):
--       0 min           → 0
--       0 → 10 min      → 0 → 100      (5 min ≈ 50)
--       10 → 20 min     → planalto 100
--       20 → 60 min     → 100 → 0      (30 min ≈ 75)
--       ≥ 60 min        → 0
--
--   Assimetria deliberada: braço inferior 10 min, superior 40 min. Adormecer
--   em 2 min é sinal mais forte de dívida do que 35 min é de insónia, e o
--   braço largo evita que uma noite ansiosa isolada destrua o componente.
--
-- CORREÇÃO 2 — agrupamento de blocos de sono.
--   A regra anterior ("usar o registo mais longo") descartava sono real numa
--   noite partida. Não dava erro: dava um número plausível e errado.
--
-- NOTA DE AUDITORIA: com estas âncoras, TODAS as curvas da config ficam
-- determinadas. deep e rem já tinham planalto + zeros. frag_anchor_0/50/100
-- é monotónica crescente (anchor_0 = zero, anchor_100 = saturação), não lhe
-- falta braço. O fator de duração satura em 1.0 e tem gate em baixo.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 0. Versão e vigência
-- ---------------------------------------------------------------------
create temporary table _cfg_meta on commit drop as
select 'v2'::text as version, current_date as valid_from;


-- ---------------------------------------------------------------------
-- 1. Conjunto a semear
-- ---------------------------------------------------------------------
create temporary table _cfg_seed (
  metric_type  text    not null,
  param_key    text    not null,
  param_value  numeric not null,
  notes        text
) on commit drop;

insert into _cfg_seed (metric_type, param_key, param_value, notes) values

  -- === NOVAS: âncoras de zero da latência ==============================
  ('sleep_score', 'latency_zero_below_mins', 0,
   'Latência ≤ isto → componente 0. Braço inferior estreito (10 min até ao planalto): adormecer quase instantaneamente é sinal forte de pressão de sono/dívida.'),
  ('sleep_score', 'latency_zero_above_mins', 60,
   'Latência ≥ isto → componente 0. Braço superior largo (40 min desde o fim do planalto): 30 min é o limiar clínico do início do problema, não o extremo. Evita que uma noite ansiosa isolada destrua o componente.'),

  -- === NOVA: agrupamento de blocos =====================================
  ('sleep_score', 'merge_max_gap_hours', 4,
   'Intervalo máximo entre o fim de um bloco de sono e o início do seguinte para contarem como a MESMA noite. Acima disto é sesta, não continuação. Aplica-se a blocos com a mesma data-de-acordar. O intervalo acordado fica DENTRO do período de sono, portanto é a fragmentação que o captura — não é latência (a latência é a do primeiro bloco).'),

  -- === SUPERSEDE: reaproveitadas como limiares de FLAG =================
  -- Deixaram de ser usadas pela curva (os joelhos passaram a ser
  -- latency_optimal_min/max e os zeros a latency_zero_below/above). Sem este
  -- reaproveitamento ficariam config morta.
  ('sleep_score', 'latency_deprivation_mins', 5,
   'JÁ NÃO É ÂNCORA DA CURVA. Limiar de flag: latência < isto → ''sleep_pressure_high'' no context. O valor 50 aos 5 min é consequência da interpolação, não uma âncora.'),
  ('sleep_score', 'latency_poor_mins', 30,
   'JÁ NÃO É ÂNCORA DA CURVA. Limiar de flag: latência > isto → ''latency_poor'' no context. O valor 75 aos 30 min é consequência da interpolação, não uma âncora.');


-- ---------------------------------------------------------------------
-- 2. Guarda
-- ---------------------------------------------------------------------
do $$
declare
  v_valid_from date := (select valid_from from _cfg_meta);
  v_conflito   text;
begin
  select string_agg(format('%s.%s (valid_from=%s)', metric_type, param_key, valid_from), ', ')
    into v_conflito
  from metrics.config c
  where c.valid_to is null
    and c.valid_from >= v_valid_from
    and (c.metric_type, c.param_key) in (select metric_type, param_key from _cfg_seed);

  if v_conflito is not null then
    raise exception
      'Linhas ativas com valid_from >= %: %. Fechá-las hoje daria intervalo vazio. Resolver à mão.',
      v_valid_from, v_conflito;
  end if;
end
$$;


-- ---------------------------------------------------------------------
-- 3. Supersede — aqui o valor NÃO muda, só as notas e a versão.
--    A condição de versão é o que dispara o supersede das duas linhas de
--    latência (estavam em v1 desde 2026-07-26).
-- ---------------------------------------------------------------------
update metrics.config c
set valid_to = m.valid_from
from _cfg_seed s, _cfg_meta m
where c.valid_to is null
  and c.metric_type = s.metric_type
  and c.param_key   = s.param_key
  and (c.param_value is distinct from s.param_value
       or c.version is distinct from m.version);


-- ---------------------------------------------------------------------
-- 4. Inserir
-- ---------------------------------------------------------------------
insert into metrics.config
  (metric_type, param_key, param_value, version, valid_from, valid_to, notes)
select
  s.metric_type, s.param_key, s.param_value, m.version, m.valid_from, null, s.notes
from _cfg_seed s
cross join _cfg_meta m
where not exists (
  select 1 from metrics.config c
  where c.valid_to is null
    and c.metric_type = s.metric_type
    and c.param_key   = s.param_key
);


-- ---------------------------------------------------------------------
-- 5. Verificações
-- ---------------------------------------------------------------------
do $$
declare
  v_soma       numeric;
  v_n_pesos    integer;
  v_curvas     text;
  v_duplicados text;
  v_em_falta   text;
begin
  -- 5a. Pesos de arquitetura intocados
  select count(*), sum(param_value) into v_n_pesos, v_soma
  from metrics.config
  where valid_to is null and metric_type = 'sleep_score'
    and param_key like 'weight\_%';

  if v_n_pesos <> 4 or v_soma is distinct from 1.00 then
    raise exception 'Pesos de arquitetura alterados: % pesos somando %', v_n_pesos, v_soma;
  end if;

  -- 5b. Auditoria de completude das curvas: cada uma precisa de planalto E zeros
  select string_agg(k, ', ') into v_curvas
  from unnest(array[
    'deep_target_min','deep_target_max','deep_zero_below','deep_zero_above',
    'rem_target_min','rem_target_max','rem_zero_below','rem_zero_above',
    'latency_optimal_min_mins','latency_optimal_max_mins',
    'latency_zero_below_mins','latency_zero_above_mins',
    'frag_anchor_0','frag_anchor_50','frag_anchor_100'
  ]) as k
  where not exists (
    select 1 from metrics.config c
    where c.valid_to is null and c.metric_type = 'sleep_score' and c.param_key = k
  );

  if v_curvas is not null then
    raise exception 'Âncoras de curva em falta: %', v_curvas;
  end if;

  -- 5c. Sem duplicados ativos
  select string_agg(format('%s.%s', metric_type, param_key), ', ') into v_duplicados
  from (
    select metric_type, param_key from metrics.config
    where valid_to is null group by 1,2 having count(*) > 1
  ) d;

  if v_duplicados is not null then
    raise exception 'Duplicados ativos: %', v_duplicados;
  end if;

  -- 5d. Todo o seed ficou ativo
  select string_agg(format('%s.%s', s.metric_type, s.param_key), ', ') into v_em_falta
  from _cfg_seed s
  where not exists (
    select 1 from metrics.config c
    where c.valid_to is null and c.metric_type = s.metric_type and c.param_key = s.param_key
  );

  if v_em_falta is not null then
    raise exception 'Linhas do seed não ativas: %', v_em_falta;
  end if;

  raise notice 'OK — curvas completas, pesos intactos (%), sem duplicados.', v_soma;
end
$$;
