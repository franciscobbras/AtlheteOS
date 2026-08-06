# Nexus — Trabalho de 2026-07-31

Automação da ingestão (pg_cron) + sistema de notificações operacionais.
Resumo de tudo o que foi feito, passo a passo, com o *porquê* de cada decisão
e o incidente que ocorreu a meio.

> **Âmbito:** este documento cobre só o dia **2026-07-31**. O trabalho anterior
> (Edge Functions `ingest-wearable` / `ingest-intraday`, tabelas `wearable.*`,
> backfill, box `wearable_raw`) foi de sessões anteriores.

---

## 0. Ponto de partida e verificação inicial

Antes de escrever nada, verifiquei o estado **real** da base de dados remota
(projeto ligado `owdabspslxibnyybtcxx`).

**Achado importante:** nem o schema `ops`, nem a tabela `ops.notifications`, nem
a extensão `pg_cron` existiam de facto na BD naquele momento — ao contrário do
que o briefing assumia ("as tabelas já existem, não as crias").

- Schemas presentes: `public, wearable, subjective, metrics` (+ sistema).
- Extensões: `pg_stat_statements, pgcrypto, supabase_vault, uuid-ossp` — **sem
  pg_cron nem pg_net**.

Por isso **parei e perguntei** como avançar em vez de assumir. A resposta trouxe
os ficheiros de migração (escritos a meio da tarefa) + 3 pré-requisitos:
ativar `pg_cron`/`pg_net`, repor `verify_jwt` nas funções, e semear no Vault um
quarto segredo `service_role_key`.

---

## 1. Reconciliação com as migrações fornecidas + bug corrigido

Cheguei a criar 3 migrações minhas antes de perceber que tu tinhas escrito as
tuas próprias (percebi pelos timestamps dos ficheiros). **Apaguei as minhas** e
trabalhei sobre as tuas para não duplicar:

- `20260730000000_ops_notifications.sql` — schema `ops` + tabela `notifications`.
- `20260730000001_pg_cron_schedule.sql` — extensões, wrapper `trigger_edge_function`, 5 cron jobs.

**Bug real encontrado e corrigido** nessas migrações: os cron jobs invocavam
`?metric=hr` mas a função `ingest-intraday` só reconhece `?series=hr`. Sem a
correção, **cada tick do cron ia buscar sempre as três séries** em vez da série
pretendida (e o HR nunca correria isolado como planeado, por causa do volume).
Substituí `?metric=` → `?series=` nos 5 jobs.

Também acrescentei um grant à migração da tabela:
`grant select on ops.notifications to service_role` — necessário porque o
dedupe-check do `notifyOnce` (ver §4) **lê** antes de escrever.

---

## 2. Tarefa 1 — Retomada forward-only do HR

**Ficheiro:** [`supabase/functions/ingest-intraday/ingest.ts`](../supabase/functions/ingest-intraday/ingest.ts)

No arranque de cada corrida de uma série **contínua** (só o `hr`), a função
consulta agora o `timestamp_utc` mais recente já gravado em
`wearable.heart_rate` e começa a puxar a partir daí (`+1ms`, para nunca
re-buscar o último ponto), em vez de desde o início do dia.

**Porquê:** o HR é amostrado a cada ~2–3s (~36k pontos/dia). Um cron a correr de
poucos em poucos minutos não pode re-paginar o dia inteiro a cada tick — só
precisa do que aterrou desde a última corrida com sucesso. Fallback para o
início da janela pedida quando a tabela está vazia (cold start).

A idempotência já existente (`upsert onConflict (timestamp_utc, source)`)
mantém-se — se a retomada e a janela se sobrepuserem, o upsert é inofensivo.

**Ajuste relacionado** em [`ingest-intraday/index.ts`](../supabase/functions/ingest-intraday/index.ts):
quando se chama `?series=hr` sem janela explícita, o limite superior passou a
ser **agora** (não fim-de-ontem). Sem isto, o HR ficaria eternamente preso a
puxar um teto de um dia atrás, já que o início vem do watermark.

---

## 3. Arquitetura das notificações — sem tabela de estado

Decisão de desenho antes de codificar Tarefas 2/3: **não** criar uma tabela de
estado de retry no Postgres. O próprio calendário do `pg_cron` **já é** a
política de retry (ver §6). Cada invocação da função é stateless; só precisa de:

