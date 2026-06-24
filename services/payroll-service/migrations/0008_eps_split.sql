-- Iter5: persist the EPF employer split (EPS 8.33% cap 1250 / EPF remainder) for ECR.
ALTER TABLE statutory.payroll_pf
  ADD COLUMN IF NOT EXISTS eps_contrib_minor     bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS epf_er_contrib_minor  bigint NOT NULL DEFAULT 0;
