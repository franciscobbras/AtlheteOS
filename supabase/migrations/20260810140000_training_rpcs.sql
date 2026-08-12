-- =====================================================================
-- NEXUS — RPCs atómicas para o registo de treino ao vivo
-- =====================================================================
-- O cliente Supabase não faz transações multi-statement. Estas funções
-- agrupam pares de escritas que só fazem sentido juntos.
--
-- O caso mau que motivou isto: insert do bloco passa, insert do segmento
-- falha → bloco 'active' sem segmento, e o índice único impede abrir
-- qualquer outro. Ficava-se preso a meio do treino sem saída pela UI.
--
-- SEGURANÇA:
--   • SECURITY INVOKER (default) em todas. O papel `authenticated` já tem
--     INSERT/UPDATE nestas tabelas via RLS — não é preciso escalar
--     privilégios, e DEFINER foi o que abriu o buraco no ops.
--   • `set search_path = ''` + nomes totalmente qualificados.
--   • EXECUTE revogado a public/anon, concedido só a authenticated.
--
-- TIMESTAMPS: sempre pg_catalog.now() no servidor. O relógio do telemóvel
-- não é fonte de verdade. `utc_offset_seconds` é a exceção — é zona
-- horária, não leitura de relógio, e o servidor não a sabe.
--
-- CÓDIGOS DE ERRO (para a UI distinguir sem ler a mensagem):
--   TR001 sessão já aberta          TR020 sem segmento aberto (já em pausa)
--   TR010 sessão inexistente        TR021 bloco não está em pausa
--   TR011 sessão já fechada         TR030 RPE em falta
--   TR012 bloco ativo já existe     TR040 bloco por fechar ao fechar sessão
--   TR013 aparelho inválido
--   TR014 bloco inexistente / já fechado
-- =====================================================================