1. reconhecer, pelo relógio, se *este* tick é a última tentativa agendada; e
2. escrever no máximo uma notificação por incidente (dedupe).

Isto evita uma segunda fonte de verdade e mantém a função simples.

---

## 4. Helper partilhado `notifyOnce`

**Ficheiro criado:** [`supabase/functions/_shared/notify.ts`](../supabase/functions/_shared/notify.ts)

Um único escritor de `ops.notifications`, usado pelas duas funções.
`notifyOnce()` faz:

- **SELECT** por notificações não resolvidas do mesmo `type` (e mesmo
  `dedupe_key`, guardado em `context.dedupe_key`);
- se já houver uma aberta → não faz nada (o cron dispara de N em N minutos e não
  pode encher a tabela enquanto o incidente decorre);
- caso contrário → **INSERT**.

O "marcar resolvido" humano (§7) é o que permite uma nova notificação para um
incidente *novo* do mesmo tipo.

Tipos e severidades usados:
| Situação | type | severity |
|---|---|---|
| `invalid_grant` (token expirado) | `reauth_required` | `error` |
| Falha total após esgotar retries | `ingestion_failure` | `error` |
| Dados em falta após esgotar teto | `data_missing` | `warning` |

`reauth_required` usa `dedupeKey` fixo (um token partido afeta todas as séries
por igual — uma só notificação). Os outros usam chave por série+dia.

---

## 5. Tarefas 2 + 3 — Ligação das notificações às funções

**`ingest-intraday/index.ts`:**
- `invalid_grant` / 401 / 403 → `notifyOnce(reauth_required, error)` de imediato.
- `hrv`/`spo2` com 0 linhas → só escala a `data_missing` **se já for a hora do
  teto final (12:00 UTC)**; antes disso espera-se auto-cura no próximo retry.
- Erro lançado (não data-missing) → `ingestion_failure`. Para o HR só no minuto
  final do retry (`:30`); para hrv/spo2 de imediato (o backoff interno da
  `google.ts` já esgotou, logo já *é* "esgotar retries").
- Constantes `HR_FINAL_RETRY_MINUTE = 30` e `SLEEP_FINAL_HOUR = 12` espelham o
  calendário do cron.

**`ingest-wearable/index.ts`:**
- `invalid_grant` → `reauth_required`.
- Qualquer outra falha → `ingestion_failure` de imediato (este cron só dispara
  1×/dia, sem retry a suportá-lo, portanto qualquer falha já é terminal).

Todas as chamadas a `notifyOnce` estão envoltas em `.catch()` que só faz `log`
— nunca deixar a escrita da notificação partir a resposta principal da função.

---

## 6. Calendário do pg_cron (as tuas migrações)

5 jobs, todos `active`:

| jobname | schedule (UTC) | alvo |
|---|---|---|
| `nexus-hr-intraday` | `0 */3 * * *` | `ingest-intraday?series=hr` |
| `nexus-hr-intraday-retry` | `5,10,15,20,25,30 0,3,6,...` | retry HR até ~30min |
| `nexus-sleep-daily` | `30 8 * * *` | `ingest-wearable` |
| `nexus-hrv-spo2-early` | `40,50 8 * * *` | `ingest-intraday?series=hrv,spo2` |
| `nexus-hrv-spo2-retry` | `*/10 9,10,11 * * *` | retry de 10 em 10 min |
| `nexus-hrv-spo2-final` | `0 12 * * *` | última tentativa |

Autenticação: os jobs chamam `ops.trigger_edge_function(path)`, que lê a
`service_role_key` do Vault em runtime e faz `net.http_post` com `Bearer`.
A key **não** fica embutida na definição do job (ficaria visível em `cron.job`).

---

## 7. Tarefa 4 — UI de notificações

**Criados:**
- [`src/components/NotificationsPanel.tsx`](../src/components/NotificationsPanel.tsx)
- [`src/app/notifications/page.tsx`](../src/app/notifications/page.tsx) (`dynamic = 'force-dynamic'`)
- Entrada na sidebar ([`src/components/Sidebar.tsx`](../src/components/Sidebar.tsx)): ícone sino + link `Notificações`.

