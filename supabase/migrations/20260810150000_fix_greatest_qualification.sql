-- =====================================================================
-- NEXUS — Correção: pg_catalog.greatest() não existe
-- =====================================================================
-- GREATEST/LEAST são CONSTRUÇÕES SQL, não funções do catálogo, portanto não
-- podem ser qualificadas com schema. Funcionam sem qualificação mesmo com
-- `search_path = ''`, porque não são resolvidas por search_path.
--
-- Afetava pause_block, close_block e end_session — todas rebentavam em
-- runtime com 42883.
--
-- create or replace preserva os grants, mas re-aplicam-se por segurança.
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

  -- greatest() sem qualificação: é sintaxe SQL, não função de catálogo.
  -- Protege o check end_utc > start_utc se a pausa cair no mesmo instante
  -- da abertura (toque duplo acidental).
  update training.block_segments
  set end_utc = greatest(pg_catalog.now(), v_start + interval '1 millisecond')
  where id = v_seg;

  return v_seg;
end;
$$;


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
    set end_utc = greatest(pg_catalog.now(), v_start + interval '1 millisecond')
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
  v_end   timestamptz;
  v_start timestamptz;
  v_block uuid;
  v_app   text;
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
  set end_utc         = greatest(pg_catalog.now(), v_start + interval '1 millisecond'),
      overall_feeling = coalesce(p_overall_feeling, overall_feeling),
      notes           = coalesce(p_notes, notes),
      extra           = coalesce(p_extra, extra)
  where id = p_session_id;

  return p_session_id;
end;
$$;


-- ---------------------------------------------------------------------
-- Re-aplicar grants (create or replace preserva, mas por segurança)
-- ---------------------------------------------------------------------
do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'training'
      and p.proname in ('pause_block', 'close_block', 'end_session')
  loop
    execute format('revoke execute on function %s from public', fn.sig);
    if to_regrole('anon') is not null then
      execute format('revoke execute on function %s from anon', fn.sig);
    end if;
    execute format('grant execute on function %s to authenticated', fn.sig);
  end loop;
end
$$;


-- ---------------------------------------------------------------------
-- Verificação
-- ---------------------------------------------------------------------
do $$
declare
  v_expostas text;
begin
  select string_agg(distinct p.oid::regprocedure::text, ', ') into v_expostas
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  left join lateral aclexplode(p.proacl) a on true
  where n.nspname = 'training'
    and (
      p.proacl is null
      or (a.privilege_type = 'EXECUTE' and a.grantee = 0)
      or (a.privilege_type = 'EXECUTE'
          and to_regrole('anon') is not null
          and a.grantee = to_regrole('anon')::oid)
    );

  if v_expostas is not null then
    raise exception 'Funções de training expostas a PUBLIC/anon: %', v_expostas;
  end if;

  raise notice 'OK — 3 funções corrigidas, grants intactos, nada exposto a PUBLIC/anon.';
end
$$;
