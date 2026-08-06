-- ═══════════════════════════════════════════════════════════════════════════════
-- Purpose: G7 — crm.checklist_instances. A checklist bound to a subject
--   (an onboarding case, a deal, a contact or an account), holding its own DEEP COPY
--   of the published template structure plus the answers recorded against it.
--
--   `structure` is FROZEN at instantiation and is deliberately a copy, not a
--   reference. A template version published next month must not retroactively change
--   what an in-flight case was asked — that is the difference between an audit trail
--   and a rewrite of history. `template_id` / `template_version_number` record
--   provenance only; nothing reads the template row to answer a question about an
--   instance.
--
--   `responses` shape (see @civitasone/checklist):
--     Record<questionId, { value: unknown, answeredAt: ISO-8601 string }>
--   Partial by design: a checklist is filled in over many saves.
--
--   `score` is the weighted overall score (0–100) recomputed on every submission by
--   the pure engine, stored so list/report queries need not re-derive it.
--
--   PII NOTE: answer VALUES can be personal data (a medical declaration, an
--   identifier). They live only in this column, never in an event payload — the
--   checklist events carry ids and counts only.
--
-- Rollback: DROP TABLE IF EXISTS crm.checklist_instances;
--   Additive, new table only; no data migration to undo. Drop before
--   crm.checklist_templates (0083) if rolling both back.
--
-- Affected services: crm-service (modules/checklists)
-- Sequencing: additive and idempotent. No ALTER on an existing table, no DROP.
-- ═══════════════════════════════════════════════════════════════════════════════

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS crm.checklist_instances (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               uuid NOT NULL,
  subject_type            varchar(24) NOT NULL
                            CHECK (subject_type IN ('onboarding_case', 'deal', 'contact', 'account')),
  subject_id              uuid NOT NULL,
  template_id             uuid NOT NULL,
  template_key            varchar(64) NOT NULL,
  template_version_number integer NOT NULL CHECK (template_version_number >= 1),
  structure               jsonb NOT NULL,
  responses               jsonb NOT NULL DEFAULT '{}'::jsonb,
  status                  varchar(16) NOT NULL DEFAULT 'in_progress'
                            CHECK (status IN ('in_progress', 'completed', 'cancelled')),
  score                   integer NOT NULL DEFAULT 0 CHECK (score BETWEEN 0 AND 100),
  completed_at            timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  created_by              uuid NOT NULL,
  updated_by              uuid NOT NULL,
  version                 integer NOT NULL DEFAULT 1
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_checklist_instances_subject
  ON crm.checklist_instances (tenant_id, subject_type, subject_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_checklist_instances_template
  ON crm.checklist_instances (tenant_id, template_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_checklist_instances_status
  ON crm.checklist_instances (tenant_id, status);

-- One live checklist per (subject, template_key). A second one for the same key would
-- make "the exporter readiness checklist for this account" ambiguous; a superseding
-- checklist is raised only after the previous one is completed or cancelled.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_checklist_instances_one_open
  ON crm.checklist_instances (tenant_id, subject_type, subject_id, template_key)
  WHERE status = 'in_progress';

ALTER TABLE crm.checklist_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.checklist_instances FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'checklist_instances_tenant_isolation'
      AND schemaname = 'crm' AND tablename = 'checklist_instances'
  ) THEN
    CREATE POLICY checklist_instances_tenant_isolation ON crm.checklist_instances
      USING (tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
END $$;

DO $g$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_svc') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON crm.checklist_instances TO crm_svc;
  END IF;
END $g$;
