-- 0008: eOffice approval matrix (config-driven, amount-based routing)
-- Lets a tenant define WHO must approve WHAT by (module, source_type, amount band)
-- as data, instead of hand-authoring a workflow definition graph for each case.
-- The resolver picks the matching rule and supplies its workflow_definition_code
-- as the file's approval_chain when a module raises an eFile.

CREATE TABLE IF NOT EXISTS files.estab_approval_rule (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                UUID NOT NULL,
  module                   TEXT NOT NULL,                 -- 'finance', 'hr', 'procurement', 'grant', 'legal', 'asset', 'contract'
  source_type              TEXT NOT NULL,                 -- e.g. 'finance_sanction', 'procurement_po' (matches SOURCE_REF_TYPES)
  label                    TEXT NOT NULL,                 -- human-readable rule name
  -- Inclusive lower bound, exclusive-or-open upper bound, in minor units (paise).
  min_amount_minor         BIGINT NOT NULL DEFAULT 0,
  max_amount_minor         BIGINT,                        -- NULL = unbounded (… and above)
  workflow_definition_code TEXT NOT NULL,                 -- becomes the file's approval_chain
  start_node_key           TEXT NOT NULL DEFAULT 'review',
  -- Ordered approval steps for display/audit, e.g. [{"role":"director","label":"Director"}, …]
  steps                    JSONB NOT NULL DEFAULT '[]'::jsonb,
  priority                 INT NOT NULL DEFAULT 100,      -- lower wins on tie (more specific rules get lower numbers)
  active                   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by               UUID NOT NULL,
  updated_by               UUID NOT NULL,
  version                  INT NOT NULL DEFAULT 1,
  -- An amount band must be coherent.
  CONSTRAINT chk_approval_rule_band CHECK (max_amount_minor IS NULL OR max_amount_minor > min_amount_minor)
);

-- Resolver lookup path: active rules for a (tenant, source_type) ordered by band.
CREATE INDEX IF NOT EXISTS idx_approval_rule_lookup
  ON files.estab_approval_rule (tenant_id, source_type, active, min_amount_minor);

-- Prevent overlapping/duplicate bands for the same (tenant, source_type, min) when active.
CREATE UNIQUE INDEX IF NOT EXISTS uq_approval_rule_band
  ON files.estab_approval_rule (tenant_id, source_type, min_amount_minor)
  WHERE active = TRUE;
