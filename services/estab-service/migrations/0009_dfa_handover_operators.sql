-- 0009: eOffice Phase 4 — DFA (Draft For Approval), Charge Handover, and
-- paper→electronic migration register. Completes the outgoing-communication
-- lifecycle and the supporting features around the file backbone.
--
-- NOTE (ERP data-ownership): eOffice does NOT own a people/address directory.
-- Internal recipients/officers are resolved from the HRMS employee module;
-- vendors from procurement, citizens from citizen-service, external business
-- contacts from crm. A DFA references an internal employee (recipient_employee_id)
-- for internal communications, or carries a one-off inline address for genuine
-- external dispatch — neither duplicates a managed directory.

-- ─── DFA (Draft For Approval) ───────────────────────────────────────────────
-- Outgoing communication drafted on a file, routed for approval, then dispatched.
-- Lifecycle: draft → pending_approval → approved | returned → signed → dispatched
-- (signing is recorded here; cryptographic e-Sign/DSC is Phase 2, left as a hook).
CREATE TABLE IF NOT EXISTS files.estab_dfa (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL,
  dfa_no             TEXT NOT NULL,
  file_id            UUID,                              -- parent file (nullable for standalone)
  communication_type TEXT NOT NULL DEFAULT 'letter',   -- letter | order | memo | notification | circular | do_letter
  template_code      TEXT,
  subject            TEXT NOT NULL,
  body               TEXT NOT NULL,
  recipient_employee_id UUID,                         -- internal addressee (HRMS employee), resolved cross-service
  recipient_name     TEXT,                            -- one-off external recipient (not a managed directory)
  recipient_address  TEXT,
  status             TEXT NOT NULL DEFAULT 'draft',
  approved_by        UUID,
  approved_at        TIMESTAMPTZ,
  returned_reason    TEXT,
  signed_by          UUID,
  signed_at          TIMESTAMPTZ,
  signature_ref      TEXT,                              -- Phase 2 e-Sign/DSC hook (null until then)
  dispatch_id        UUID,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by         UUID NOT NULL,
  updated_by         UUID NOT NULL,
  version            INT NOT NULL DEFAULT 1,
  CONSTRAINT chk_dfa_status CHECK (status IN
    ('draft','pending_approval','approved','returned','signed','dispatched'))
);
CREATE INDEX IF NOT EXISTS idx_dfa_tenant_status ON files.estab_dfa (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_dfa_file ON files.estab_dfa (tenant_id, file_id);

-- ─── Charge Handover (transfer / leave) ─────────────────────────────────────
-- Reassigns all files currently held by one officer to another (transfer, leave,
-- retirement). Captured as an auditable event; the consumer moves the files.
CREATE TABLE IF NOT EXISTS files.estab_charge_handover (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  from_officer_id UUID NOT NULL,
  to_officer_id   UUID NOT NULL,
  reason          TEXT NOT NULL DEFAULT 'transfer',  -- transfer | leave | retirement | suspension
  remarks         TEXT,
  file_count      INT NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'pending',    -- pending | completed
  effective_from  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by      UUID NOT NULL,
  updated_by      UUID NOT NULL,
  version         INT NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_handover_tenant ON files.estab_charge_handover (tenant_id, status);

-- ─── Paper → Electronic migration register ──────────────────────────────────
-- Records physical files brought into the electronic system, with the legacy
-- reference and a scan storage pointer, linking to the created eFile.
CREATE TABLE IF NOT EXISTS files.estab_migration_register (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  legacy_file_no  TEXT NOT NULL,
  subject         TEXT NOT NULL,
  dept            TEXT NOT NULL,
  page_count      INT NOT NULL DEFAULT 0,
  scan_ref        TEXT,
  efile_id        UUID,                                -- created files.estab_files id
  status          TEXT NOT NULL DEFAULT 'registered', -- registered | digitised | linked
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by      UUID NOT NULL,
  updated_by      UUID NOT NULL,
  version         INT NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_migration_tenant ON files.estab_migration_register (tenant_id, status);

-- ─── eOffice File Operators (desk enrolment) ────────────────────────────────
-- Not every employee may operate eOffice files. A DIVISION ADMIN enrols specific
-- employees as file operators (desks) within a division/section, with a desk
-- role and whether they may INITIATE files. eOffice owns this eligibility map;
-- it references the HRMS employee by id (no PII duplication). File movement,
-- forward-to, charge handover and currentWith must target an ACTIVE operator.
CREATE TABLE IF NOT EXISTS files.estab_file_operator (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL,
  employee_id  UUID NOT NULL,                          -- HRMS employee reference (cross-service id)
  division     TEXT NOT NULL,                          -- division/wing the desk belongs to
  section      TEXT,                                   -- section/branch within the division
  desk_role    TEXT NOT NULL DEFAULT 'dealing_hand',   -- dealing_hand|section_officer|under_secretary|deputy_secretary|director|hod
  can_initiate BOOLEAN NOT NULL DEFAULT TRUE,          -- may this desk raise/initiate files
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  assigned_by  UUID NOT NULL,                          -- division admin who enrolled the desk
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by   UUID NOT NULL,
  updated_by   UUID NOT NULL,
  version      INT NOT NULL DEFAULT 1
);
-- One active desk per employee per division (an employee can hold desks in
-- multiple divisions, but not duplicate desks in the same division).
CREATE UNIQUE INDEX IF NOT EXISTS uq_file_operator_emp_division
  ON files.estab_file_operator (tenant_id, employee_id, division)
  WHERE active = TRUE;
CREATE INDEX IF NOT EXISTS idx_file_operator_lookup
  ON files.estab_file_operator (tenant_id, employee_id, active);
CREATE INDEX IF NOT EXISTS idx_file_operator_division
  ON files.estab_file_operator (tenant_id, division, active);
