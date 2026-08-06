# NEXUS — Handoff: Automação da Ingestão + Notificações

> Documento para continuar o trabalho num chat novo. Resume o estado atual e as
> decisões já fechadas. Cola isto no início do chat novo (o de brainstorm/design).

---

## ESTADO ATUAL — o que já está feito

**Ingestão (capacidade completa, validada):**
- `ingest-wearable` (Edge Function) — agregados diários (HRV/RHR/temp) + sono. A correr.
- `ingest-intraday` (Edge Function) — 3 séries fisiológicas, deployada e validada:
  - `hr` → `wearable.heart_rate` — 24/7, ~36k pts/dia (a cada ~2-3s)
  - `hrv` → `wearable.hrv_instant` — só sono (~80-100 pts/noite), night-bounded
  - `spo2` → `wearable.spo2` — só sono, night-bounded
- Janela é parâmetro: `?date=` ou `?from=&to=`. Idempotente (upsert onConflict
  `(timestamp_utc, source)`). Retry+backoff para erros transitórios já embutido.
- **NENHUMA lógica de agendamento/retomada embutida** — fica para a automação (este doc).

**Dados acumulados:**
- Agregados + sono + HRV/SpO2 intraday: backfill 07-12 → 28 (16 dias) feito.
- HR intraday: **forward-only, resolução total, SEM backfill** (backfill profundo é
  inviável — 36k pts/dia, API não tem filtro de tempo server-side, ~11k páginas p/ 16 dias).
  Decisão: guardar tudo daqui para a frente, deixar os 16 dias de trás.

**Regras de ingestão já decididas:**
- HRV/SpO2: "noite" = intervalo `[start_utc, end_utc]` de `wearable.sleep`, NÃO dia UTC
  (senão corta noites à meia-noite). A noite é derivada na leitura; a série guarda-se
  como timeseries cru (timestamp + valor), sem coluna de noite.
- HR: 24/7, sem regra de noite. Offset por-ponto guardado (dia-UTC-vs-local decide-se
  na leitura).
- **Dependência de ordem:** HRV/SpO2 de uma noite precisam do sono dessa noite JÁ ingerido
  (senão não sabem o intervalo). Sono primeiro, intraday-noturno depois.

---

## DECISÕES DE AGENDAMENTO JÁ FECHADAS (implementar)

**Cadência:**
- **HR:** de 3 em 3 horas. Puxa desde o último ponto gravado (forward-only).
  Se uma corrida falhar → retry de 5 em 5 min DURANTE NO MÁXIMO ~30 min, depois
  espera a próxima janela de 3h. (Teto obrigatório — não martelar infinitamente.)
- **Sono (agregados):** corre às ~8:30 (ou antes), PORQUE a HRV/SpO2 dependem dele.
- **HRV/SpO2:** correm DEPOIS do sono, às 8:30+. Se dados não disponíveis →
  retry de 10 em 10 min ATÉ UM TETO (~meio-dia), depois desiste e regista falha.

**Erros vs. ausência de dados (tratamento diferente):**
- Ausência de dados (API ainda não sincronizou) → retry com teto (acima).
- Erro transitório (500, rede) → backoff da função (já existe).
- `invalid_grant` (token expirado) → PARA e alerta. Não insiste (não se resolve sozinho).

**Ordem às 8:30:** primeiro `ingest-wearable` (sono), depois `ingest-intraday`
(hrv+spo2). Não em paralelo — a intraday-noturna precisa do sono já lá.

---

## NOTIFICAÇÕES — decidido, por implementar

Quer **notificação no site** quando algo falha. Precisa de tabela de estado
(ponte entre cron backend e frontend). É a 1ª peça concreta da camada de alertas
já desenhada no papel (interrupt/digest do AthleteOS).

**Tabela proposta** (schema a decidir — sugestão `ops` ou `system`, próprio, porque
notificações são operacionais, não dados de saúde):

```
notifications
- id uuid
- created_at_utc timestamptz
- type text          -- 'ingestion_failure','reauth_required','data_missing'...
- severity text      -- 'info'/'warning'/'error' (mapeia a interrupt/digest)
- title text
- detail text
- context jsonb (nullable)
- resolved boolean default false
- resolved_at_utc timestamptz (nullable)
```

**Severidades → visibilidade (proposta, a confirmar):**
- `error` (invalid_grant, falha total) → notificação visível imediata (interrupt)
- `warning` (HRV não veio hoje, 1 dia de HR perdido) → aparece, discreta
- `info` (backfill completou) → log, talvez nem mostrar

**Grants:** frontend (`authenticated`) lê + faz update de `resolved`;
cron (`service_role`) escreve.

**DECISÃO EM ABERTO (é onde a conversa parou):**
Sistema de notificações COMPLETO agora, ou versão MÍNIMA primeiro?
- Mínima: função já devolve estados de erro no response; automação corre; UI depois.
  No mínimo, tem de saber quando o token expira.
- Completa: tabela + a função escreve nela + UI lê. Mais trabalho, mas serve o
  sistema de alertas todo.

---

## SEQUÊNCIA DE IMPLEMENTAÇÃO (3 chats, papéis distintos)

1. **Chat de design (este/novo)** — fechar a decisão mínima-vs-completa das
   notificações, e o schema da tabela.
2. **Claude Code** — (a) função escreve na tabela de notificações quando falha;
   (b) lógica de retomada do HR (puxar desde último ponto gravado); (c) lógica de
   retry-com-teto.
3. **Chat do Supabase** — (a) criar tabela `notifications` (+ grants); (b) montar
   o `pg_cron` com a cadência acima. O chat do Supabase é o DONO do schema; o Claude
   Code assume que as tabelas existem, nunca as cria.

---

## CONVENÇÕES DO PROJETO (relembrar ao chat novo)
- Schemas por natureza do dado, não por OS. Um só utilizador, sem user_id.
  RLS ativa (`auth.uid() is not null`). Timestamps UTC + offset.
- Cru é a verdade; derivados em `metrics.ts`, nunca guardados como verdade.
- Nada destrutivo (arquivar/supersede). authenticated = SELECT/INSERT/UPDATE sem DELETE.
- Aplicar migrações via `npx supabase db push`, NÃO pelo SQL Editor (senão ficheiro
  e base dessincronizam).
- ⚠️ Bug pendente (não urgente): `daily_metrics` e `sleep` concedem DELETE a
  `authenticated` por engano — `REVOKE DELETE` quando calhar.

## DEPOIS DA AUTOMAÇÃO
Deixar acumular baseline e ir para o `metrics.ts` (fórmulas da readiness) — ver o
handoff da Fatia 1. As fórmulas não têm pressa (baseline acumula sozinha); a automação
é que é urgente (HR forward-only perde-se se não correr).
