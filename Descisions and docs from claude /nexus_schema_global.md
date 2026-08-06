# NEXUS — MAPA GLOBAL DO SCHEMA (consolidado)

> **Como usar este documento:** é o mapa COMPLETO do schema do Nexus, com todas as
> correções de design já aplicadas. Serve de **referência de fundo** para manter coerência.
>
> ⚠️ **NÃO criar tudo de uma vez.** Construir por FATIAS VERTICAIS. Criar apenas as tabelas
> da fatia em que se está a trabalhar. Este mapa existe para que, ao adicionar uma fatia
> nova, o schema global permaneça coerente — não para justificar criar 30 tabelas à cabeça.
>
> A **Fatia 1 (readiness matinal)** usa: `wearable.daily_metrics`, `wearable.sleep`,
> `subjective.morning_checkin`, `metrics.daily_scores`, `metrics.config`. Ver o documento
> de handoff da Fatia 1 para o SQL detalhado dessas.

---

## PRINCÍPIOS DE ORGANIZAÇÃO

1. **Schemas por NATUREZA E ORIGEM do dado, não por OS.** Os OS (Athlete/Student/Life) são
   LEITORES, não donos de tabelas. Uma tabela de sono não é "do AthleteOS" — é dados de sono
   que o Athlete usa para readiness e o Life usa para sleep score.
2. **Critério de arrumação:** o dado tem existência própria (→ schema próprio) ou é atributo
   de outra entidade (→ coluna na tabela dessa entidade)? Ex.: RPE de um bloco é atributo do
   bloco; a dor tem existência própria (pode ocorrer sem treino).
3. **`subjective`** = juízo/perceção pessoal (estado interno). **`habits`** = comportamento
   observável (factos objetivos). Não confundir.

## CONVENÇÕES GLOBAIS (todas as tabelas)

- **Um só utilizador.** SEM `user_id`. RLS ativa; policy: `auth.uid() is not null`.
- **Timestamps UTC** (`timestamptz`) + `utc_offset_seconds` (integer) quando a hora local
  importa. UTC é a verdade; converter só na apresentação.
- **`source`** (text) onde coexistem fontes.
- **Raw JSON** preservado em sono, agregados diários, exercise_detected. NÃO em intraday.
- **Cru é a verdade;** derivados em `metrics.ts`, recalculáveis, nunca guardados como verdade.
- **Nunca destrutivo:** arquivar / supersede (valid_from/valid_to), nunca apagar/sobrescrever.
- **Pesos/parâmetros de métricas em CONFIG (tabela), nunca hardcoded.**

---

## SCHEMAS E TABELAS

### `wearable` — dados passivos da Fitbit Air (Google Health API)

Séries fisiológicas intraday (tabela por métrica; unidades específicas):
- **`wearable.heart_rate`** — timestamp_utc, utc_offset_seconds, bpm, source, recording_method
- **`wearable.spo2`** — idem, percentage
- **`wearable.hrv_instant`** — idem, rmssd_ms

Séries de atividade intraday (tabela partilhada; muitas variantes da mesma forma):
- **`wearable.activity_intraday`** — timestamp_utc, utc_offset_seconds, metric_type
  ('steps','distance','floors','altitude','active_zone_minutes','activity_level',
  'sedentary_period'...), value, unit, source

Agregados diários (um valor/dia/métrica):
- **`wearable.daily_metrics`** — date, metric_type ('daily_hrv_rmssd','resting_hr',
  'temp_deviation','daily_spo2_avg','vo2_max','weight','body_fat'...), value, unit, source, raw

Sono:
- **`wearable.sleep`** — start_utc, end_utc, utc_offset_seconds, source, stages (jsonb),
  summary (jsonb), raw

Placeholder (desenhar agora, ingerir depois):
- **`wearable.exercise_detected`** — start_utc, end_utc, utc_offset_seconds, exercise_type,
  display_name, metrics_summary (jsonb), raw

> HRV: guardar RMSSD cru; fórmulas usam LnRMSSD. Temperatura: só desvio noturno derivado.

### `training` — dados de treino com Polar H10

- **`training.sessions`** — start_utc, end_utc, utc_offset_seconds, overall_feeling (0-10,
  nullable), notes, **session_load** (numeric, nullable — carga sRPE da sessão, calculada ao fechar)
- **`training.training_blocks`** — session_id, apparatus, start_utc, end_utc (nullable),
  status ('active'/'closed'/'unattributed'), rpe (0-10 CR-10, nullable),
  feeling (0-10, nullable), as_planned (boolean, nullable), notes
- **`training.rr_intervals`** — session_id, timestamp_utc, rr_ms [índice (session_id, timestamp_utc)]
- **`training.ecg_samples`** — session_id, timestamp_utc, microvolts
  [índice (session_id, timestamp_utc)] ⚠️ ~1M linhas/sessão — particionar/comprimir mais tarde

> Cruzamento bloco↔sinal por QUERY TIME (JOIN por timestamps), não atribuir block_id ao raw.

### `nutrition` — comida (MacroFactor via Shortcut Share Sheet + edge function, upsert)

- **`nutrition.food_log`** — eaten_at_utc, utc_offset_seconds, food_name, serving_size,
  serving_qty, serving_weight_g, nutrients (jsonb, ~55 nutrientes), raw (jsonb), source
- **`nutrition.targets`** — nutrient_key, target_value, unit, valid_from, valid_to (nullable),
  notes, source ('manual'/'nexus_calculated'). SUPERSEDE. Definidos pelo utilizador, NÃO do
  MacroFactor (que já não é usado para targets/TDEE).

