-- ═══════════════════════════════════════════════════════════════════════════════
-- Purpose: G7 — database-level guards on checklist publication, so the invariants the
--   service enforces cannot be bypassed by a bad command, a replay, or a manual write.
--
--   1. AT MOST ONE PUBLISHED VERSION PER KEY. "Create an instance of the exporter
--      readiness checklist" has to resolve to exactly one structure. Publishing
--      version N deprecates version N-1 in the same transaction; this partial unique
--      index is what makes a bug in that sequencing fail loudly instead of leaving two
--      live versions and a coin flip over which one a new case gets.
--
--   2. A PUBLISHED ROW MUST CARRY published_at. The publication timestamp is what an
--      auditor uses to establish which structure was in force on a given date; a
--      published template without one is unauditable.
--
--   3. A COMPLETED INSTANCE MUST CARRY completed_at, and an in-flight one must not.
--      Same reasoning: the completion date is the fact being recorded.
--
--   Both CHECKs are added NOT VALID: they bind every future write immediately without
--   a full-table scan taking an ACCESS EXCLUSIVE lock. Existing rows (there are none
--   on any environment at the time of writing — 0083/0084 introduced both tables in
--   the same release) can be validated separately with
--     ALTER TABLE crm.checklist_templates VALIDATE CONSTRAINT chk_checklist_templates_published_at;
--   which takes only a SHARE UPDATE EXCLUSIVE lock.
--
-- Rollback:
--   ALTER TABLE crm.checklist_templates DROP CONSTRAINT IF EXISTS chk_checklist_templates_published_at;
--   ALTER TABLE crm.checklist_instances DROP CONSTRAINT IF EXISTS chk_checklist_instances_completed_at;
--   DROP INDEX IF EXISTS crm.uq_checklist_templates_one_published;
--   DROP INDEX IF EXISTS crm.idx_checklist_instances_open_by_template;
--
-- Affected services: crm-service (modules/checklists)
-- Sequencing: additive and idempotent. Constraints are NOT VALID so no existing row is
--   rejected and no long lock is taken.
-- ═══════════════════════════════════════════════════════════════════════════════

SET lock_timeout = '5s';

-- (1) At most one published version per (tenant, template_key).
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_checklist_templates_one_published
  ON crm.checklist_templates (tenant_id, template_key)
  WHERE status = 'published';

-- Reporting path: "which open checklists came from this template version".
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_checklist_instances_open_by_template
  ON crm.checklist_instances (tenant_id, template_id)
  WHERE status = 'in_progress';

-- (2) A published template must record when it was published.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_checklist_templates_published_at'
      AND conrelid = 'crm.checklist_templates'::regclass
  ) THEN
    ALTER TABLE crm.checklist_templates
      ADD CONSTRAINT chk_checklist_templates_published_at
      CHECK (status <> 'published' OR published_at IS NOT NULL) NOT VALID;
  END IF;
END $$;

-- (3) completed_at is set exactly when the instance is completed.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_checklist_instances_completed_at'
      AND conrelid = 'crm.checklist_instances'::regclass
  ) THEN
    ALTER TABLE crm.checklist_instances
      ADD CONSTRAINT chk_checklist_instances_completed_at
      CHECK (
        (status = 'completed' AND completed_at IS NOT NULL)
        OR (status <> 'completed' AND completed_at IS NULL)
      ) NOT VALID;
  END IF;
END $$;
