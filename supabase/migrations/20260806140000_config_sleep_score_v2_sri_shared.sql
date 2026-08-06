-- =====================================================================
-- NEXUS — metrics.config: sleep_score (forma multiplicativa), sri, shared
-- =====================================================================
-- Não cria tabelas. SUPERSEDE: nada se apaga.
-- Chaves em INGLÊS, alinhadas à convenção já existente na tabela.
--
-- FORMA DO SLEEP SCORE (estrutura → metrics.ts; aqui só os parâmetros):
--   architecture  = Σ(weight_i × component_i) sobre {deep, fragmentation, rem, latency}
--                   [os 4 pesos somam 1.00; re-normalizar se algum faltar]
--   duration_fct  = min(TST / shared.sleep_need_hours, 1.0)
--   sleep_score   = architecture × duration_fct
--
--   A duração deixou de ser um voto e passou a ser um LIMITE. Na forma
--   aditiva anterior, uma noite de 4.7h com arquitetura normal saía com
--   ~66 pontos, porque deep/rem/fragmentação são rácios sobre o tempo de
--   sono e davam nota máxima independentemente da duração.
--
--   Abaixo de min_duration_publish_hours NÃO há score: grava-se
--   'insufficient_data' no context (mesmo padrão do min_days do SRI). Por
--   isso não existe piso no fator — com o gate a 3h sobre 8.5h, o fator
--   nunca desce abaixo de ~0.35 numa noite publicada.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 0. Versão e vigência — ÚNICO SÍTIO A EDITAR
--    'v2' porque sleep_score já tem v1 ativo com valores diferentes.
--    (Nota: checkin_reliability já está em v2 desde 2026-08-03 e readiness
--     continua em v1 — a etiqueta "global" já não é global na prática.)
-- ---------------------------------------------------------------------
create temporary table _cfg_meta on commit drop as
select
  'v2'::text   as version,
  current_date as valid_from;


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

  -- === SHARED ==========================================================
  ('shared', 'sleep_need_hours', 8.5,
   'Percentil ~90 das noites observadas (~8.6h). Consumidores: sleep_score (denominador do fator de duração) e readiness (dívida de sono). Vive em ''shared'' para não existirem duas cópias a divergir silenciosamente. Substitui sleep_score.duration_target_hours (7.5). PROVISÓRIO POR CONSTRUÇÃO: mede o que é alcançado, não o que é necessário. v1.5 = noites sem constrangimento; v2 = saturação do recovery_feeling.'),

  -- === SLEEP SCORE — pesos de ARQUITETURA (somam 1.00) =================
  -- Re-normalizados a partir dos canónicos da forma aditiva
  -- (0.29/0.15/0.12/0.10 sobre 0.66). Hierarquia igual, denominador
  -- diferente. NÃO existe weight_duration: a duração é fator multiplicativo.
  ('sleep_score', 'weight_deep',          0.44, 'Peso de arquitetura. Maior peso sobre o input de menor fiabilidade (staging de SWS por actigrafia+HR) — rever aos 2-3 meses contra a variância real do componente.'),
  ('sleep_score', 'weight_fragmentation', 0.23, 'Peso de arquitetura. Vigília intra-noite. Substitui weight_efficiency.'),
  ('sleep_score', 'weight_rem',           0.18, 'Peso de arquitetura. Principal discriminador nos dados reais.'),
  ('sleep_score', 'weight_latency',       0.15, 'Peso de arquitetura. Latência derivada do array de stages, NUNCA do campo minutesToFallAsleep (devolve sempre 0).'),

  -- === SLEEP SCORE — fator de duração ==================================
  ('sleep_score', 'min_duration_publish_hours', 3.0,
   'GATE, não penalização: abaixo disto NÃO se publica score — grava-se ''insufficient_data'' no context. Uma sesta não é uma noite má, é ausência de noite. Evita o planalto morto de um piso fixo (1h e 3.4h dariam o mesmo fator) justamente na zona mais alarmante.'),
  ('sleep_score', 'excessive_sleep_ratio', 1.15,
   'Gatilho da flag ''excessive_sleep'' no context. SEM penalização no score: o fator existe para limitar o DÉFICE, não o excesso. O excesso costuma ser consequência de dívida ou doença, que a readiness capta. NOTA: o planalto do fator é em 1.0 (clamp), não aqui.'),

  -- === SLEEP SCORE — fragmentação ======================================
  -- ⚠️ Âncoras da distribuição PESSOAL, não fisiológicas. Torna este
  -- componente relativo enquanto deep/rem/latency são absolutos: se a
  -- fragmentação melhorar sistematicamente, não se reflete sem recalibrar.
  --
  -- ⚠️ DUPLA CONTAGEM DELIBERADA — NÃO "CORRIGIR":
  -- a fragmentação entra duas vezes, como componente e via TST (o tempo
  -- acordado reduz o TST, que alimenta o fator de duração). Intencional:
  -- uma noite fragmentada é pior por duas razões independentes — pior
  -- qualidade do sono que houve, e menos sono no total. O fator é definido
  -- sobre TST e não sobre tempo-na-cama porque o tempo-na-cama é justamente
  -- o que não se consegue medir com fiabilidade.
  ('sleep_score', 'frag_anchor_100', 0.99, 'Fração de sono sobre o período de sono. Interpolação linear por troços entre âncoras; clamp fora do intervalo.'),
  ('sleep_score', 'frag_anchor_50',  0.95, 'Mediana aproximada da distribuição observada — a noite típica pontua ~50 neste componente.'),
  ('sleep_score', 'frag_anchor_0',   0.88, 'Piso. NÃO usar o 85% da literatura (o antigo efficiency_target_pct): refere-se a eficiência sono/tempo-na-cama, denominador diferente.'),

  -- === SLEEP SCORE — planalto de arquitetura (frações sobre TST) =======
  ('sleep_score', 'deep_target_min', 0.13, 'Início do planalto de SWS.'),
  ('sleep_score', 'deep_target_max', 0.23, 'Fim do planalto de SWS.'),
  ('sleep_score', 'rem_target_min',  0.20, 'Início do planalto de REM.'),
  ('sleep_score', 'rem_target_max',  0.25, 'Fim do planalto de REM.'),

  -- === SLEEP SCORE — decaimento fora do planalto =======================
  -- Decaimento LINEAR entre o joelho do planalto e o zero. Sem estas, a
  -- inclinação ficaria hardcoded em metrics.ts.
  --
  -- ASSIMETRIA DELIBERADA (braço superior ~2-3× o inferior): excesso de REM
  -- é rebound (após privação, álcool, alguns fármacos) — informativo, mas
  -- não é noite má. Deep alto é quase sempre bom. O excesso vai para o
  -- context como flag ('rem_rebound'/'deep_excessive'), não é descontado
  -- com força. Os valores superiores mantêm-se DENTRO do fisiologicamente
  -- possível: uma âncora inalcançável equivaleria a não ter curva nesse
  -- braço, e uma noite genuinamente anómala (deep 40% por rebound severo ou
  -- erro de deteção) passaria despercebida.
  ('sleep_score', 'deep_zero_below', 0.05, 'SWS abaixo disto → componente 0. Braço inferior: 0.08 de largura.'),
  ('sleep_score', 'deep_zero_above', 0.45, 'SWS acima disto → componente 0. Braço superior: 0.22 (~2.8× o inferior).'),
  ('sleep_score', 'rem_zero_below',  0.08, 'REM abaixo disto → componente 0. Braço inferior: 0.12 de largura.'),
  ('sleep_score', 'rem_zero_above',  0.50, 'REM acima disto → componente 0. Braço superior: 0.25 (~2.1× o inferior).'),

  -- === SLEEP SCORE — modulação do alvo de deep pela carga ==============
  -- ⚠️ Dependem de training_load, que ainda não existe. Fixar em metrics.ts
  -- o comportamento com load_z nulo (presumivelmente z=0, sem deslocamento)
  -- ANTES do primeiro cálculo, e registá-lo no confidence: um score com
  -- modulação ativa e outro sem ela usaram alvos de deep diferentes.
  ('sleep_score', 'deep_shift_per_sd', 0.015, 'Pontos de fração de alvo por SD de carga. PROVISÓRIO: sem base empírica até haver ~2 meses de correlação carga↔SWS. Deslocamento máximo com load_z_max=2.0 → 0.03 (3 p.p.).'),
  ('sleep_score', 'load_z_max',        2.0,   'Clamp superior do z de carga. Impede que um outlier de input colapse o score.'),
  ('sleep_score', 'load_z_min',        0,     'Clamp inferior. 0 = modulação SÓ PARA CIMA. Explícito em config para não ficar hardcoded em metrics.ts. Pôr a -2.0 para modulação bidirecional.'),
  ('sleep_score', 'load_window_days',  28,    'Janela da baseline de carga para o z-score.'),

  -- === SRI =============================================================
  ('sri', 'epoch_seconds',    30, 'Resolução de época para o cálculo de concordância.'),
  ('sri', 'window_days',      14, 'Janela deslizante (13 pares de dias consecutivos).'),
  ('sri', 'waso_min_minutes', 30, '<30 min conta como sono. Default do sleepreg — mantém comparabilidade com valores publicados.'),
  ('sri', 'min_days',         14, 'Abaixo disto NÃO se publica. Igual a window_days = exige janela completa; uma noite sem pulseira impede publicação.');

