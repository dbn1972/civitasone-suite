-- Purpose: CM-003 widen the contact_roles role vocabulary. Adds 'beneficiary',
--   'partner' and 'billing_contact' to the existing set {decision_maker,influencer,
--   champion,end_user,approver,technical}. Additive: no existing row invalidated.
-- Rollback: ALTER TABLE crm.contact_roles DROP CONSTRAINT IF EXISTS contact_roles_role_check;
--           -- (original check was inline/unnamed in migration 0021; drop leaves it unconstrained)
-- Affected services: crm-service (contacts/roles module)

SET lock_timeout = '5s';

DO $$
DECLARE
  conrec record;
BEGIN
  -- Migration 0021 created the CHECK inline (system-generated name). Drop whatever
  -- check constraint currently governs the role column, then add a named, widened one.
  FOR conrec IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = rel.relnamespace
    WHERE ns.nspname = 'crm' AND rel.relname = 'contact_roles'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%role%'
  LOOP
    EXECUTE format('ALTER TABLE crm.contact_roles DROP CONSTRAINT %I', conrec.conname);
  END LOOP;

  ALTER TABLE crm.contact_roles
    ADD CONSTRAINT contact_roles_role_check
    CHECK (role IN ('decision_maker','influencer','champion','end_user','approver','technical','beneficiary','partner','billing_contact'));
END $$;