Lista `ops.notifications` por `created_at_utc desc`, mostra title/detail/type/
severity em texto simples, e um botão **"Marcar resolvido"** que faz
`UPDATE resolved=true, resolved_at_utc=now()` na própria linha.
**Deliberadamente mínima**: sem filtros, sem paginação, **sem cores/ícones por
severidade** — essa hierarquia visual está adiada por decisão tua.

---

## 8. config.toml + exposição do schema

**Ficheiro:** [`supabase/config.toml`](../supabase/config.toml)
- Adicionado `ops` à lista de `schemas` expostos (para o PostgREST/UI lerem).
- `verify_jwt` reposto a `true` nas duas funções (estavam a `false` da fase
  manual; agora que estão num cron público, têm de exigir JWT — o cron
  autentica-se com a service_role key).

---

## 9. ⚠️ INCIDENTE — `supabase config push` sobrescreveu Auth de produção

Para expor o schema `ops` no projeto remoto corri `supabase config push`.
O `config.toml` deste repo é **parcial** (só `[api]` e `[functions]`); o CLI
preencheu as secções em falta com **defaults locais** e aplicou-as ao projeto
**real**, antes de falhar na secção Storage.

**Estragos causados (temporariamente):**
- `site_url` → `http://127.0.0.1:3000`
- `uri_allow_list` (redirects OAuth) → `https://127.0.0.1:3000`
- MFA TOTP enroll/verify → desligados
- `mailer_autoconfirm` → ligado; `smtp_max_frequency` → 1s; `mailer_otp_length` → 6

A falha na secção Storage (`vector buckets` requer plano pago) foi o que me
alertou. **Reverti tudo de imediato** via Management API (`PATCH .../config/auth`),
repondo os 7 campos para os valores mostrados no diff que o próprio push
imprimiu. Só a mudança pretendida (schema `ops` exposto) ficou; Storage intocado.

### Limitação honesta sobre a verificação da reversão
Pediste confirmação byte-a-byte contra o estado *antes* do incidente. **Não
consigo garantir isso:**
- O endpoint de audit logs da Management API → **404** (feature de plano
  Team/Enterprise; a org está em **plano free**, sem retenção de auditoria).
- Não há `vercel.json` nem outra fonte no repo com o domínio de produção; não é
  repositório git, logo sem histórico de commits para cruzar.
- **A única fonte dos valores "antes" é o diff impresso pelo próprio push** — ou
  seja, o output da mesma operação que causou o problema, não um registo
  independente.

Restaurei com base nesse diff e os valores atuais conferem com ele, mas **não
tenho prova externa e independente** de que o diff capturou o estado completo e
correto anterior.

> **Lição aplicada:** não voltar a correr `supabase config push` sem aviso
> prévio enquanto o `config.toml` for parcial. A exposição de schema podia ter
> sido feita só pelo Dashboard ou por Management API dirigida ao endpoint
> `/postgrest`, sem tocar em `[auth]`/`[storage]`.

---

## 10. Segredo do Vault semeado

Semeado o quarto segredo `service_role_key` no Vault
(`vault.create_secret(...)`), usando a service_role key do projeto. Sem ele o
`trigger_edge_function` não autentica e todos os cron jobs falhariam.
Confirmado: o Vault tem agora `google_client_id`, `google_client_secret`,
`google_refresh_token`, `service_role_key`.

---

## 11. ⚠️ Segundo bug apanhado — timeout do pg_net a 5000ms

**Ficheiro criado:** [`supabase/migrations/20260731000000_fix_cron_trigger_timeout.sql`](../supabase/migrations/20260731000000_fix_cron_trigger_timeout.sql)

Ao testar `ops.trigger_edge_function` ao vivo, a primeira invocação registou em
`net._http_response`: **`timed_out = true` aos 5000ms exatos**. O wrapper usava o
timeout **omisso** do `pg_net` (5s), curto demais — a ingestão faz OAuth +
roundtrip à Google Health API e pode demorar até ~110s (o `BUDGET_MS` da
`google.ts`). **Cada tick do cron teria sido silenciosamente cortado sem nunca
chegar à Google.**

Corrigido: `net.http_post(..., timeout_milliseconds := 150000)`. Re-testei →
`status_code = 200` com resposta real da API (`points_fetched: 9987`, dryRun).

---

## 12. Deploys e aplicação