### `body` — medições corporais

- **`body.weight`** — date, weight_kg, trend_weight_kg, source ('macrofactor' agora →
  'nexus_manual' quando MVP)
- **`body.body_composition`** — peso + massa gorda/magra + outras (nutricionista federação,
  cadência de meses)
- **`body.energy_expenditure`** — estimated_kcal, valid_from, valid_to (nullable),
  method ('manual_estimate' na v1), notes. SUPERSEDE. (v2: TDEE adaptativo em metrics.ts)

### `subjective` — juízo/perceção pessoal (estado interno)

- **`subjective.morning_checkin`** — date (unique), logged_at_utc, utc_offset_seconds,
  recovery_feeling (0-10), sleep_perceived (0-10), mood_energy (0-10), notes
- **`subjective.pain_reports`** — session_id (nullable — dor pode ser independente de treino),
  reported_at_utc, utc_offset_seconds, body_region, side, intensity (0-10), onset, description
  [uma linha por zona de dor]
- **`subjective.journal`** — date (unique), content (cru, intocável), title (LLM),
  summary (LLM), topics (jsonb, LLM), created_at_utc, utc_offset_seconds
  [title/summary/topics gerados no upload, numa só chamada LLM; content é a fonte de verdade]

### `habits` — comportamento observável acompanhado

- **`habits.definitions`** — name, habit_type ('binary'/'target_quantity'/'target_time'),
  target_unit (nullable), tolerance (nullable), active
- **`habits.targets`** — habit_id, target_value, valid_from, valid_to (nullable). SUPERSEDE.
- **`habits.logs`** — habit_id, date, value (CRU: 2.4 litros / minutos de desvio / 1-0),
  logged_at_utc
  [% de cumprimento calculada em metrics.ts contra o alvo ATIVO nessa data]

### `planning` — organização/planeamento (todos os OS leem)

- **`planning.ideas_inbox`** — content (intocável), captured_at_utc, utc_offset_seconds,
  status ('captured'/'classified'/'routed'/'rejected'/'unsorted'), llm_classification (jsonb),
  processed_at_utc (nullable) [registo PERMANENTE — a ideia nunca sai]
- **`planning.idea_routes`** — idea_id, destination_type ('todo'/'calendar'/'goal'/'journal'/
  'experiment'/'shopping'/'unsorted'), destination_id (nullable — ponteiro), confirmed (bool),
  created_at_utc [1 ideia → N destinos]
- **`planning.todos`** — content, done, due_date (nullable), priority (nullable),
  created_at_utc, completed_at_utc (nullable), origin (nullable)
- **`planning.shopping_list`** — clone trivial de todos (item, comprado, qty)
- **`planning.goals`** — ⚠️ POR DESENHAR. NÃO é lista trivial: raiz do roadmap de objetivos,
  deteção de conflitos, ligação a experiments e ao treino. Precisa de horizonte temporal,
  progresso, plano, sub-objetivos.

### `student` — StudentOS base

- **`student.courses`** — name, code (nullable), semester (nullable), ects (nullable), active
- **`student.study_sessions`** — course_id, date, duration_minutes (aproximado),
  source ('calendar_confirmed'/'manual'), notes (nullable), logged_at_utc
  [tempo estudado é DERIVADO daqui, não guardado agregado; calendário = só planeamento]
- **`student.confidence`** — course_id, confidence (0-10), date, notes (nullable), logged_at_utc
  [SÉRIE TEMPORAL, não valor único; sem tópicos — nível cadeira]

### `metrics` — output de métricas calculadas

- **`metrics.daily_scores`** — date, metric_type ('readiness'/'sleep_score'/'training_load'/
  'divergence_readiness'/'divergence_sleep'), score, drivers (jsonb), vs_baseline, confidence,
  context (jsonb), computed_at_utc, config_version [unicidade (metric_type,date); recálculo=upsert]
- **`metrics.config`** — metric_type, param_key, param_value, version, valid_from,
  valid_to (nullable), notes [pesos/parâmetros; SUPERSEDE]

---

## POR DESENHAR (fatias/camadas futuras — NÃO criar ainda)

- **`planning.goals`** (estrutura rica — ver acima)
- **Calendário** (sistema próprio, mais complexo)
- **Experiments** (schema próprio — investigação pessoal aplicada; hipótese/protocolo/métrica/
  baseline/data de revisão; estado explícito; máx 2-3 ativas; arquivar concluídas incl. falhadas)
- **Medições pontuais de calibração** (análises sanguíneas, MHR, composição — valor + validade;
  alimentam fórmulas → parâmetro desatualizado contamina cálculos, marcar confiança reduzida)
- **Camada de configuração alargada:** factos pessoais (supersede + expiração + revisão por
  antiguidade), tabela de personalização de fórmulas (com barreiras: baseline imutável,
  aprovação do utilizador, versionamento, limites de magnitude ±30%, uma mudança de cada vez,
  modo de comparação, rollback)
- **Métricas calculadas futuras:** training_load completo, risco de lesão, EA/RED-S,
  readiness/estimativas do StudentOS, correlações cross-domain, digest semanal

## PRINCÍPIOS DE RESOLUÇÃO (vivem em metrics.ts, NÃO no schema)

- **Hierarquia de fontes de HR:** dentro de training.session → H10 (via rr_intervals);
  fora → Air; sem H10 → Air (fallback). NUNCA somar H10 + Air.
- **exercise_detected** que sobrepõe training.session → descartado/duplicado.
- Função central `resolveHeartRateSource(timeRange)`.
