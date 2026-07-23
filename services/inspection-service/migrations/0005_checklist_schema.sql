-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration: 0005_checklist_schema.sql
-- Service:   inspection-service — DB civitas_inspection
--
-- Purpose:
--   Creates the `checklist` PostgreSQL schema with two domain tables:
--   - checklist.checklist_templates: versioned form definitions with sections,
--     questions, scoring rules, and conditional logic. Published templates are
--     immutable; subsequent changes require a new version.
--   - checklist.checklist_instances: filled-in copies of a template bound to a
--     specific inspection execution, storing responses, section scores, and
--     overall compliance percentage.
--
--   This migration is ADDITIVE and IDEMPOTENT: every object is created with
--   IF NOT EXISTS (schemas, tables, indexes) or guarded (policies via
--   DROP-then-CREATE), so it can be re-applied safely.
--
-- Row-level security (RLS):
--   Every tenant-scoped table has BOTH `ENABLE` AND `FORCE` ROW LEVEL SECURITY.
--   The tenant_isolation policy uses the missing-ok GUC form
--   `NULLIF(current_setting('app.tenant_id', true), '')::uuid` so an UNSET GUC
--   yields NULL (rows invisible — fail-closed) instead of raising.
--
-- Rollback (DESTRUCTIVE — requires tech-lead / DBA written approval per Migration
--           Safety Rules; no automatic down-migration is provided):
--   DROP SCHEMA IF EXISTS checklist CASCADE;
--
-- Affected services: inspection-service only (own database, no cross-service tables).
-- Requirements: 5.1, 5.2, 5.3
-- ═══════════════════════════════════════════════════════════════════════════════

-- Guard against long lock waits blocking production queries during any ALTER TABLE.
SET lock_timeout = '5s';

-- ═══════════════════════════════════════════════════════════════════════════════
-- SCHEMA
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE SCHEMA IF NOT EXISTS checklist;

-- ═══════════════════════════════════════════════════════════════════════════════
-- TABLE: checklist.checklist_templates
--   Versioned form definitions containing sections with ordered questions.
--   Status lifecycle: draft → published (immutable once published).
--   Unique per (tenant_id, code, version_number) — allows multiple versions
--   of the same template code within a tenant.
--
--   sections JSON shape:
--     ChecklistSection { id: string; title: string; sortOrder: number; weight: number;
--       prerequisite?: { sectionId: string; minScore: number };
--       questions: ChecklistQuestion[] }
--     ChecklistQuestion { id: string; text: string; fieldType: FieldType;
--       sortOrder: number; weight: number; required: boolean;
--       validationRules?: object; helpText?: string;
--       conditionalLogic?: ConditionalRule[] }
--     FieldType = "text"|"number"|"boolean"|"select"|"multi_select"|"photo"|
--                 "signature"|"geo_point"
--     ConditionalRule { dependsOn: string; operator: "eq"|"neq"|"gt"|"lt";
--       value: any; action: "show"|"hide" }
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS checklist.checklist_templates (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL,
    name            TEXT NOT NULL,
    code            VARCHAR(32) NOT NULL,
    version_number  INTEGER NOT NULL DEFAULT 1,
    status          VARCHAR(16) NOT NULL DEFAULT 'draft',
    sections        JSONB NOT NULL,
    published_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by      UUID NOT NULL,
    updated_by      UUID NOT NULL,
    version         INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT chk_checklist_templates_status
        CHECK (status IN ('draft', 'published')),

    CONSTRAINT uq_checklist_templates_tenant_code_version
        UNIQUE (tenant_id, code, version_number)
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- TABLE: checklist.checklist_instances
--   A filled-in copy of a template bound to a specific inspection execution.
--   sections is a deep-copy from the template at instance creation time.
--   responses stores inspector answers keyed by question ID.
--   section_scores and overall_score are computed after response submission.
--
--   responses JSON shape:
--     { [questionId]: { value: any; answeredAt: string } }
--   section_scores JSON shape:
--     { [sectionId]: number }
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS checklist.checklist_instances (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID NOT NULL,
    template_id      UUID NOT NULL,
    template_version INTEGER NOT NULL,
    inspection_id    UUID NOT NULL,
    sections         JSONB NOT NULL,
    responses        JSONB,
    section_scores   JSONB,
    overall_score    NUMERIC(5, 2),
    completed_at     TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by       UUID NOT NULL,
    updated_by       UUID NOT NULL,
    version          INTEGER NOT NULL DEFAULT 1
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- ROW-LEVEL SECURITY (tenant isolation) — ENABLE + FORCE + policy on every table.
--   FORCE ensures even the table owner is subject to the policy. The policy uses
--   the missing-ok GUC form so an unset app.tenant_id yields NULL → no rows
--   (fail-closed). Policies are dropped-then-created for idempotent re-runs.
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE checklist.checklist_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE checklist.checklist_templates FORCE  ROW LEVEL SECURITY;
ALTER TABLE checklist.checklist_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE checklist.checklist_instances FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON checklist.checklist_templates;
CREATE POLICY tenant_isolation ON checklist.checklist_templates
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation ON checklist.checklist_instances;
CREATE POLICY tenant_isolation ON checklist.checklist_instances
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- ═══════════════════════════════════════════════════════════════════════════════
-- INDEXES
--   Plain CREATE INDEX (not CONCURRENTLY): these tables are brand-new and empty at
--   migration time, so index builds are instant and non-blocking. All IF NOT EXISTS
--   for idempotent re-runs.
-- ═══════════════════════════════════════════════════════════════════════════════

-- Templates: tenant lookup
CREATE INDEX IF NOT EXISTS idx_checklist_templates_tenant
    ON checklist.checklist_templates(tenant_id);

-- Templates: filter by tenant and status (useful for listing published templates)
CREATE INDEX IF NOT EXISTS idx_checklist_templates_tenant_status
    ON checklist.checklist_templates(tenant_id, status);

-- Instances: primary lookup — find all checklist instances for a given inspection
CREATE INDEX IF NOT EXISTS idx_checklist_instances_tenant_inspection
    ON checklist.checklist_instances(tenant_id, inspection_id);

-- Instances: lookup by template for usage tracking
CREATE INDEX IF NOT EXISTS idx_checklist_instances_template
    ON checklist.checklist_instances(template_id);
