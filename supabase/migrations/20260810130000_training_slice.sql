-- =====================================================================
-- NEXUS — Fatia de treino: apparatus + sessions + training_blocks + segments
-- =====================================================================
-- Substitui 20260809120000 e 20260810120000 (nenhuma aplicada).
--
-- Nenhuma destas tabelas existia, o que permite criar training_blocks já com
-- apparatus_id uuid a referenciar training.apparatus: nunca existe coluna de
-- texto livre, não há backfill por nome nem migração de tipo mais tarde.
--
-- ── MODELAÇÃO DA PAUSA ───────────────────────────────────────────────
-- Um bloco NÃO é um intervalo contínuo — é um CONJUNTO de intervalos.
-- Barra com uma pausa a meio são dois períodos com UM só RPE.
--
--   training_blocks   = contentor (aparelho, rpe, feeling, notas)
--   block_segments    = os períodos reais de tempo
--
--   Pausar  → fecha o segmento aberto; o BLOCO continua aberto
--   Retomar → abre segmento novo no MESMO bloco
--   Fechar  → status='closed' + RPE
--
-- O tempo "unidentified" não precisa de linha nenhuma: é o tempo da sessão
-- NÃO coberto por nenhum segmento. Derivado por query, não guardado.
-- O cruzamento com o H10 sai de graça — rr_intervals que caiam fora de
-- qualquer segmento não correspondem a aparelho nenhum, coerente com a regra
-- já decidida de cruzar bloco↔sinal por query time e nunca marcar o raw.
--
-- Consequências desejadas:
--   • UM RPE por bloco, não um por cada regresso ao aparelho
--   • duração do bloco = soma dos segmentos, JÁ sem pausas (é o que o sRPE
--     precisa; a duração da SESSÃO, essa, continua a incluí-las)
--   • apparatus_id volta a ser NOT NULL — deixaram de existir blocos-pausa
--
-- start_utc/end_utc NÃO existem em training_blocks: seriam min/max dos
-- segmentos, portanto derivados. Derivado não se guarda como verdade.
--
-- Convenções: um só utilizador (sem user_id), RLS com auth.uid() is not null,
-- timestamptz UTC + utc_offset_seconds, authenticated SELECT/INSERT/UPDATE,
-- NUNCA DELETE.
-- =====================================================================


create schema if not exists training;
grant usage on schema training to authenticated;
alter default privileges in schema training revoke execute on functions from public;


-- =====================================================================
-- 1. training.apparatus — tabela de referência
-- =====================================================================

create table if not exists training.apparatus (
  id             uuid        primary key default gen_random_uuid(),
  name           text        not null,
  parent_id      uuid        null references training.apparatus(id),
  sort_order     integer     not null,
  active         boolean     not null default true,
  created_at_utc timestamptz not null default now(),
  constraint apparatus_name_unique     unique (name),
  constraint apparatus_not_self_parent check (parent_id is null or parent_id <> id)
);

comment on column training.apparatus.parent_id is
  'Presente desde a criação para subdividir categorias mais tarde (ex.: Flexibilidade → ativa/passiva) sem migração numa tabela com dados. Hierarquia de UM nível, imposta por trigger.';
comment on column training.apparatus.sort_order is
  'Ordem na UI de escolha manual, NÃO alfabética. Sem unique de propósito: inserir entre dois existentes obrigaria a renumerar tudo.';
comment on column training.apparatus.active is
  'Desativar em vez de apagar. Blocos antigos continuam a apontar para aparelhos desativados.';

create index if not exists idx_apparatus_sort on training.apparatus (sort_order) where active;

create or replace function training.apparatus_check_hierarchy()
returns trigger
language plpgsql
as $$
begin
  if new.parent_id is not null then
    if exists (select 1 from training.apparatus where id = new.parent_id and parent_id is not null) then
      raise exception 'Hierarquia limitada a 1 nível: % não pode ser pai porque já tem pai.', new.parent_id;
    end if;
    if exists (select 1 from training.apparatus where parent_id = new.id) then
      raise exception 'Aparelho % já tem filhos; não pode passar a ser filho.', new.id;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_apparatus_hierarchy on training.apparatus;
create trigger trg_apparatus_hierarchy
  before insert or update of parent_id on training.apparatus
  for each row execute function training.apparatus_check_hierarchy();

insert into training.apparatus (name, sort_order, parent_id, active) values
  ('Solo',           1,  null, true),
  ('Cavalo',         2,  null, true),
  ('Argolas',        3,  null, true),
  ('Saltos',         4,  null, true),
  ('Paralelas',      5,  null, true),
  ('Barra',          6,  null, true),
  ('Aquecimento',    7,  null, true),
  ('Trampolim',      8,  null, true),
  ('Airtrack',       9,  null, true),
  ('Flexibilidade',  10, null, true),
  ('Mobilidade',     11, null, true),
  ('Musculação',     12, null, true),
  ('Cardio',         13, null, true)
on conflict (name) do nothing;


-- =====================================================================
-- 2. training.sessions — contentor temporal
-- =====================================================================

