-- Purpose: GAP-CRM-ESCALATION-RULES-05. Prevent duplicate lead-escalation rules
--          for the same (tenant, trigger, threshold, recipient). Two identical
--          rules would both fire and double-notify / double-reassign a lead.
--          Adds a unique index on crm.escalation_rules keyed on
--          (tenant_id, trigger, threshold_minutes, recipient_role, recipient_id),
--          with COALESCE so NULL recipient_role / recipient_id compare equal
--          (SQL would otherwise treat NULLs as distinct and let duplicates in).
--          The editor also blocks duplicates client-side; this is the server-
--          side guard that returns a 409-mappable unique-violation.
-- Rollback: DROP INDEX IF EXISTS crm.uq_escalation_rules_dedupe;
-- Affected services: crm-service (assignment module)
-- Sequencing: idempotent. Pre-existing duplicates (the very bug this guards
--             against makes them likely) would abort the index build, so they
--             are removed first, keeping the OLDEST row of each duplicate set
--             (created_at, then id as a deterministic tie-break). The newer
--             twins are exact functional duplicates (same trigger, threshold
--             and recipient), so no distinct behaviour is lost. The table is
--             FORCE RLS and the migration role has no app.tenant_id, so the
--             cross-tenant DELETE runs inside a NO FORCE / FORCE wrap.

SET lock_timeout = '5s';

-- Remove pre-existing duplicates (keep the oldest of each set) so the unique
-- index below can be built. FORCE RLS would hide every row from the migration
-- role (no app.tenant_id), so the cross-tenant cleanup runs inside the
-- NO FORCE / FORCE wrap.
ALTER TABLE crm.escalation_rules NO FORCE ROW LEVEL SECURITY;

DELETE FROM crm.escalation_rules r
USING (
  SELECT id,
         row_number() OVER (
           PARTITION BY tenant_id, trigger, threshold_minutes,
                        COALESCE(recipient_role, ''),
                        COALESCE(recipient_id, '00000000-0000-0000-0000-000000000000'::uuid)
           ORDER BY created_at ASC, id ASC
         ) AS rn
  FROM crm.escalation_rules
) d
WHERE r.id = d.id AND d.rn > 1;

ALTER TABLE crm.escalation_rules FORCE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX IF NOT EXISTS uq_escalation_rules_dedupe
  ON crm.escalation_rules (
    tenant_id,
    trigger,
    threshold_minutes,
    COALESCE(recipient_role, ''),
    COALESCE(recipient_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );
