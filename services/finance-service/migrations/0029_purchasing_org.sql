-- 0029: Purchasing Organisation (SAP Purchasing Org concept).
-- The unit responsible for procurement — may span operating units or be 1:1.
-- procurement-service references this via purchasing_org_id. Additive + idempotent.

CREATE TABLE IF NOT EXISTS org.purchasing_orgs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  legal_entity_id UUID NOT NULL,
  code            TEXT NOT NULL,
  name            TEXT NOT NULL,
  scope           TEXT NOT NULL DEFAULT 'entity',     -- entity (one LE) | cross_entity (multiple LEs) | plant (single plant)
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by      UUID NOT NULL,
  updated_by      UUID NOT NULL,
  version         INT NOT NULL DEFAULT 1
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_purchasing_org_code ON org.purchasing_orgs (tenant_id, code);
CREATE INDEX IF NOT EXISTS idx_purchasing_org_le ON org.purchasing_orgs (tenant_id, legal_entity_id);
