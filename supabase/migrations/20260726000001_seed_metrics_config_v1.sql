-- ─────────────────────────────────────────────────────────────────────────────
-- NEXUS — seed inicial de metrics.config, version 'v1'.
--
-- Valores FUNDAMENTADOS na hierarquia/direção da literatura, NÃO "os pesos certos"
-- (não existem — nem a Oura os publica). São o ponto de partida, calibrável por
-- supersede (fechar valid_to, abrir nova linha) sem tocar no código.
--
-- Os pesos de inputs ainda indisponíveis na v1 (training_load, timing) ficam aqui
-- na mesma: a re-normalização em metrics.ts exclui inputs SEM DADOS em runtime e
-- reescala os restantes para somar 1. Quando o dado chegar, não é preciso mexer na config.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── readiness (z-scores, duplo horizonte) ─────────────────────────────────────
insert into metrics.config (metric_type, param_key, param_value, version, notes) values
  ('readiness', 'weight_hrv',              0.30, 'v1', 'LnRMSSD; z+ = bom'),
  ('readiness', 'weight_sleep_score',      0.25, 'v1', 'sleep score composto como input'),
  ('readiness', 'weight_rhr',              0.20, 'v1', 'INVERTIDO: subir = mau'),
  ('readiness', 'weight_training_load',    0.15, 'v1', 'indisponível na v1 → re-normalizar sem ele'),
  ('readiness', 'weight_temp',             0.10, 'v1', 'INVERTIDO: desvio em qualquer direção = mau'),
  ('readiness', 'scale',                  12.00, 'v1', '1 SD ≈ 10-15 pontos'),
  ('readiness', 'baseline_short_ema_days', 14.0, 'v1', 'EMA curto, enviesado p/ dias recentes'),
  ('readiness', 'baseline_long_days',      90.0, 'v1', 'média/sd longo (~3 meses)'),
  ('readiness', 'override_illness_z',       2.0, 'v1', 'veto doença: RHR_z>2 E temp_z>2'),
  ('readiness', 'override_illness_cap',    40.0, 'v1', 'readiness = min(readiness, 40) no veto');

-- ── sleep_score (curvas 0-100, alvos absolutos) ───────────────────────────────
insert into metrics.config (metric_type, param_key, param_value, version, notes) values
  ('sleep_score', 'weight_duration',          0.30, 'v1', 'saturante 7.5-9h → tecto'),
  ('sleep_score', 'weight_deep',              0.25, 'v1', 'vs. baseline ajustada pela carga de ontem'),
  ('sleep_score', 'weight_efficiency',        0.20, 'v1', 'linear c/ tecto (85%+)'),
  ('sleep_score', 'weight_rem',               0.10, 'v1', 'vs. baseline; override se carga alta'),
  ('sleep_score', 'weight_latency',           0.08, 'v1', 'curva em U (ótimo 10-20min)'),
  ('sleep_score', 'weight_timing',            0.07, 'v1', 'v2 (precisa histórico) → re-normalizar sem ele'),
  ('sleep_score', 'duration_target_hours',    7.50, 'v1', 'alvo absoluto de duração'),
  ('sleep_score', 'efficiency_target_pct',   85.00, 'v1', 'tecto de eficiência'),
  ('sleep_score', 'latency_optimal_min_low', 10.00, 'v1', 'fundo da curva em U'),
  ('sleep_score', 'latency_optimal_min_high',20.00, 'v1', 'topo da curva em U');