create table if not exists training.sessions (
  id                 uuid        primary key default gen_random_uuid(),
  start_utc          timestamptz not null,
  end_utc            timestamptz null,
  utc_offset_seconds integer     not null,
  overall_feeling    smallint    null,
  session_load       numeric     null,
  notes              text        null,
  extra              jsonb       null,
  created_at_utc     timestamptz not null default now(),

  constraint sessions_end_after_start check (end_utc is null or end_utc > start_utc),
  constraint sessions_feeling_range   check (overall_feeling is null or overall_feeling between 0 and 10)
);

comment on table training.sessions is
  'Sessão de treino. A duração da sessão INCLUI pausas; a soma dos blocos NÃO.';
comment on column training.sessions.end_utc is
  'Null enquanto a sessão está aberta (marcação ao vivo).';
comment on column training.sessions.session_load is
  'Carga sRPE calculada ao fechar. Guardado por conveniência de leitura, recalculável a partir dos blocos e segmentos.';
comment on column training.sessions.extra is
  'Campos EXPERIMENTAIS e temporários (Experiments). Nullable, sem default. O permanente ganha coluna própria.';

create index if not exists idx_sessions_start on training.sessions (start_utc desc);

-- Uma só sessão aberta de cada vez.
create unique index if not exists uq_sessions_one_open
  on training.sessions ((true)) where end_utc is null;


-- =====================================================================
-- 3. training.training_blocks — contentor por aparelho
-- =====================================================================

create table if not exists training.training_blocks (
  id             uuid        primary key default gen_random_uuid(),
  session_id     uuid        not null references training.sessions(id) on delete restrict,
  apparatus_id   uuid        not null references training.apparatus(id) on delete restrict,
  status         text        not null default 'active',
  rpe            smallint    null,
  feeling        smallint    null,
  as_planned     boolean     null,
  notes          text        null,
  extra          jsonb       null,
  created_at_utc timestamptz not null default now(),

  constraint blocks_status_valid  check (status in ('active', 'closed')),
  constraint blocks_rpe_range     check (rpe is null or rpe between 0 and 10),
  constraint blocks_feeling_range check (feeling is null or feeling between 0 and 10)
);

comment on table training.training_blocks is
  'Contentor de um período de trabalho num aparelho. NÃO tem start/end: o tempo real vive em block_segments (min/max seriam derivados). Um bloco pode ter vários segmentos se houver pausas pelo meio, mas leva UM só RPE.';
comment on column training.training_blocks.apparatus_id is
  'FK desde a origem — nunca existiu coluna de texto livre. NOT NULL: pausas não são blocos, são ausência de segmento.';
comment on column training.training_blocks.status is
  'Ciclo de vida: active (a decorrer ou EM PAUSA) / closed (RPE dado). Pausar NÃO fecha o bloco.';

create index if not exists idx_blocks_session   on training.training_blocks (session_id);
create index if not exists idx_blocks_apparatus on training.training_blocks (apparatus_id);

-- Um só bloco aberto por sessão. Mudar de aparelho exige fechar o atual
-- (e dar o RPE). Pausar mantém o bloco aberto.
create unique index if not exists uq_blocks_one_active_per_session
  on training.training_blocks (session_id) where status = 'active';


-- =====================================================================
-- 4. training.block_segments — os períodos reais de tempo
-- =====================================================================

create table if not exists training.block_segments (
  id             uuid        primary key default gen_random_uuid(),
  block_id       uuid        not null references training.training_blocks(id) on delete restrict,
  start_utc      timestamptz not null,
  end_utc        timestamptz null,
  created_at_utc timestamptz not null default now(),

  constraint segments_end_after_start check (end_utc is null or end_utc > start_utc)
);

comment on table training.block_segments is
  'Períodos contínuos de trabalho dentro de um bloco. Pausar fecha o segmento (o bloco fica aberto); retomar abre um segmento novo no mesmo bloco. O tempo da sessão NÃO coberto por nenhum segmento É a pausa — não precisa de linha própria.';
comment on column training.block_segments.end_utc is
  'Null enquanto o segmento está a decorrer.';

create index if not exists idx_segments_block on training.block_segments (block_id);
create index if not exists idx_segments_start on training.block_segments (start_utc desc);

-- Um só segmento aberto por bloco. Combinado com uq_blocks_one_active_per_session,
-- garante no máximo UM segmento aberto em toda a sessão — sem denormalizar
-- session_id para os segmentos.
create unique index if not exists uq_segments_one_open_per_block
  on training.block_segments (block_id) where end_utc is null;


-- =====================================================================
-- 5. RLS + grants
-- =====================================================================

alter table training.apparatus       enable row level security;
alter table training.sessions        enable row level security;
alter table training.training_blocks enable row level security;
alter table training.block_segments  enable row level security;

drop policy if exists apparatus_select_authenticated on training.apparatus;
create policy apparatus_select_authenticated on training.apparatus
  for select using (auth.uid() is not null);

drop policy if exists sessions_rw_authenticated on training.sessions;
create policy sessions_rw_authenticated on training.sessions
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

