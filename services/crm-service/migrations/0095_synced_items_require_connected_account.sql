-- Purpose: GAP-CRM-LINKED-ACCOUNTS-01 (DPDP, fail-closed).
--   A mailbox/calendar in crm.linked_accounts is registered by typing an email
--   address only; this service performs NO OAuth/consent or proof-of-ownership
--   exchange (live provider sync is deferred), so such a row can only ever be
--   status='pending'. Nothing may be synced INTO CRM against it until its
--   ownership has actually been verified through a provider consent (OAuth)
--   flow that flips it to status='connected'. Otherwise any CRM user could
--   ingest a third party's mailbox metadata just by typing their address.
--
--   The route layer (modules/integrations/routes.ts) already fails this closed,
--   but the write itself happens in the CQRS consumer. This migration adds a
--   DB-level trigger so the invariant holds for EVERY writer of crm.synced_items
--   (route, consumer, future connector, ad-hoc SQL) — defense in depth.
-- Rollback:
--   DROP TRIGGER IF EXISTS trg_synced_items_require_connected ON crm.synced_items;
--   DROP FUNCTION IF EXISTS crm.synced_items_require_connected();
-- Affected services: crm-service (integrations module)

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION crm.synced_items_require_connected()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  acct_status text;
BEGIN
  SELECT status INTO acct_status
  FROM crm.linked_accounts
  WHERE id = NEW.linked_account_id AND tenant_id = NEW.tenant_id;

  IF acct_status IS NULL THEN
    RAISE EXCEPTION 'linked account % not found for tenant %', NEW.linked_account_id, NEW.tenant_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF acct_status <> 'connected' THEN
    -- DPDP fail-closed: pending/error accounts have no verified ownership/consent.
    RAISE EXCEPTION 'linked account % is % (not connected): mailbox/calendar sync requires verified ownership (OAuth consent)', NEW.linked_account_id, acct_status
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$fn$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_synced_items_require_connected'
      AND tgrelid = 'crm.synced_items'::regclass
  ) THEN
    CREATE TRIGGER trg_synced_items_require_connected
      BEFORE INSERT OR UPDATE OF linked_account_id ON crm.synced_items
      FOR EACH ROW
      EXECUTE FUNCTION crm.synced_items_require_connected();
  END IF;
END $$;