-- NÃO semeadas de propósito (já ativas com os valores corretos, evitar churn):
--   sleep_score.latency_deprivation_mins  = 5
--   sleep_score.latency_optimal_min_mins  = 10
--   sleep_score.latency_optimal_max_mins  = 20
--   sleep_score.latency_poor_mins         = 30
--   sleep_score.score_min = 0, score_max  = 100


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
-- 3. Supersede das colidentes cujo valor OU versão mude
--    (weight_deep 0.25→0.44, weight_rem 0.10→0.18, weight_latency 0.08→0.15)
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
-- 4. Fechar chaves que a nova forma torna obsoletas
--    weight_duration        → a duração passou a fator multiplicativo
--    weight_efficiency      → renomeada para weight_fragmentation
--    weight_timing          → componente eliminado
--    duration_target_hours  → substituída por shared.sleep_need_hours (8.5)
--    duration_ceiling_hours → o fator satura em 1.0; teto absoluto sem uso
--    efficiency_target_pct  → é o 85% da literatura, denominador errado
-- ---------------------------------------------------------------------
update metrics.config
set valid_to = (select valid_from from _cfg_meta)
where valid_to is null
  and metric_type = 'sleep_score'
  and param_key in ('weight_duration', 'weight_efficiency', 'weight_timing',
                    'duration_target_hours', 'duration_ceiling_hours',
                    'efficiency_target_pct');


