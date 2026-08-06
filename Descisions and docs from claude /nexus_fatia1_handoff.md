# NEXUS — Documento de Handoff — Fatia Vertical 1 (Readiness Matinal)

> Este documento é **autossuficiente**. Foi compilado a partir de uma longa sessão de
> design. O chat de implementação não precisa de mais contexto — tudo o que a primeira
> fatia precisa está aqui: objetivo, convenções, schema, fórmulas, e princípios.
> Este é um chat de IMPLEMENTAÇÃO. O desenho já está fechado — não reabrir decisões,
> executar.

---

## 0. O QUE É O NEXUS (contexto mínimo)

Sistema pessoal de gestão de vida, um só utilizador (o próprio dev). Três "OS"
(AthleteOS, StudentOS, LifeOS) + um orquestrador. Inspirado no Whoop mas com
posse total dos dados, maior personalização, e uma camada de AI que interpreta.

Stack: **Next.js + TypeScript + Supabase (Postgres) + Vercel**.
Sensores: **Polar H10** (ECG, treino, raw via BLE + servidor Python) e
**Fitbit Air** (24/7, via Google Health API — acesso já validado empiricamente).

Frontend alvo: **PWA** (não app nativa).

### Regra de ouro da arquitetura
**Determinístico vs. probabilístico.** Todo o cálculo de métricas é código
determinístico em `src/lib/metrics.ts`. O LLM NUNCA calcula métricas — só interpreta
outputs já calculados. Se uma coisa tem resposta certa e reproduzível, é código.

---

## 1. OBJETIVO DA FATIA 1

Construir a **readiness matinal** — a coisa mais fina que atravessa
sensor → cálculo → ecrã e já é útil no dia 1.

Produz na verdade **3 métricas + 1 derivada**:
- **Sleep score** (objetivo, mede a noite)
- **Readiness** (objetiva, mede estado de recuperação; usa o sleep score como input)
- **Feeling / sleep_perceived** (subjetivo, input direto — não se calcula)
- **Divergência** (derivada: desacordo objetivo↔subjetivo)

### Apresentação (divulgação progressiva)
- **Topo:** readiness objetiva (nº único) + indicador DISCRETO de divergência (só quando
  há divergência assinalável; nos dias normais o topo é limpo).
- **Expandir:** readiness objetiva + feeling + divergência + inputs crus
  (HRV, RHR, sleep score) com os seus drivers.

### O que fica FORA da fatia 1 (v2, tudo aditivo — não bloqueia nada)
- **Training load como input da readiness** (é a PRÓXIMA métrica a construir; a readiness
  v1 corre sem ela, re-normalizando os pesos).
- **timing / regularidade** no sleep score (precisam de semanas de histórico).
- **Carga mecânica** (será a primeira "Experiment" do Nexus, via IMU dedicado — não entra
  aqui).

### Conselho de sequência de construção
Fazer a **ingestão primeiro** e deixá-la correr ~1 semana ANTES de escrever as fórmulas.
As fórmulas precisam de baseline; a baseline precisa de dados acumulados. Testar as
fórmulas no dia 1 sem histórico dá confidence baixa e scores instáveis — é esperado,
não é bug.

---

## 2. CONVENÇÕES GLOBAIS (aplicam-se a TODAS as tabelas)

- **Um só utilizador.** SEM coluna `user_id`. RLS ATIVA em todas as tabelas, com policy
  simples: acesso apenas a utilizadores autenticados (`auth.uid() is not null`).
- **Timestamps sempre em UTC** (`timestamptz`), com `utc_offset_seconds` (integer) guardado
  ao lado sempre que a hora local possa importar (viagem/competições). UTC é a fonte de
  verdade; converter só na apresentação. NUNCA guardar "hora local" como verdade.
- **Coluna `source`** (text) onde coexistem várias fontes (ex.: 'fitbit_air', 'polar_h10').
- **Raw JSON preservado** em sono e agregados diários (poucas linhas, JSON rico). NÃO em
  séries intraday de alta frequência (custo de storage sem valor de recuperação).
- **Cru é a verdade.** Derivados calculam-se em `metrics.ts`, nunca se guardam como se
  fossem verdade original. Um derivado é sempre recalculável a partir do cru.
- **Nunca destrutivo.** Arquivar / supersede (fechar validade e abrir nova linha), nunca
  apagar ou sobrescrever.