drop policy if exists blocks_rw_authenticated on training.training_blocks;
create policy blocks_rw_authenticated on training.training_blocks
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

drop policy if exists segments_rw_authenticated on training.block_segments;
create policy segments_rw_authenticated on training.block_segments
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

-- apparatus é referência: só leitura pela app. Escrita por migração.
revoke all on training.apparatus from public, anon, authenticated;
grant select on training.apparatus to authenticated;

revoke all on training.sessions        from public, anon, authenticated;
revoke all on training.training_blocks from public, anon, authenticated;
revoke all on training.block_segments  from public, anon, authenticated;
grant select, insert, update on training.sessions        to authenticated;
grant select, insert, update on training.training_blocks to authenticated;
grant select, insert, update on training.block_segments  to authenticated;

revoke execute on function training.apparatus_check_hierarchy() from public, anon, authenticated;


-- =====================================================================
-- 6. VERIFICAÇÕES
-- =====================================================================
do $$
declare
  v_total  integer;
  v_dups   text;
  v_extra  integer;
  v_delete text;
  v_rls    text;
  v_cols   integer;
  v_outros text;
begin
  select count(*) into v_total from training.apparatus where active;
  if v_total <> 13 then
    raise exception 'Esperados 13 aparelhos ativos, encontrados %', v_total;
  end if;

  select string_agg(sort_order::text, ', ') into v_dups
  from (select sort_order from training.apparatus group by sort_order having count(*) > 1) d;
  if v_dups is not null then
    raise exception 'sort_order duplicados: %', v_dups;
  end if;

  -- apparatus_id é uuid NOT NULL (pausas deixaram de ser blocos)
  select count(*) into v_cols
  from information_schema.columns
  where table_schema = 'training' and table_name = 'training_blocks'
    and column_name = 'apparatus_id' and data_type = 'uuid' and is_nullable = 'NO';
  if v_cols <> 1 then
    raise exception 'training_blocks.apparatus_id não é uuid NOT NULL';
  end if;

  -- training_blocks NÃO deve ter start_utc/end_utc (derivados dos segmentos)
  select count(*) into v_cols
  from information_schema.columns
  where table_schema = 'training' and table_name = 'training_blocks'
    and column_name in ('start_utc', 'end_utc');
  if v_cols <> 0 then
    raise exception 'training_blocks tem start_utc/end_utc — deviam ser derivados dos segmentos';
  end if;

  -- `extra` jsonb nullable nas duas tabelas que o levam
  select count(*) into v_extra
  from information_schema.columns
  where table_schema = 'training' and table_name in ('training_blocks', 'sessions')
    and column_name = 'extra' and data_type = 'jsonb' and is_nullable = 'YES';
  if v_extra <> 2 then
    raise exception '`extra` jsonb nullable presente em % de 2 tabelas', v_extra;
  end if;

  -- RLS nas quatro
  select string_agg(c.relname, ', ') into v_rls
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'training'
    and c.relname in ('apparatus', 'sessions', 'training_blocks', 'block_segments')
    and not c.relrowsecurity;
  if v_rls is not null then
    raise exception 'RLS inativa em: %', v_rls;
  end if;

  -- Nenhum DELETE em training
  select string_agg(distinct format('%s→%s', table_name, grantee), ', ') into v_delete
  from information_schema.role_table_grants
  where table_schema = 'training' and privilege_type = 'DELETE'
    and grantee in ('PUBLIC', 'anon', 'authenticated');
  if v_delete is not null then
    raise exception 'DELETE concedido em training: %', v_delete;
  end if;

  -- Relatório (não falha): bug pendente noutros schemas
  select string_agg(distinct format('%s.%s→%s', table_schema, table_name, grantee), ', ')
    into v_outros
  from information_schema.role_table_grants
  where table_schema in ('wearable', 'metrics', 'subjective', 'ops')
    and privilege_type = 'DELETE'
    and grantee in ('PUBLIC', 'anon', 'authenticated');
  if v_outros is not null then
    raise notice 'BUG PENDENTE — DELETE ainda concedido em: %. Tratar em migração própria.', v_outros;
  end if;

  raise notice 'OK — 13 aparelhos; sessions, blocks e segments criadas; pausa = ausência de segmento; RLS ativa; sem DELETE.';
end
$$;


-- ---------------------------------------------------------------------
-- Consultas de referência (para o metrics.ts / UI):
--
--   -- duração real de cada bloco (JÁ sem pausas)
--   select b.id, b.apparatus_id, b.rpe,
--          sum(extract(epoch from (s.end_utc - s.start_utc)))/60 as minutos
--   from training.training_blocks b
--   join training.block_segments s on s.block_id = b.id
--   where b.session_id = $1 and s.end_utc is not null
--   group by b.id;
--
--   -- sRPE da sessão = Σ (rpe × minutos do bloco)
--
--   -- tempo em pausa = duração da sessão − Σ duração dos segmentos
--
--   -- H10 sem aparelho atribuído: rr_intervals cujo timestamp não cai
--   -- dentro de nenhum segmento da sessão (anti-join por timestamp)
-- ---------------------------------------------------------------------
