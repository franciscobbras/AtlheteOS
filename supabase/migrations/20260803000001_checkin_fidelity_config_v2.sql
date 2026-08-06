-- ============================================================
-- NEXUS — checkin_fidelity v2
--
-- Ajuste da curva de fidelidade do check-in: meia-vida 4h → 3h, para
-- penalizar mais depressa um preenchimento da tarde (já reflete o estado
-- do dia, não a memória de acordar). Carência (1h) e piso (0.3) mantêm-se.
--
-- Versionado como todo o resto de metrics.config: fecha-se o v1
-- (valid_to = data de corte, EXCLUSIVO) e insere-se o v2 ativo
-- (valid_to null). O conjunto inteiro é versionado junto, para "a config
-- ativa" ser sempre um set coerente de parâmetros.
--
--   novo:  ≤1h=100% · 2h=87% · 3h=76% · 5h=57% · 9h=36% · 24h→piso 30%
-- ============================================================

update metrics.config
   set valid_to = '2026-08-03'
 where metric_type = 'checkin_fidelity'
   and version = 'v1'
   and valid_to is null;

insert into metrics.config (metric_type, param_key, param_value, version, valid_from, notes) values
  ('checkin_fidelity', 'grace_hours',     1.0, 'v2', '2026-08-03', 'carência: inalterada vs v1'),
  ('checkin_fidelity', 'half_life_hours', 3.0, 'v2', '2026-08-03', 'meia-vida 4h→3h: penaliza mais depressa o estado da tarde'),
  ('checkin_fidelity', 'floor',           0.3, 'v2', '2026-08-03', 'piso: inalterado vs v1');
