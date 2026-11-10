-- 0166_pay_components_ctc_ready.sql
--
-- Section 8 gap G2 (design section 3.3, shared with G1): the payroll component master becomes
-- writable and CTC-template ready.
--
-- payroll.payroll_structures
--   kind               run (every structure today, the one-per-run structure) | ctc_template (G1)
--   is_locked/locked_* set explicitly by the lock action; a structure referenced by a run is also
--                      treated as locked by the API (no write path needed in the run code)
--   effective_from     template effective date
--   template_version / parent_structure_id / lineage_root_id   new-version lineage (templates are immutable once used);
--                      unique (tenant, lineage root, template_version), so two versions can never share a number
-- payroll.payroll_components
--   is_active          deactivate, never delete (a slip may have used it)
--   calc               pct_of_ctc | pct_of_basic | fixed | balancing  (NULL = legacy row: the engine
--                      reads pct_of_basic / fixed_minor as before); employer PF / ESI lines carry NULL
--                      because they are derived from the statutory config, not from an amount
--   pct_of_ctc_bps     percent of monthly fixed CTC in basis points (0..10000)
--   employer_cost_class employer_pf | employer_esi | gratuity_provision | group_insurance | other_employer
--   cost_placement     inside_ctc | on_top  (meaningful only when employer_cost_class is set)
--   counts_for_pf_wage / counts_for_esi_wage / counts_for_gratuity / lop_applicable
--                      wage-base and LOP flags; stored now, consumed by the G1 CTC engine; every
--                      existing row is FALSE, which preserves today behaviour
--   payslip_order      display / payslip ordering
--
-- Additive and idempotent. Old code ignores the new columns. Rollback (after deleting any employer_cost rows,
-- re-add the 0031 check CHECK (component_type IN ('earning', 'deduction'))):
--   DROP INDEX IF EXISTS payroll.ux_payroll_components_one_balancing, payroll.ux_payroll_structures_lineage_version;
--   ALTER TABLE payroll.payroll_components DROP COLUMN IF EXISTS is_active, DROP COLUMN IF EXISTS calc,
--     DROP COLUMN IF EXISTS pct_of_ctc_bps, DROP COLUMN IF EXISTS employer_cost_class, DROP COLUMN IF EXISTS cost_placement,
--     DROP COLUMN IF EXISTS counts_for_pf_wage, DROP COLUMN IF EXISTS counts_for_esi_wage,
--     DROP COLUMN IF EXISTS counts_for_gratuity, DROP COLUMN IF EXISTS lop_applicable, DROP COLUMN IF EXISTS payslip_order;
--   ALTER TABLE payroll.payroll_structures DROP COLUMN IF EXISTS kind, DROP COLUMN IF EXISTS is_locked,
--     DROP COLUMN IF EXISTS locked_at, DROP COLUMN IF EXISTS locked_by, DROP COLUMN IF EXISTS effective_from,
--     DROP COLUMN IF EXISTS template_version, DROP COLUMN IF EXISTS parent_structure_id, DROP COLUMN IF EXISTS lineage_root_id;

SET lock_timeout = '5s';

ALTER TABLE payroll.payroll_structures
  ADD COLUMN IF NOT EXISTS kind                varchar(16) NOT NULL DEFAULT 'run',
  ADD COLUMN IF NOT EXISTS is_locked           boolean     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS locked_at           timestamptz,
  ADD COLUMN IF NOT EXISTS locked_by           uuid,
  ADD COLUMN IF NOT EXISTS effective_from      date,
  ADD COLUMN IF NOT EXISTS template_version    integer     NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS parent_structure_id uuid,
  ADD COLUMN IF NOT EXISTS lineage_root_id     uuid;

-- Every existing structure is the root of its own lineage (version 1). Idempotent.
UPDATE payroll.payroll_structures SET lineage_root_id = id WHERE lineage_root_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_payroll_structures_lineage_version
  ON payroll.payroll_structures (tenant_id, lineage_root_id, template_version) WHERE lineage_root_id IS NOT NULL;

DO $$ BEGIN
  ALTER TABLE payroll.payroll_structures
    ADD CONSTRAINT payroll_structures_kind_chk CHECK (kind IN ('run', 'ctc_template'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE payroll.payroll_components
  ADD COLUMN IF NOT EXISTS is_active           boolean     NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS calc                varchar(24),
  ADD COLUMN IF NOT EXISTS pct_of_ctc_bps      integer,
  ADD COLUMN IF NOT EXISTS employer_cost_class varchar(24),
  ADD COLUMN IF NOT EXISTS cost_placement      varchar(16) NOT NULL DEFAULT 'inside_ctc',
  ADD COLUMN IF NOT EXISTS counts_for_pf_wage  boolean     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS counts_for_esi_wage boolean     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS counts_for_gratuity boolean     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS lop_applicable      boolean     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS payslip_order       smallint;

-- Backfill (idempotent): calc from the existing pct / fixed columns, with the engine precedence
-- (a positive pct_of_basic wins over fixed_minor, domain.ts rawComponentAmountMinor).
UPDATE payroll.payroll_components SET calc = 'pct_of_basic'
  WHERE calc IS NULL AND pct_of_basic IS NOT NULL AND pct_of_basic > 0;
UPDATE payroll.payroll_components SET calc = 'fixed'
  WHERE calc IS NULL AND fixed_minor IS NOT NULL;

-- component_type gains employer_cost (CTC templates only; the API refuses it on a run structure, so the
-- engine, which casts component_type to earning | deduction, never sees one). 0031 allowed the two.
ALTER TABLE payroll.payroll_components DROP CONSTRAINT IF EXISTS payroll_components_component_type_check;
ALTER TABLE payroll.payroll_components ADD CONSTRAINT payroll_components_component_type_check
  CHECK (component_type IN ('earning', 'deduction', 'employer_cost'));

DO $$ BEGIN
  ALTER TABLE payroll.payroll_components ADD CONSTRAINT payroll_components_calc_chk
    CHECK (calc IS NULL OR calc IN ('pct_of_ctc', 'pct_of_basic', 'fixed', 'balancing'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE payroll.payroll_components ADD CONSTRAINT payroll_components_employer_class_chk
    CHECK (employer_cost_class IS NULL OR employer_cost_class IN
      ('employer_pf', 'employer_esi', 'gratuity_provision', 'group_insurance', 'other_employer'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE payroll.payroll_components ADD CONSTRAINT payroll_components_placement_chk
    CHECK (cost_placement IN ('inside_ctc', 'on_top'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE payroll.payroll_components ADD CONSTRAINT payroll_components_ctc_bps_chk
    CHECK (pct_of_ctc_bps IS NULL OR pct_of_ctc_bps BETWEEN 0 AND 10000);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Codes are already unique per (tenant, structure): UNIQUE in 0001_init.sql (inactive rows keep their code).

-- At most one active balancing component per structure.
CREATE UNIQUE INDEX IF NOT EXISTS ux_payroll_components_one_balancing
  ON payroll.payroll_components (tenant_id, structure_id) WHERE calc = 'balancing' AND is_active;
