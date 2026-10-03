-- 0077_pt_slab_immutability.sql
--
-- GAP-PAYROLL-STATUTORY-PT-04: a professional-tax slab version is immutable
-- once written. Changing the slabs means creating a NEW version (new
-- effective_from); the old rows are never UPDATEd or DELETEd, so a past
-- payroll run can always be reproduced from the slabs that were in force.
-- Enforced in the database (not just the API) so a stray script cannot
-- rewrite history either. Idempotent.

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION payroll.pt_slab_version_immutable() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  RAISE EXCEPTION 'PT_VERSION_IMMUTABLE: professional tax slab versions cannot be changed or deleted; create a new version instead'
    USING ERRCODE = 'integrity_constraint_violation';
END;
$fn$;

DROP TRIGGER IF EXISTS trg_pt_slab_no_update ON payroll.payroll_professional_tax;
CREATE TRIGGER trg_pt_slab_no_update
  BEFORE UPDATE ON payroll.payroll_professional_tax
  FOR EACH ROW
  WHEN (OLD.* IS DISTINCT FROM NEW.*)
  EXECUTE FUNCTION payroll.pt_slab_version_immutable();

DROP TRIGGER IF EXISTS trg_pt_slab_no_delete ON payroll.payroll_professional_tax;
CREATE TRIGGER trg_pt_slab_no_delete
  BEFORE DELETE ON payroll.payroll_professional_tax
  FOR EACH ROW
  EXECUTE FUNCTION payroll.pt_slab_version_immutable();

DROP TRIGGER IF EXISTS trg_pt_version_no_update ON payroll.payroll_pt_slab_versions;
CREATE TRIGGER trg_pt_version_no_update
  BEFORE UPDATE ON payroll.payroll_pt_slab_versions
  FOR EACH ROW
  WHEN (OLD.* IS DISTINCT FROM NEW.*)
  EXECUTE FUNCTION payroll.pt_slab_version_immutable();

DROP TRIGGER IF EXISTS trg_pt_version_no_delete ON payroll.payroll_pt_slab_versions;
CREATE TRIGGER trg_pt_version_no_delete
  BEFORE DELETE ON payroll.payroll_pt_slab_versions
  FOR EACH ROW
  EXECUTE FUNCTION payroll.pt_slab_version_immutable();