- **Schemas Postgres separados por natureza do dado** (não por OS). Os OS são LEITORES,
  não donos de tabelas.
- **Parâmetros/pesos de métricas vivem em CONFIG (tabela), nunca hardcoded nas fórmulas.**
  Isto é inegociável: permite calibração e futura personalização sem tocar no código.

---

## 3. SCHEMA — TABELAS QUE A FATIA 1 TOCA

Criar tudo numa migração inicial limpa. (O schema global do Nexus é maior; aqui estão
SÓ as tabelas que esta fatia precisa.)

### 3.1 Schema `wearable` (input — Fitbit Air via Google Health API)

```sql
-- Agregados diários (um valor por dia por métrica). Fonte da readiness: HRV, RHR, temp.
create table wearable.daily_metrics (
  id                  uuid primary key default gen_random_uuid(),
  date                date not null,
  metric_type         text not null,   -- 'daily_hrv_rmssd','resting_hr','temp_deviation',
                                        -- 'daily_spo2_avg','vo2_max','weight','body_fat'...
  value               numeric not null,
  unit                text,
  source              text not null,   -- 'fitbit_air'
  raw                 jsonb,
  computed_at_utc     timestamptz default now()
);
-- unicidade lógica: (date, metric_type, source)

-- Sono: períodos com fases. Fonte do sleep score.
create table wearable.sleep (
  id                  uuid primary key default gen_random_uuid(),
  start_utc           timestamptz not null,
  end_utc             timestamptz not null,
  utc_offset_seconds  integer not null,
  source              text not null,   -- 'fitbit_air'
  stages              jsonb,           -- array de fases: [{stage,start,end}]
  summary             jsonb,           -- minutos por fase, eficiência, latência,
                                        -- respiratory rate summary, etc.
  raw                 jsonb
);
```

> NOTA sobre HRV: guardar sempre o **RMSSD cru** em daily_metrics. A fórmula opera sobre
> **LnRMSSD** (log natural) — o log é aplicado no cálculo, não na ingestão.

> NOTA sobre a API: Google Health API. Scope validado:
> `https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly`
> (sono tem scope próprio `googlehealth.sleep.readonly`). HR intraday vem paginado
> (`nextPageToken`). Dados têm ~15 min de latência (batch, não tempo real). Temperatura:
> só desvio noturno derivado ('temp_deviation'), NÃO contínua.

### 3.2 Schema `subjective` (input — o que o utilizador regista de manhã)

```sql
create table subjective.morning_checkin (
  id                  uuid primary key default gen_random_uuid(),
  date                date not null unique,
  logged_at_utc       timestamptz not null default now(),
  utc_offset_seconds  integer not null,
  recovery_feeling    integer,   -- 0-10 (o "feeling" da readiness)
  sleep_perceived     integer,   -- 0-10 (o subjetivo do sleep score)
  mood_energy         integer,   -- 0-10
  notes               text
);
```

### 3.3 Schema `metrics` (output — resultados calculados)

```sql
create table metrics.daily_scores (
  id                  uuid primary key default gen_random_uuid(),
  date                date not null,
  metric_type         text not null,   -- 'readiness','sleep_score','training_load',
                                        -- 'divergence_readiness','divergence_sleep'
  score               numeric not null,
  drivers             jsonb,           -- [{factor, impact, detail}]
  vs_baseline         text,            -- 'acima' | 'normal' | 'abaixo'
  confidence          numeric,         -- 0-1
  context             jsonb,           -- {load_yesterday:"alta"}, overrides, flags
  computed_at_utc     timestamptz default now(),
  config_version      text not null    -- que versão dos pesos gerou este score
);
-- unicidade: 1 score por (metric_type, date). Recálculo = UPSERT simples (mais recente ganha).
```

> `config_version` é OBRIGATÓRIO. Quando os pesos forem calibrados no futuro, os scores
> antigos foram gerados com pesos diferentes. Sem esta coluna, o histórico é incomparável.

### 3.4 Config — pesos e parâmetros (tabela, NÃO hardcoded)

```sql
create table metrics.config (
  id                  uuid primary key default gen_random_uuid(),
  metric_type         text not null,   -- 'readiness' | 'sleep_score'
  param_key           text not null,   -- ex.: 'weight_hrv','scale','override_illness_z'
  param_value         numeric not null,
  version             text not null,
  valid_from          date not null default current_date,
  valid_to            date,            -- null = ativo (supersede)
  notes               text
);
```

