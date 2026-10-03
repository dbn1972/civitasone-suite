-- 0078_pt_slab_lookup_index.sql
--
-- GAP-PAYROLL-STATUTORY-PT-04: the run engine resolves "the slab version in
-- force on a date" per (tenant, state) with MAX(effective_from) <= date;
-- this index serves that lookup and the version-timeline listing.
-- Idempotent.

SET lock_timeout = '5s';

CREATE INDEX IF NOT EXISTS ix_pt_tenant_state_eff_active
  ON payroll.payroll_professional_tax (tenant_id, state_code, effective_from)
  WHERE is_active;
