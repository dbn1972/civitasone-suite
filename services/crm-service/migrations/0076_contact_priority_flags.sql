-- Gap 4: Vulnerable-Customer Priority Flags — add priority_flags to contacts.
-- Rollback: ALTER TABLE crm.contacts DROP COLUMN IF EXISTS priority_flags;
SET lock_timeout = '5s';

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'crm' AND table_name = 'contacts' AND column_name = 'priority_flags'
  ) THEN
    ALTER TABLE crm.contacts ADD COLUMN priority_flags jsonb NOT NULL DEFAULT '[]';
  END IF;
END $$;
