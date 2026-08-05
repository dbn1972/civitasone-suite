-- Gap 8: Add 'sponsor' to account_relationships rel_type CHECK constraint.
-- Rollback: ALTER TABLE crm.account_relationships DROP CONSTRAINT IF EXISTS account_relationships_rel_type_check;
--           ALTER TABLE crm.account_relationships ADD CONSTRAINT account_relationships_rel_type_check
--             CHECK (rel_type IN ('parent', 'subsidiary', 'group', 'branch', 'partner', 'affiliate'));
SET lock_timeout = '5s';

DO $$ BEGIN
  ALTER TABLE crm.account_relationships DROP CONSTRAINT IF EXISTS account_relationships_rel_type_check;
  ALTER TABLE crm.account_relationships ADD CONSTRAINT account_relationships_rel_type_check
    CHECK (rel_type IN ('parent', 'subsidiary', 'group', 'branch', 'partner', 'affiliate', 'sponsor'));
END $$;
