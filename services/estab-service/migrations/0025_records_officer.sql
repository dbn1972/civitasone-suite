-- 0025: Records Officer + annual review register (gap analysis R6).
-- Public Records Rules 1997: every records-creating agency nominates a Records
-- Officer; an annual review driven by review_due_date identifies files needing
-- retention review. Additive + idempotent.

CREATE TABLE IF NOT EXISTS files.estab_records_officer (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL,
  operator_id  UUID NOT NULL,                          -- estab_file_operator reference
  org_unit_id  UUID,                                   -- optional R1 org unit linkage
  appointed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by   UUID NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by   UUID NOT NULL,
  version      INT NOT NULL DEFAULT 1
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_records_officer_tenant
  ON files.estab_records_officer (tenant_id) WHERE active = TRUE;
CREATE INDEX IF NOT EXISTS idx_records_officer_lookup
  ON files.estab_records_officer (tenant_id, active);

-- Annual review register: records the outcome of a review for a file.
CREATE TABLE IF NOT EXISTS files.estab_annual_review (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  file_id         UUID NOT NULL,
  reviewed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_by     UUID NOT NULL,
  decision        TEXT NOT NULL,                       -- retain|weed|archive
  remarks         TEXT,
  next_review_due DATE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by      UUID NOT NULL,
  CONSTRAINT chk_review_decision CHECK (decision IN ('retain','weed','archive'))
);

CREATE INDEX IF NOT EXISTS idx_annual_review_file
  ON files.estab_annual_review (tenant_id, file_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON files.estab_records_officer TO estab_svc;
GRANT SELECT, INSERT, UPDATE, DELETE ON files.estab_annual_review TO estab_svc;