-- =====================================================================
-- 1. start_session
-- =====================================================================
create or replace function training.start_session(
  p_utc_offset_seconds integer
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if exists (select 1 from training.sessions where end_utc is null) then
    raise exception 'Já existe uma sessão aberta. Fecha-a antes de começar outra.'
      using errcode = 'TR001';
  end if;

  insert into training.sessions (start_utc, utc_offset_seconds)
  values (pg_catalog.now(), p_utc_offset_seconds)
  returning id into v_id;

  return v_id;
end;
$$;

comment on function training.start_session(integer) is
  'Abre uma sessão. p_utc_offset_seconds é zona horária (não relógio) — o servidor não a sabe. Erro TR001 se já houver sessão aberta.';


-- =====================================================================
-- 2. open_block — bloco + primeiro segmento, ATOMICAMENTE
-- =====================================================================
create or replace function training.open_block(
  p_session_id   uuid,
  p_apparatus_id uuid
)
returns table (block_id uuid, segment_id uuid)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_block uuid;
  v_seg   uuid;
  v_end   timestamptz;
begin
  -- Lock da sessão: serializa toques rápidos seguidos na UI.
  select s.end_utc into v_end
  from training.sessions s
  where s.id = p_session_id
  for update;

  if not found then
    raise exception 'Sessão % não existe.', p_session_id using errcode = 'TR010';
  end if;

  if v_end is not null then
    raise exception 'Sessão já está fechada.' using errcode = 'TR011';
  end if;

  if exists (
    select 1 from training.training_blocks b
    where b.session_id = p_session_id and b.status = 'active'
  ) then
    raise exception 'Já existe um bloco ativo nesta sessão. Fecha-o (com RPE) antes de abrir outro.'
      using errcode = 'TR012';
  end if;

  if not exists (
    select 1 from training.apparatus a
    where a.id = p_apparatus_id and a.active
  ) then
    raise exception 'Aparelho inexistente ou inativo.' using errcode = 'TR013';
  end if;

  insert into training.training_blocks (session_id, apparatus_id, status)
  values (p_session_id, p_apparatus_id, 'active')
  returning id into v_block;

  insert into training.block_segments (block_id, start_utc)
  values (v_block, pg_catalog.now())
  returning id into v_seg;

  return query select v_block, v_seg;
end;
$$;

comment on function training.open_block(uuid, uuid) is
  'Cria bloco + primeiro segmento numa só transação. Sem isto, uma falha entre as duas escritas deixava um bloco ativo sem segmento, a bloquear a sessão.';


-- =====================================================================
-- 3. pause_block — fecha o segmento; o BLOCO continua active
-- =====================================================================
create or replace function training.pause_block(
  p_block_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_seg   uuid;
  v_start timestamptz;
begin
  select sg.id, sg.start_utc into v_seg, v_start
  from training.block_segments sg
  where sg.block_id = p_block_id and sg.end_utc is null
  for update;

  if v_seg is null then
    raise exception 'Bloco % não tem segmento aberto — já está em pausa ou fechado.', p_block_id
      using errcode = 'TR020';
  end if;

  -- greatest() protege o check end_utc > start_utc caso a pausa caia no
  -- mesmo instante da abertura (toque duplo acidental).
  update training.block_segments
  set end_utc = pg_catalog.greatest(pg_catalog.now(), v_start + interval '1 millisecond')
  where id = v_seg;

  return v_seg;
end;
$$;

comment on function training.pause_block(uuid) is
  'Pausar fecha o SEGMENTO, não o bloco. O bloco continua active e leva um só RPE no fim, para todos os segmentos.';


-- =====================================================================
-- 4. resume_block — segmento novo no MESMO bloco
-- =====================================================================
create or replace function training.resume_block(
  p_block_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_status text;
  v_seg    uuid;
begin
  select b.status into v_status
  from training.training_blocks b
  where b.id = p_block_id
  for update;

  if not found then
    raise exception 'Bloco % não existe.', p_block_id using errcode = 'TR014';
  end if;

  if v_status <> 'active' then
    raise exception 'Bloco % já está fechado — não pode ser retomado.', p_block_id
      using errcode = 'TR014';
  end if;

  if exists (
    select 1 from training.block_segments sg
    where sg.block_id = p_block_id and sg.end_utc is null
  ) then
    raise exception 'Bloco % não está em pausa (já tem segmento aberto).', p_block_id
      using errcode = 'TR021';
  end if;

  insert into training.block_segments (block_id, start_utc)
  values (p_block_id, pg_catalog.now())
  returning id into v_seg;

  return v_seg;
end;
$$;


-- =====================================================================
-- 5. close_block — fecha segmento (se houver) + grava RPE, ATOMICAMENTE
-- =====================================================================
create or replace function training.close_block(
  p_block_id   uuid,
  p_rpe        smallint,
  p_feeling    smallint default null,
  p_notes      text     default null,
  p_extra      jsonb    default null,
  p_as_planned boolean  default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_status text;
  v_seg    uuid;
  v_start  timestamptz;
begin
  if p_rpe is null then
    raise exception 'RPE é obrigatório ao fechar um bloco.' using errcode = 'TR030';
  end if;

  select b.status into v_status
  from training.training_blocks b
  where b.id = p_block_id
  for update;

  if not found then
    raise exception 'Bloco % não existe.', p_block_id using errcode = 'TR014';
  end if;

  if v_status <> 'active' then
    raise exception 'Bloco % já está fechado.', p_block_id using errcode = 'TR014';
  end if;

  -- Fecha o segmento aberto, SE houver. Um bloco em pausa fecha na mesma:
  -- os segmentos já fechados continuam válidos.
  select sg.id, sg.start_utc into v_seg, v_start
  from training.block_segments sg
  where sg.block_id = p_block_id and sg.end_utc is null
  for update;

  if v_seg is not null then
    update training.block_segments
    set end_utc = pg_catalog.greatest(pg_catalog.now(), v_start + interval '1 millisecond')
    where id = v_seg;
  end if;

  update training.training_blocks
  set status     = 'closed',
      rpe        = p_rpe,
      feeling    = coalesce(p_feeling, feeling),
      notes      = coalesce(p_notes, notes),
      extra      = coalesce(p_extra, extra),
      as_planned = coalesce(p_as_planned, as_planned)
  where id = p_block_id;

  return p_block_id;
end;
$$;

comment on function training.close_block(uuid, smallint, smallint, text, jsonb, boolean) is
  'Fecha o segmento aberto (se existir) e grava o RPE numa só transação. Funciona com o bloco em pausa. RPE obrigatório — erro TR030 se vier null.';


-- =====================================================================
-- 6. end_session — recusa fechar com bloco por fechar
-- =====================================================================
create or replace function training.end_session(
  p_session_id      uuid,
  p_overall_feeling smallint default null,
  p_notes           text     default null,
  p_extra           jsonb    default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_end    timestamptz;
  v_block  uuid;
  v_app    text;
  v_start  timestamptz;
begin
  select s.end_utc, s.start_utc into v_end, v_start
  from training.sessions s
  where s.id = p_session_id
  for update;

  if not found then
    raise exception 'Sessão % não existe.', p_session_id using errcode = 'TR010';
  end if;

  if v_end is not null then
    raise exception 'Sessão já está fechada.' using errcode = 'TR011';
  end if;

  -- NÃO fechar blocos silenciosamente: um bloco fechado sem RPE por omissão
  -- é dado perdido. A UI deve chamar get_open_block() antes e pedir o RPE.
  select b.id, a.name into v_block, v_app
  from training.training_blocks b
  join training.apparatus a on a.id = b.apparatus_id
  where b.session_id = p_session_id and b.status = 'active';

  if v_block is not null then
    raise exception 'Bloco de % ainda está aberto (id %). Fecha-o com o RPE antes de terminar a sessão.', v_app, v_block
      using errcode = 'TR040';
  end if;

  update training.sessions
  set end_utc         = pg_catalog.greatest(pg_catalog.now(), v_start + interval '1 millisecond'),
      overall_feeling = coalesce(p_overall_feeling, overall_feeling),
      notes           = coalesce(p_notes, notes),
      extra           = coalesce(p_extra, extra)
  where id = p_session_id;

  return p_session_id;
end;
$$;


-- =====================================================================
-- 7. Leitura para a UI (não pedidas — apagáveis sem afetar o resto)
-- =====================================================================

-- Sessão aberta ao abrir a app.
create or replace function training.get_open_session()
returns table (
  session_id uuid,
  start_utc  timestamptz,
  n_blocos   bigint
)
language sql
security invoker
stable
set search_path = ''
as $$
  select s.id, s.start_utc, count(b.id)
  from training.sessions s
  left join training.training_blocks b on b.session_id = s.id
  where s.end_utc is null
  group by s.id, s.start_utc;
$$;

-- Bloco aberto — a UI chama isto ANTES de end_session, para pedir o RPE
-- em falta em vez de bater no erro TR040.
create or replace function training.get_open_block(
  p_session_id uuid
)
returns table (
  block_id       uuid,
  apparatus_id   uuid,
  apparatus_name text,
  started_utc    timestamptz,
  em_pausa       boolean,
  minutos_feitos numeric
)
language sql
security invoker
stable
set search_path = ''
as $$
  select
    b.id,
    b.apparatus_id,
    a.name,
    (select min(sg.start_utc) from training.block_segments sg where sg.block_id = b.id),
    not exists (select 1 from training.block_segments sg
                where sg.block_id = b.id and sg.end_utc is null),
    coalesce((
      select sum(extract(epoch from (sg.end_utc - sg.start_utc)))/60
      from training.block_segments sg
      where sg.block_id = b.id and sg.end_utc is not null
    ), 0)
  from training.training_blocks b
  join training.apparatus a on a.id = b.apparatus_id
  where b.session_id = p_session_id and b.status = 'active';
$$;


-- =====================================================================
-- 8. GRANTS — as funções nascem com EXECUTE para PUBLIC
-- =====================================================================
-- Com o schema training exposto ao PostgREST, PUBLIC significa chamável
-- por qualquer sessão. Mesmo buraco do ops.trigger_edge_function.

alter default privileges in schema training revoke execute on functions from public;

do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'training'
      and p.prokind = 'f'
  loop
    execute format('revoke execute on function %s from public', fn.sig);
    if to_regrole('anon') is not null then
      execute format('revoke execute on function %s from anon', fn.sig);
    end if;
  end loop;

  -- Só as RPC da app levam EXECUTE. A função de trigger NÃO.
  for fn in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'training'
      and p.proname in ('start_session', 'open_block', 'pause_block',
                        'resume_block', 'close_block', 'end_session',
                        'get_open_session', 'get_open_block')
  loop
    execute format('grant execute on function %s to authenticated', fn.sig);
  end loop;
end
$$;


-- =====================================================================
-- 9. VERIFICAÇÕES
-- =====================================================================
do $$
declare
  v_expostas text;
  v_faltam   text;
begin
  -- 9a. Nenhuma função de training com EXECUTE para PUBLIC ou anon
  select string_agg(distinct p.oid::regprocedure::text, ', ') into v_expostas
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  left join lateral aclexplode(p.proacl) a on true
  where n.nspname = 'training'
    and (
      p.proacl is null                                        -- null = PUBLIC tem EXECUTE
      or (a.privilege_type = 'EXECUTE' and a.grantee = 0)     -- 0 = PUBLIC
      or (a.privilege_type = 'EXECUTE'
          and to_regrole('anon') is not null
          and a.grantee = to_regrole('anon')::oid)
    );

  if v_expostas is not null then
    raise exception 'Funções de training expostas a PUBLIC/anon: %', v_expostas;
  end if;

  -- 9b. As 8 RPC têm EXECUTE para authenticated
  select string_agg(x.nome, ', ') into v_faltam
  from unnest(array['start_session','open_block','pause_block','resume_block',
                    'close_block','end_session','get_open_session','get_open_block']) as x(nome)
  where not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(p.proacl) a
    where n.nspname = 'training' and p.proname = x.nome
      and a.privilege_type = 'EXECUTE'
      and a.grantee = to_regrole('authenticated')::oid
  );

  if v_faltam is not null then
    raise exception 'Sem EXECUTE para authenticated: %', v_faltam;
  end if;

  raise notice 'OK — 8 RPC com EXECUTE para authenticated, nenhuma função de training exposta a PUBLIC/anon.';
end
$$;


-- ---------------------------------------------------------------------
-- Verificação pós-push:
--
--   select p.proname, p.prosecdef as security_definer, p.proacl
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'training'
--   order by p.proname;
--
-- Esperado: prosecdef = false em todas; proacl nunca null; sem entradas
-- '=X/' (PUBLIC) nem 'anon=X/'.
-- ---------------------------------------------------------------------
