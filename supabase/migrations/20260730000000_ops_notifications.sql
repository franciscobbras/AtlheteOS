-- ============================================================
-- NEXUS — TAREFA 1: ops.notifications
--
-- Schema novo: `ops` — metadados operacionais (notificações de
-- falhas de ingestão, não dados de domínio). Segue a mesma
-- convenção de "schemas por natureza do dado".
--
-- Grants deliberadamente FINOS, diferentes do padrão usado nos
-- outros schemas (que dava ALL a authenticated/service_role):
--   authenticated → SELECT, UPDATE (só para marcar resolved)
--   service_role  → INSERT          (só a Edge Function escreve)
-- Nenhum papel tem DELETE nem, no caso de authenticated, INSERT.
-- ============================================================

create schema if not exists ops;
comment on schema ops is 'Metadados operacionais: notificações de ingestão, estado de jobs. Não é dado de domínio.';

grant usage on schema ops to authenticated, service_role;


create table ops.notifications (
  id                  uuid primary key default gen_random_uuid(),
  created_at_utc      timestamptz not null default now(),
  type                text not null,
  severity            text not null,
  title               text not null,
  detail              text,
  context             jsonb,
  resolved            boolean not null default false,
  resolved_at_utc     timestamptz
);

comment on table ops.notifications is
  'Notificações de falhas de ingestão e eventos operacionais. Escritas pela Edge Function (service_role), lidas/geridas pelo utilizador.';
comment on column ops.notifications.type is
  '''ingestion_failure'', ''reauth_required'', ''data_missing''';
comment on column ops.notifications.severity is
  '''info'' / ''warning'' / ''error''. Sem lógica diferenciada na UI por agora — decisão adiada.';

create index idx_notifications_unresolved
  on ops.notifications (created_at_utc desc)
  where resolved = false;

-- ------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------
alter table ops.notifications enable row level security;

create policy "authenticated_all" on ops.notifications
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

-- ------------------------------------------------------------
-- Grants explícitos (SEM usar "grant all" nem default privileges
-- em bloco — a granularidade pedida aqui é diferente do padrão
-- dos outros schemas, por isso escreve-se à mão).
-- ------------------------------------------------------------
grant select, update on ops.notifications to authenticated;
-- select: the Edge Function's dedupe check (is there already an unresolved
-- notification of this type/key open?) reads before it writes.
grant select, insert on ops.notifications to service_role;

-- anon: nada (omissão — não há grant nenhum, logo sem acesso)

-- Default privileges para tabelas FUTURAS neste schema: manter o
-- mesmo padrão fino por omissão, para não repetir o bug do DELETE
-- indevido que já corrigimos noutras tabelas.
alter default privileges in schema ops
  revoke all on tables from public;
