-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration: 0009_findings_schema.sql
-- Service:   inspection-service (gateway /api/v1/inspection) — DB civitas_inspection
--
-- Purpose:
--   Creates the `findings` schema with `findings`, `compliance_notices`, and
--   `finding_sequences` tables for the Findings & Non-Compliance Management
--   module. The findings table records non-compliance observations against
--   provisions with severity classification. Compliance notices track corrective
--   actions with due dates. Finding sequences maintain tenant-scoped yearly
--   counters for generating unique finding numbers (FND-{YYYY}-{SEQ:6}).
--
--   This migration is ADDITIVE and IDEMPOTENT: every object is created with
--   IF NOT EXISTS (schema, table, indexes) or guarded (policy via DROP-then-CREATE),
--   so it can be re-applied safely.
--
-- Row-level security (RLS):
--   All tables have ENABLE + FORCE ROW LEVEL SECURITY. The tenant_isolation
--   policy uses the missing-ok GUC form so an unset app.tenant_id yields NULL
--   → no rows visible (fail-closed).
--
-- Rollback (DESTRUCTIVE — requires tech-lead / DBA written approval per Migration
--           Safety Rules; no automatic down-migration is provided):
--   DROP POLICY IF EXISTS tenant_isolation ON findings.finding_sequences;
--   DROP POLICY IF EXISTS tenant_isolation ON findings.compliance_notices;
--   DROP POLICY IF EXISTS tenant_isolation ON findings.findings;
--   DROP INDEX IF EXISTS findings.idx_findings_tenant_inspection;
--   DROP TABLE IF EXISTS findings.finding_sequences;
--   DROP TABLE IF EXISTS findings.compliance_notices;
--   DROP TABLE IF EXISTS findings.findings;
--   DROP SCHEMA IF EXISTS findings;
--
-- Affected services: inspection-service only (own database, no cross-service tables).
-- Requirements: 9.1, 9.3, 9.4
-- ═══════════════════════════════════════════════════════════════════════════════

-- Guard against long lock waits blocking production queries during any ALTER TABLE.
SET lock_timeout = '5s';

-- ═══════════════════════════════════════════════════════════════════════════════
-- SCHEMA
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE SCHEMA IF NOT EXISTS findings;

-- ═══════════════════════════════════════════════════════════════════════════════
-- TABLE: findings.findings
--   Records non-compliance observations during inspections. Each finding links
--   to an inspection, a specific checklist question (optional), and a violated
--   provision. Severity is classified as critical/major/minor/observation.
--   State tracks lifecycle: open → notice_issued → overdue → closed.
--   Finding numbers are unique per tenant (FND-{YYYY}-{SEQ:6}).
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS findings.findings (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL,
    inspection_id       UUID NOT NULL,
    question_id         UUID,
    provision_id        UUID NOT NULL,
    finding_number      VARCHAR(20) NOT NULL,
    severity            VARCHAR(16) NOT NULL,
    state               VARCHAR(24) NOT NULL DEFAULT 'open',
    description         TEXT NOT NULL,
    evidence_ids        JSONB NOT NULL DEFAULT '[]'::jsonb,
    closed_at           TIMESTAMPTZ,
    closed_by           UUID,
    verification_notes  TEXT,
    deleted_at          TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by          UUID NOT NULL,
    updated_by          UUID NOT NULL,
    version             INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT chk_findings_severity
        CHECK (severity IN ('critical', 'major', 'minor', 'observation')),

    CONSTRAINT chk_findings_state
        CHECK (state IN ('open', 'notice_issued', 'overdue', 'closed')),

    CONSTRAINT uq_findings_tenant_finding_number
        UNIQUE (tenant_id, finding_number)
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- TABLE: findings.compliance_notices
--   Created when a finding requires corrective action. Links back to findings
--   via finding_id. Records the due date, required action, and responsible party.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS findings.compliance_notices (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL,
    finding_id          UUID NOT NULL REFERENCES findings.findings(id),
    due_date            DATE NOT NULL,
    required_action     TEXT NOT NULL,
    responsible_party   TEXT NOT NULL,
    issued_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by          UUID NOT NULL,
    version             INTEGER NOT NULL DEFAULT 1
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- TABLE: findings.finding_sequences
--   Maintains tenant-scoped yearly sequence counters for generating unique
--   finding numbers following the pattern FND-{YYYY}-{SEQ:6}. The last_seq
--   value is atomically incremented when allocating a new finding number.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS findings.finding_sequences (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL,
    year                INTEGER NOT NULL,
    last_seq            INTEGER NOT NULL DEFAULT 0,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    version             INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT uq_finding_sequences_tenant_year
        UNIQUE (tenant_id, year)
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- ROW-LEVEL SECURITY (tenant isolation) — ENABLE + FORCE + policy.
--   FORCE ensures even the table owner is subject to the policy. The policy uses
--   the missing-ok GUC form so an unset app.tenant_id yields NULL → no rows
--   (fail-closed). Policy is dropped-then-created for idempotent re-runs.
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE findings.findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE findings.findings FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON findings.findings;
CREATE POLICY tenant_isolation ON findings.findings
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE findings.compliance_notices ENABLE ROW LEVEL SECURITY;
ALTER TABLE findings.compliance_notices FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON findings.compliance_notices;
CREATE POLICY tenant_isolation ON findings.compliance_notices
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE findings.finding_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE findings.finding_sequences FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON findings.finding_sequences;
CREATE POLICY tenant_isolation ON findings.finding_sequences
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- ═══════════════════════════════════════════════════════════════════════════════
-- INDEXES
--   Plain CREATE INDEX (not CONCURRENTLY): these tables are brand-new and empty
--   at migration time, so index builds are instant and non-blocking.
--   All IF NOT EXISTS for idempotent re-runs.
-- ═══════════════════════════════════════════════════════════════════════════════

-- Look up findings by tenant + inspection (list findings for an inspection)
CREATE INDEX IF NOT EXISTS idx_findings_tenant_inspection
    ON findings.findings(tenant_id, inspection_id);