- `supabase db push` — aplicou `ops_notifications` + `pg_cron_schedule`.
- `supabase db push` (2ª vez) — aplicou a correção do timeout.
- `supabase functions deploy ingest-intraday` e `ingest-wearable` — com o código
  novo e `verify_jwt=true`.
- Apagados os ficheiros duplicados de migração que eu tinha criado por engano.

---

## 13. Verificações finais (queries diretas, não resumos)

**Grants em `ops.notifications`:**
```
authenticated | SELECT
authenticated | UPDATE       ← sem INSERT, sem DELETE ✔
service_role  | INSERT
service_role  | SELECT        ← p/ dedupe-check do notifyOnce
postgres      | (dono, ALL)
```

**RLS:** `relrowsecurity = true` (ativa) ✔

**Enforcement de JWT:** chamada sem token → **HTTP 401** ✔

**Caminho de escrita das notificações (teste funcional ao vivo):**
- INSERT via service_role → sucesso (linha criada e depois **apagada**).
- SELECT via anon → **bloqueado** (`permission denied for schema ops`) ✔
- INSERT via anon → **bloqueado** ✔

**Typecheck** (`tsc --noEmit`) → limpo. `/life` e `/notifications` → HTTP 200.

**Tabela `ops.notifications`** → 0 linhas (dry-runs não escrevem, como esperado).

---

## 14. Estado operacional — o que está vivo vs. o que falta acontecer

### Pipeline automático
- **Configurado e provado mecanicamente**, mas **ainda não correu sozinho**.
- `cron.job` → 5 jobs `active`.
- `cron.job_run_details` → **vazio**: zero disparos automáticos até agora. É
  esperado — os jobs foram criados à tarde, depois da janela de sono/HRV/SpO2
  de hoje (08:30–12:00 UTC) já ter passado.
- **Provado à mão:** `trigger_edge_function` → pg_net → função → JWT → Google →
  `200`. A cablagem completa funciona.
- **Próximos disparos reais:** HR às **15:00 UTC de hoje**; sono + HRV/SpO2
  **amanhã ~08:30–12:00 UTC**.

### Notificações
- **Mecanicamente 100% operacionais** (escrita, leitura, RLS, dedupe testados).
- **Ainda não exercitadas por uma falha real** — não houve `invalid_grant` nem
  retry esgotado desde o deploy, portanto o `notifyOnce` nunca disparou a partir
  de um incidente genuíno. Não forcei isso de propósito (implicaria corromper o
  refresh token de produção da Google).

---

## 15. Pendências (decisões tuas / não feito hoje)
- Observar `cron.job_run_details` e `ops.notifications` após 15:00 UTC / amanhã
  de manhã, para confirmar disparos e ingestão reais.
- Hierarquia visual das notificações (cores/ícones/filtros) — adiada.
- Confirmação byte-a-byte do Auth pré-incidente — **não possível** com o plano
  atual (ver §9); se quiseres certeza, reveres tu no Dashboard → Authentication
  → URL Configuration os valores de `site_url` e redirect URLs.

---

## Índice de ficheiros tocados hoje

**Criados:**
- `supabase/functions/_shared/notify.ts`
- `supabase/migrations/20260731000000_fix_cron_trigger_timeout.sql`
- `src/components/NotificationsPanel.tsx`
- `src/app/notifications/page.tsx`
- `docs/2026-07-31-automacao-ingestao-e-notificacoes.md` (este documento)

**Editados:**
- `supabase/migrations/20260730000000_ops_notifications.sql` (grant service_role SELECT)
- `supabase/migrations/20260730000001_pg_cron_schedule.sql` (`?metric=`→`?series=`)
- `supabase/functions/ingest-intraday/index.ts` (janela HR + notificações)
- `supabase/functions/ingest-intraday/ingest.ts` (retomada forward-only HR)
- `supabase/functions/ingest-wearable/index.ts` (notificações)
- `supabase/config.toml` (expor `ops`, `verify_jwt=true`)
- `src/components/Sidebar.tsx` (ícone + link Notificações)

**Ações remotas:** 2× `db push`, 2× `functions deploy`, 1× `config push`
(incidente, revertido), exposição do schema `ops`, seed do segredo Vault,
testes de trigger e de notificação (linha de teste apagada).
