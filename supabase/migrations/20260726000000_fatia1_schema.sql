-- ─────────────────────────────────────────────────────────────────────────────
-- NEXUS — Fatia Vertical 1 (Readiness Matinal) — schema inicial limpo.
--
-- Cria APENAS as tabelas que esta fatia toca. O mapa global do schema é maior;
-- as fatias seguintes acrescentam tabelas mantendo estas convenções.
--
-- Convenções aplicadas:
--   · Um só utilizador → SEM user_id. RLS ativa; policy: auth.uid() is not null.
--   · Timestamps UTC (timestamptz) + utc_offset_seconds quando a hora local importa.
--   · source (text) onde coexistem fontes.
--   · raw jsonb preservado em sono e agregados diários.
--   · Nunca destrutivo: authenticated tem SELECT/INSERT/UPDATE, nunca DELETE.
--   · Pesos/parâmetros de métricas em metrics.config (supersede), nunca hardcoded.
-- ─────────────────────────────────────────────────────────────────────────────

create schema if not exists wearable;
create schema if not exists subjective;
create schema if not exists metrics;

-- ── wearable — dados passivos da Fitbit Air (Google Health API) ───────────────

-- Agregados diários (um valor por dia por métrica). Fonte da readiness.
create table wearable.daily_metrics (
  id               uuid primary key default gen_random_uuid(),
  date             date not null,
  metric_type      text not null,          -- 'daily_hrv_rmssd','resting_hr','temp_deviation',…
  value            numeric not null,
  unit             text,
  source           text not null,          -- 'fitbit_air'
  raw              jsonb,
  computed_at_utc  timestamptz not null default now(),
  constraint daily_metrics_unique unique (date, metric_type, source)
);

-- HRV: guardar sempre o RMSSD CRU. O LnRMSSD é aplicado no cálculo (metrics.ts),
-- nunca na ingestão. Temperatura: só desvio noturno derivado ('temp_deviation').

-- Sono: períodos com fases. Fonte do sleep score.
create table wearable.sleep (
  id                  uuid primary key default gen_random_uuid(),
  start_utc           timestamptz not null,
  end_utc             timestamptz not null,
  utc_offset_seconds  integer not null,     -- offset em vigor DURANTE o sono
  source              text not null,        -- 'fitbit_air'
  stages              jsonb,                -- [{stage,start,end}]
  summary             jsonb,                -- minutos/fase, eficiência, latência, resp. rate…
  raw                 jsonb,
  constraint sleep_unique unique (start_utc, source)
);

-- ── subjective — juízo/perceção pessoal (estado interno) ──────────────────────

create table subjective.morning_checkin (
  id                  uuid primary key default gen_random_uuid(),
  date                date not null unique,
  logged_at_utc       timestamptz not null default now(),
  utc_offset_seconds  integer not null,
  recovery_feeling    integer,              -- 0-10 → "feeling" da readiness
  sleep_perceived     integer,              -- 0-10 → subjetivo do sleep score
  mood_energy         integer,              -- 0-10
  notes               text
);

-- ── metrics — output de métricas calculadas + config ──────────────────────────

create table metrics.daily_scores (
  id                  uuid primary key default gen_random_uuid(),
  date                date not null,
  metric_type         text not null,        -- 'readiness','sleep_score','training_load',
                                             -- 'divergence_readiness','divergence_sleep'
  score               numeric not null,
  drivers             jsonb,                -- [{factor, impact, detail}]
  vs_baseline         text,                 -- 'acima' | 'normal' | 'abaixo'
  confidence          numeric,              -- 0-1
  context             jsonb,                -- {load_yesterday}, overrides, flags
  computed_at_utc     timestamptz not null default now(),
  config_version      text not null,        -- que versão dos pesos gerou este score
  constraint daily_scores_unique unique (metric_type, date)  -- recálculo = upsert
);

create table metrics.config (
  id           uuid primary key default gen_random_uuid(),
  metric_type  text not null,               -- 'readiness' | 'sleep_score'
  param_key    text not null,               -- 'weight_hrv','scale','override_illness_z',…
  param_value  numeric not null,
  version      text not null,
  valid_from   date not null default current_date,
  valid_to     date,                        -- null = ativo (supersede)
  notes        text
);

-- Um só valor ATIVO por (metric_type, param_key). Supersede fecha valid_to e abre nova linha.
create unique index config_active_unique
  on metrics.config (metric_type, param_key)
  where valid_to is null;

comment on column metrics.config.valid_to is 'EXCLUSIVO: a linha vale para datas < valid_to. null = ativo. Lookup: valid_from <= d and (valid_to is null or valid_to > d). O valid_to de uma linha é o valid_from da seguinte.';

-- ── RLS — acesso apenas a utilizadores autenticados ───────────────────────────

alter table wearable.daily_metrics     enable row level security;
alter table wearable.sleep             enable row level security;
alter table subjective.morning_checkin enable row level security;
alter table metrics.daily_scores       enable row level security;
alter table metrics.config             enable row level security;

create policy authenticated_all on wearable.daily_metrics
  for all using (auth.uid() is not null) with check (auth.uid() is not null);
create policy authenticated_all on wearable.sleep
  for all using (auth.uid() is not null) with check (auth.uid() is not null);
create policy authenticated_all on subjective.morning_checkin
  for all using (auth.uid() is not null) with check (auth.uid() is not null);
create policy authenticated_all on metrics.daily_scores
  for all using (auth.uid() is not null) with check (auth.uid() is not null);
create policy authenticated_all on metrics.config
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

-- ── Grants ────────────────────────────────────────────────────────────────────
-- authenticated (PWA): ler + escrever, NUNCA apagar (princípio não-destrutivo).
-- service_role (Edge Functions): tudo; bypassa RLS.
-- anon: sem acesso (single-user exige login).

grant usage on schema wearable, subjective, metrics to authenticated, service_role;

grant select, insert, update on all tables in schema wearable     to authenticated;
grant select, insert, update on all tables in schema subjective   to authenticated;
grant select, insert, update on all tables in schema metrics      to authenticated;

grant all on all tables in schema wearable     to service_role;
grant all on all tables in schema subjective   to service_role;
grant all on all tables in schema metrics      to service_role;

-- Tabelas futuras destas schemas herdam os mesmos grants.
alter default privileges in schema wearable     grant select, insert, update on tables to authenticated;
alter default privileges in schema subjective   grant select, insert, update on tables to authenticated;
alter default privileges in schema metrics      grant select, insert, update on tables to authenticated;
alter default privileges in schema wearable     grant all on tables to service_role;
alter default privileges in schema subjective   grant all on tables to service_role;
alter default privileges in schema metrics      grant all on tables to service_role;
