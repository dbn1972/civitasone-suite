-- 0270_hrms_grade_bands.sql
--
-- S8-G4: private grade bands beyond the 7th CPC designation level 1-18.
-- (design: ~/orch-logs/segments/section8-design.md section 5.)
--
-- A tenant that is not on the pay matrix (a Section 8 company / autonomous body paying
-- private bands such as C2, T3, M2) defines its own bands. A designation may point at one.
-- Everything is ADDITIVE and defaults to "exactly as before":
--   * hrms_designations.level is untouched; grade_band_id is NULL for every existing row.
--   * nothing reads a band unless the tenant's policy setting pay_scale.kind is
--     'private_bands' (policy-settings registry, default 'cpc7'), so government tenants
--     see no change.
--
-- Numbering: 0266-0269 are taken by the sibling drafts (G3, G5, G6, G1); re-check at merge time.
--
-- Rollback (nothing else depends on these):
--   ALTER TABLE employee.hrms_designations DROP CONSTRAINT IF EXISTS hrms_designations_grade_band_fk;
--   ALTER TABLE employee.hrms_designations DROP COLUMN IF EXISTS grade_band_id;
--   DROP TABLE IF EXISTS employee.hrms_grade_bands;

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS employee.hrms_grade_bands (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL,
  -- the label printed on screens and the payslip: C2, T3, M2 ...
  code           varchar(16) NOT NULL,
  name           varchar(120) NOT NULL,
  -- ordering for "who is more senior" decisions (higher = more senior). Ties are allowed
  -- (two parallel tracks can sit at the same rank).
  rank           integer     NOT NULL,
  -- optional career track, e.g. Technical, Managerial, Support
  track          varchar(40),
  -- indicative annual CTC range in minor units (paise); informational unless the tenant decides otherwise
  ctc_min_minor  bigint,
  ctc_max_minor  bigint,
  notice_days    integer,
  is_active      boolean     NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid        NOT NULL,
  updated_by     uuid        NOT NULL,
  version        integer     NOT NULL DEFAULT 1,
  CONSTRAINT hrms_grade_bands_rank_chk   CHECK (rank >= 1 AND rank <= 9999),
  CONSTRAINT hrms_grade_bands_ctc_chk    CHECK (
    (ctc_min_minor IS NULL OR ctc_min_minor >= 0)
    AND (ctc_max_minor IS NULL OR ctc_max_minor >= 0)
    AND (ctc_min_minor IS NULL OR ctc_max_minor IS NULL OR ctc_min_minor <= ctc_max_minor)),
  CONSTRAINT hrms_grade_bands_notice_chk CHECK (notice_days IS NULL OR (notice_days >= 0 AND notice_days <= 365))
);

-- (tenant_id, code) is the business key; (tenant_id, id) is the target of the composite FK below so a
-- designation can never point at another tenant's band even if RLS were bypassed.
CREATE UNIQUE INDEX IF NOT EXISTS hrms_grade_bands_tenant_code_uq ON employee.hrms_grade_bands (tenant_id, code);
CREATE UNIQUE INDEX IF NOT EXISTS hrms_grade_bands_tenant_id_uq   ON employee.hrms_grade_bands (tenant_id, id);
CREATE INDEX IF NOT EXISTS hrms_grade_bands_tenant_rank_idx       ON employee.hrms_grade_bands (tenant_id, rank);

ALTER TABLE employee.hrms_grade_bands ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee.hrms_grade_bands FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON employee.hrms_grade_bands;
CREATE POLICY tenant_isolation_policy ON employee.hrms_grade_bands
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- ── designation -> band link (nullable; level stays as is) ──────────────────
ALTER TABLE employee.hrms_designations ADD COLUMN IF NOT EXISTS grade_band_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'hrms_designations_grade_band_fk') THEN
    ALTER TABLE employee.hrms_designations
      ADD CONSTRAINT hrms_designations_grade_band_fk
      FOREIGN KEY (tenant_id, grade_band_id) REFERENCES employee.hrms_grade_bands (tenant_id, id)
      ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS hrms_designations_grade_band_idx
  ON employee.hrms_designations (tenant_id, grade_band_id) WHERE grade_band_id IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hrms_svc') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON employee.hrms_grade_bands TO hrms_svc;
  END IF;
END $$;