---

## 4. FÓRMULAS (vivem em `src/lib/metrics.ts`)

Base de todas: **fundamentadas em literatura**. Os pesos exatos NÃO existem na literatura
(nem a Oura os publica/validou) — são palpites fundamentados na HIERARQUIA e DIREÇÃO que a
ciência dá, calibráveis via config. Não procurar "o peso certo" — não existe.

### 4.1 READINESS (objetiva) — z-scores, duplo horizonte

**Inputs e pesos (config):**
| Input           | Peso  | Notas |
|-----------------|-------|-------|
| HRV (LnRMSSD)   | 0.30  | z+ = bom |
| Sleep score     | 0.25  | (o sleep score composto, ver 4.2) |
| RHR             | 0.20  | INVERTIDO (subir = mau) |
| Training load   | 0.15  | NÃO existe na v1 → re-normalizar sem ele |
| Temperatura     | 0.10  | INVERTIDO (desvio em qualquer direção = mau) |

**Baseline duplo horizonte (Oura-style), por input:**
- `curto` = EMA 14 dias (enviesado para dias recentes)
- `longo` = média 3 meses
- `sd_longo` = desvio-padrão dos 3 meses

**Passos:**
```
1. Para cada input: z_i = (curto_i − longo_i) / sd_longo_i
   (ajustar sinal: HRV z+ bom; RHR e temp invertidos)
2. Sleep score entra como z contra a sua própria baseline.
3. readiness = 100 + Σ (peso_i × z_i × escala)     [pesos RE-NORMALIZADOS p/ disponíveis]
   → cortar a [0, 100]
   `escala`: 1 SD ≈ 10-15 pontos (calibrar, em config)
4. OVERRIDE (veto, não voto):
   se (RHR_z > 2 E temp_z > 2):        # sinal de doença
       readiness = min(readiness, 40)
       context.flag = "possível doença"
   (cortes z>2 calibráveis, em config)
```

**Re-normalização:** cada peso ÷ soma dos pesos disponíveis nesse dia. Trivial porque os
pesos vêm de config. Sem training load, os restantes 4 re-escalam para somar 1.

**Degradação graciosa:** primeiros 3 meses sem horizonte longo → usar só curto; confidence
baixa ("baseline longa a formar-se").

**Cada driver = o termo (peso_i × z_i × escala)** — sai da própria fórmula, sem cálculo extra.

### 4.2 SLEEP SCORE (objetivo) — curvas 0-100, alvos absolutos

**Diferença vs. readiness:** aqui NÃO se usa z-score. O sono tem ALVOS ABSOLUTOS conhecidos
da literatura (7.5h, 85% eficiência, 10-20min latência). Cada componente → pontuação 0-100
por uma curva própria. Diferença INTENCIONAL — não uniformizar com a readiness.
(Readiness pergunta "estás pior que o TEU normal?"; sleep score pergunta "dormiste BEM?".)

**Componentes e pesos (config), por ordem de evidência:**
| Componente                    | Peso | Curva / regra |
|-------------------------------|------|---------------|
| Duração vs. necessidade       | 30%  | saturante (7.5-9h → tecto) |
| Deep / SWS                    | 25%  | vs. baseline AJUSTADA pela carga de ontem |
| Eficiência (inclui restfulness)| 20% | linear com tecto (85%+) |
| REM                           | 10%  | vs. baseline; OVERRIDE: não penalizar se carga alta |
| Latência                      | 8%   | curva em U (ótimo 10-20min; <5min=privação=mau; >30min=mau) |
| Timing / regularidade         | 7%   | v2 (precisa de histórico) — re-normaliza sem ele na v1 |

```
sleep_score = Σ (peso_i × componente_i)     [pesos re-normalizados p/ disponíveis]
```

**Training load modula o DEEP (fisiologia):** treino pesado → corpo deve produzir + SWS.
- deep alto após treino pesado = recuperação OK
- deep BAIXO após treino pesado = recuperação comprometida (pior que deep baixo em dia leve)
→ o load ajusta a BASELINE ESPERADA do deep, não entra como peso separado.
(Na v1, sem training load, o deep é avaliado contra a baseline pessoal simples.)

