-- ============================================================
-- NEXUS — Renomear metric_type checkin_fidelity → checkin_reliability
--
-- Mudança de terminologia: "fidelidade" → "fiabilidade" na UI. Para a
-- config não ficar dessincronizada da UI, renomeia-se a chave em
-- metrics.config (todas as versões — v1 fechada e v2 ativa). Só muda o
-- nome; valores, versões e valid_from/valid_to mantêm-se. O cliente passa
-- a ler 'checkin_reliability'.
-- ============================================================

update metrics.config
   set metric_type = 'checkin_reliability'
 where metric_type = 'checkin_fidelity';
