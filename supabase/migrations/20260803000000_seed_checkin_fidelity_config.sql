-- ============================================================
-- NEXUS — Config da fidelidade do check-in matinal (metrics.config)
--
-- A fidelidade de um check-in decai com o tempo entre acordar
-- (wearable.sleep.end_utc, dado pela Fitbit) e o momento em que foi
-- preenchido (subjective.morning_checkin.logged_at_utc):
--
--   atraso_h   = (logged_at_utc − sleep.end_utc) em horas
--   excesso    = max(0, atraso_h − carencia)
--   fidelidade = piso + (1 − piso) × 2^(−excesso / meia_vida)
--
-- Parâmetros (nunca hardcoded — vivem aqui, versionados, como todos os
-- pesos/limiares do projeto). São a versão inicial; as janelas serão
-- afinadas quando o Nexus conhecer os horários do utilizador.
--   carencia  = 1h   → dentro disto a fidelidade é 1.0
--   meia_vida = 4h   → cada 4h de excesso corta a metade da distância ao piso
--   piso      = 0.3  → nunca zero; memória contaminada ainda tem sinal
-- ============================================================

insert into metrics.config (metric_type, param_key, param_value, version, valid_from, notes) values
  ('checkin_fidelity', 'grace_hours',     1.0, 'v1', '2026-08-03', 'carência: atraso até aqui = fidelidade 1.0'),
  ('checkin_fidelity', 'half_life_hours', 4.0, 'v1', '2026-08-03', 'meia-vida do decaimento exponencial do excesso'),
  ('checkin_fidelity', 'floor',           0.3, 'v1', '2026-08-03', 'piso: fidelidade mínima, nunca zero');
