-- ============================================================
-- NEXUS — service_role precisa de UPDATE em ops.notifications
--
-- A ingestão passou a fechar automaticamente um data_missing quando os
-- dados chegam tarde (resolveByDedupe → UPDATE resolved=true). Mas o
-- service_role (com que a Edge Function corre) só tinha SELECT+INSERT,
-- por isso o UPDATE era negado e o auto-resolve falhava em silêncio.
--
-- Continua SEM DELETE (convenção: nada destrutivo; resolver ≠ apagar).
-- ============================================================

grant update on ops.notifications to service_role;
