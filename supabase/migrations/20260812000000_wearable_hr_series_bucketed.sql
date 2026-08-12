-- =====================================================================
-- NEXUS — Agregação de HR por bucket, do lado do SQL
-- =====================================================================
-- O gráfico da sessão de treino precisa da série de HR à resolução de
-- APRESENTAÇÃO (médias por bucket de N segundos), não do cru. Um treino de
-- 2h30 são ~4500 pontos de HR; trazer isso todo para o telemóvel foi o que já
-- causou lentidão no dashboard. A agregação vive aqui, no SQL, filtrando por
-- timestamp_utc (coberto pelo índice único (timestamp_utc, source)) ANTES de
-- agrupar. O cru fica intacto — isto é escolha de renderização, não de
-- armazenamento.
--
-- Espelha a lógica pura de resolveHeartRateSource() em src/lib/metrics.ts: os
-- buckets são alinhados ao epoch absoluto (floor(epoch/bucket)*bucket), para que
-- o gráfico (SQL) e o TRIMP (função pura, do lado do servidor) concordem no
-- mesmo enquadramento e sessões diferentes sejam comparáveis à vista.
--
-- SEGURANÇA: SECURITY INVOKER (default) — a RLS de wearable.heart_rate aplica-se
-- na mesma (authenticated). set search_path = ''. EXECUTE só a authenticated e
-- service_role (o TRIMP server-side vai reusar). Nada para public/anon.
--
-- SÓ LEITURA. Não altera tabelas nem dados.
-- =====================================================================

create or replace function wearable.hr_series_bucketed(
  p_from           timestamptz,
  p_to             timestamptz,
  p_bucket_seconds integer default 30
)
returns table (
  bucket_start_utc timestamptz,
  bpm              numeric,
  n                integer,
  source           text
)
language sql
security invoker
stable
set search_path = ''
as $$
  select
    pg_catalog.to_timestamp(
      pg_catalog.floor(pg_catalog.extract(epoch from hr.timestamp_utc) / greatest(p_bucket_seconds, 1))
        * greatest(p_bucket_seconds, 1)
    ) as bucket_start_utc,
    pg_catalog.round(pg_catalog.avg(hr.bpm), 1) as bpm,
    pg_catalog.count(*)::integer               as n,
    hr.source
  from wearable.heart_rate hr
  where hr.timestamp_utc >= p_from
    and hr.timestamp_utc <  p_to
  group by 1, hr.source
  order by 1;
$$;

comment on function wearable.hr_series_bucketed(timestamptz, timestamptz, integer) is
  'Série de HR média por bucket de N segundos (alinhado ao epoch absoluto) num intervalo. Agregação no SQL para o gráfico de treino não trazer o cru todo. SÓ LEITURA; RLS aplica-se (security invoker).';

-- As funções nascem com EXECUTE para PUBLIC — revogar e conceder só ao que deve.
revoke execute on function wearable.hr_series_bucketed(timestamptz, timestamptz, integer) from public;
do $$
begin
  if to_regrole('anon') is not null then
    execute 'revoke execute on function wearable.hr_series_bucketed(timestamptz, timestamptz, integer) from anon';
  end if;
end
$$;
grant execute on function wearable.hr_series_bucketed(timestamptz, timestamptz, integer) to authenticated, service_role;
