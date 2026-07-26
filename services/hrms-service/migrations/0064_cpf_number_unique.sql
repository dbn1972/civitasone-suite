-- 0064_cpf_number_unique.sql
-- Finding 1 (MEDIUM): CPF account number must be unique per tenant, like NPS PRAN.
-- The 0063 table only had UNIQUE (tenant_id, employee_id); this adds a second
-- uniqueness on the government identifier so two employees in one tenant cannot
-- share a cpf_number. Additive + idempotent (guarded ADD CONSTRAINT).

SET lock_timeout = '5s';

DO $$ BEGIN
  ALTER TABLE cpf.hrms_cpf_accounts
    ADD CONSTRAINT hrms_cpf_accounts_cpf_number_uq UNIQUE (tenant_id, cpf_number);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