**Não-linearidade só onde a fisiologia manda:** latência (U), REM (override de carga),
deep (baseline móvel por carga). Resto é linear-com-tecto.

### 4.3 DIVERGÊNCIA objetivo↔subjetivo (derivada)

Aplica-se a readiness↔feeling E a sleep_score↔sleep_perceived. NÃO comparar valores
absolutos (escalas 0-10 vs 0-100 incomparáveis; e o 0-10 é grosseiro de propósito —
ninguém distingue um 80 de um 85 subjetivamente).

```
z_subjetivo = (feeling_hoje − feeling_baseline) / sd_subjetivo
z_objetivo  = (score_hoje   − score_baseline)   / sd_objetivo
divergência = z_subjetivo − z_objetivo
```
Compara DESVIOS (cada um vs. o seu próprio normal), não valores.
Ex.: feeling 5 (normal 7 → −1.5 SD) vs readiness 78 (normal 80 → −0.3 SD)
→ sentes-te muito pior que o normal mas o corpo está quase normal = sinal.

**Regras:**
- Limiar CONFIGURÁVEL (gap de z a partir do qual "conta"). Sensibilidade a calibrar.
- Acima do limiar: (a) baixa a confidence da métrica objetiva, (b) indicador no dashboard,
  (c) REGISTA o episódio em metrics.daily_scores (para correlações cross-domain futuras).
- Precisa de baseline do subjetivo (feeling habitual) → não funciona nos primeiros dias;
  confidence reflete isso.

---

## 5. CONTRATO DE OUTPUT (todas as métricas devolvem isto)

```ts
{
  score: number,
  drivers: Array<{ factor: string, impact: number, detail: string }>,
  vs_baseline: 'acima' | 'normal' | 'abaixo',
  confidence: number,   // 0-1
  context?: object      // {load_yesterday}, overrides, flags
}
```
Escrito em `metrics.daily_scores` com `config_version`.

**confidence DESCE quando:** baseline longa < 3 meses; faltam dias de dados;
divergência objetivo/subjetivo alta.

---

## 6. PIPELINE DA FATIA (ordem de construção)

1. **Ingestão Air → wearable.***: OAuth Google Health (modo testing, conta própria como
   test user), puxar daily_metrics (HRV/RHR/temp) e sleep. Paginação para intraday.
   Upsert por (date, metric_type, source). **Deixar correr ~1 semana antes de 4.**
2. **subjective.morning_checkin**: ecrã de input matinal (3 escalas 0-10 + mapa de dor
   opcional — a dor vive em subjective.pain_reports, fora do âmbito estrito da fatia mas
   o checkin é o gatilho).
3. **metrics.ts**: implementar getSleepScore(), getReadiness(), getDivergence().
   Ler pesos de metrics.config. Determinístico. Cada função devolve o contrato da secção 5.
4. **metrics.daily_scores**: escrever os outputs (upsert por metric_type+date, com
   config_version).
5. **Ecrã**: readiness objetiva (nº) + indicador de divergência; expandir = detalhe completo.

---

## 7. PRINCÍPIOS QUE A IMPLEMENTAÇÃO NÃO PODE VIOLAR

- Pesos e parâmetros SEMPRE de `metrics.config`, nunca hardcoded.
- Cálculo 100% determinístico em `metrics.ts`. LLM nunca entra no cálculo.
- Cada driver deriva da própria fórmula (o termo peso×z), não é inventado à parte.
- Timestamps UTC + offset; converter só na UI.
- Nada destrutivo; recálculo é upsert com novo config_version.
- HRV: guardar RMSSD cru, calcular sobre LnRMSSD.
- Readiness = z-score (desvio pessoal). Sleep score = curvas 0-100 (alvo absoluto).
  NÃO uniformizar — a diferença é fundamentada.
- Degradação graciosa + confidence honesta quando faltam dados/baseline.

---

## 8. PRÓXIMA MÉTRICA (depois desta fatia): TRAINING LOAD
sRPE (primária, = RPE_CR10 × duração_bloco, somado) + TRIMP (do H10, complementar).
Carga aguda(7d)/crónica(28d) via EWMA, crónica desacoplada. Trajetória descritiva,
NUNCA ACWR-semáforo (desacreditado na literatura). Desbloqueia o input de 15% da
readiness e o ajuste de deep do sleep score.