-- ---------------------------------------------------------------------
-- 5. Inserir (idempotente em re-execução)
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
-- 6. Verificações — falham a migração inteira
-- ---------------------------------------------------------------------
do $$
declare
  v_soma       numeric;
  v_n_pesos    integer;
  v_obsoletas  text;
  v_duplicados text;
  v_em_falta   text;
begin
  -- 6a. Exatamente 4 pesos de arquitetura ativos, somando 1.00
  --     (escape do '_' para o LIKE não o tratar como wildcard)
  select count(*), sum(param_value) into v_n_pesos, v_soma
  from metrics.config
  where valid_to is null
    and metric_type = 'sleep_score'
    and param_key like 'weight\_%';

  if v_n_pesos <> 4 then
    raise exception 'Esperados 4 pesos de arquitetura ativos em sleep_score, encontrados %', v_n_pesos;
  end if;

  if v_soma is distinct from 1.00 then
    raise exception 'Pesos de arquitetura somam %, esperado 1.00', v_soma;
  end if;

  -- 6b. Obsoletas fechadas, não apagadas
  select string_agg(param_key, ', ') into v_obsoletas
  from metrics.config
  where valid_to is null
    and metric_type = 'sleep_score'
    and param_key in ('weight_duration', 'weight_efficiency', 'weight_timing',
                      'duration_target_hours', 'duration_ceiling_hours',
                      'efficiency_target_pct');

  if v_obsoletas is not null then
    raise exception 'Chaves obsoletas ainda ativas: %', v_obsoletas;
  end if;

  -- 6c. Sem duplicados ativos em toda a tabela
  select string_agg(format('%s.%s', metric_type, param_key), ', ') into v_duplicados
  from (
    select metric_type, param_key
    from metrics.config
    where valid_to is null
    group by metric_type, param_key
    having count(*) > 1
  ) d;

  if v_duplicados is not null then
    raise exception 'Duplicados ativos: %', v_duplicados;
  end if;

  -- 6d. Todo o seed ficou ativo
  select string_agg(format('%s.%s', s.metric_type, s.param_key), ', ') into v_em_falta
  from _cfg_seed s
  where not exists (
    select 1 from metrics.config c
    where c.valid_to is null
      and c.metric_type = s.metric_type
      and c.param_key   = s.param_key
  );

  if v_em_falta is not null then
    raise exception 'Linhas do seed não ativas: %', v_em_falta;
  end if;

  raise notice 'Seed OK — 4 pesos de arquitetura somando %, obsoletas fechadas, sem duplicados.', v_soma;
end
$$;


-- ---------------------------------------------------------------------
-- Verificação manual pós-push:
--
--   select metric_type, count(*) as n,
--          string_agg(param_key || '=' || param_value, ', ' order by param_key)
--   from metrics.config where valid_to is null
--   group by metric_type order by metric_type;
--
--   select metric_type, param_key, param_value, valid_from, valid_to
--   from metrics.config where valid_to = current_date
--   order by metric_type, param_key;
-- ---------------------------------------------------------------------
