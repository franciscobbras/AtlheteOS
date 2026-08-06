-- ============================================================
-- NEXUS — Séries fisiológicas intraday (Fitbit Air / Google Health API)
-- wearable.heart_rate, wearable.hrv_instant, wearable.spo2
--
-- Convenções do projeto aplicadas:
--   - Utilizador único: SEM user_id
--   - Timestamps UTC + utc_offset_seconds ao lado
--   - source onde coexistem fontes
--   - SEM coluna raw: intraday de alta frequência não preserva JSON
--     (custo de storage sem valor de recuperação)
--   - Cru é a verdade: a "noite" não é gravada, deriva-se em runtime
--     cruzando com wearable.sleep
-- ============================================================

-- ------------------------------------------------------------
-- HR contínuo 24/7 — a série mais densa do sistema
-- ------------------------------------------------------------
create table wearable.heart_rate (
  id                  uuid primary key default gen_random_uuid(),
  timestamp_utc       timestamptz not null,
  utc_offset_seconds  integer not null,
  bpm                 integer not null,
  source              text not null,
  recording_method    text,

  constraint heart_rate_ts_source_unique unique (timestamp_utc, source)
);

comment on table wearable.heart_rate is
  'HR contínuo 24/7 (Fitbit Air). Série densa: milhares de linhas/dia. Candidata a particionamento por mês quando crescer.';


-- ------------------------------------------------------------
-- HRV instantânea — essencialmente durante o sono
-- ------------------------------------------------------------
create table wearable.hrv_instant (
  id                  uuid primary key default gen_random_uuid(),
  timestamp_utc       timestamptz not null,
  utc_offset_seconds  integer not null,
  rmssd_ms            numeric not null,
  source              text not null,

  constraint hrv_instant_ts_source_unique unique (timestamp_utc, source)
);

comment on table wearable.hrv_instant is
  'HRV instantânea (~80-100 pontos/noite). A janela "noite" deriva-se cruzando com wearable.sleep, não se guarda.';
comment on column wearable.hrv_instant.rmssd_ms is
  'RMSSD CRU em ms. O LnRMSSD é aplicado em metrics.ts, nunca na ingestão.';


-- ------------------------------------------------------------
-- SpO2 intraday
-- ------------------------------------------------------------
create table wearable.spo2 (
  id                  uuid primary key default gen_random_uuid(),
  timestamp_utc       timestamptz not null,
  utc_offset_seconds  integer not null,
  percentage          numeric not null,
  source              text not null,

  constraint spo2_ts_source_unique unique (timestamp_utc, source)
);

comment on table wearable.spo2 is
  'SpO2 intraday (Fitbit Air), maioritariamente durante o sono.';


-- ------------------------------------------------------------
-- NOTA SOBRE ÍNDICES
-- Não são criados índices separados em timestamp_utc.
-- A constraint única (timestamp_utc, source) já cria um índice
-- btree com timestamp_utc como coluna PRINCIPAL, que serve
-- exatamente as queries por intervalo de tempo. Um índice extra
-- só em timestamp_utc seria redundante: mesma capacidade de
-- pesquisa, mais espaço em disco, e escrita mais lenta em cada
-- INSERT — o que penaliza precisamente a heart_rate, a tabela
-- mais densa.
-- Se mais tarde as queries filtrarem por source PRIMEIRO, aí sim
-- vale a pena um índice (source, timestamp_utc). Não é o caso hoje.
-- ------------------------------------------------------------


-- ------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------
alter table wearable.heart_rate  enable row level security;
alter table wearable.hrv_instant enable row level security;
alter table wearable.spo2        enable row level security;

create policy "authenticated_all" on wearable.heart_rate
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

create policy "authenticated_all" on wearable.hrv_instant
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

create policy "authenticated_all" on wearable.spo2
  for all using (auth.uid() is not null) with check (auth.uid() is not null);


-- ------------------------------------------------------------
-- GRANTS
-- Os default privileges do schema wearable concedem ALL a
-- authenticated (incluindo DELETE). Como a regra pedida é
-- SELECT/INSERT/UPDATE sem DELETE, é preciso revogar
-- explicitamente — os defaults não fazem isto sozinhos.
-- service_role mantém tudo (é quem corre a ingestão).
-- anon não recebe nada.
-- ------------------------------------------------------------
revoke delete on wearable.heart_rate  from authenticated;
revoke delete on wearable.hrv_instant from authenticated;
revoke delete on wearable.spo2        from authenticated;

revoke all on wearable.heart_rate  from anon;
revoke all on wearable.hrv_instant from anon;
revoke all on wearable.spo2        from anon;
