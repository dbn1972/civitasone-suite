-- Purpose: Fix estab_dispatch_status_check (added in 0031) — it allows
-- ('pending', 'sent'), but no code path ever writes 'sent' to
-- files.estab_dispatch.status. Both call sites that create a dispatch record
-- (files/consumer.ts dispatchCreate, dfa/consumer.ts dfaDispatch) write
-- status: "dispatched". 0031's own comment says the value comes from
-- "consumer.ts on dispatch create" but names the wrong literal — the
-- constraint was authored against a misreading of the code, not the code
-- itself.
--
-- Effect on a fresh cluster (reproduced before this fix): every dispatch
-- creation — direct file dispatch AND the DFA maker-checker dispatch flow —
-- violates this CHECK constraint, so the consumer transaction rolls back and
-- the message dead-letters after retries. No estab_dispatch row has ever
-- been successfully created since 0031 landed; DFA dispatch (including the
-- H1 mandatory e-signature gate's "then dispatch" path) has been silently
-- broken the same way.
--
-- Rollback: ALTER TABLE files.estab_dispatch DROP CONSTRAINT IF EXISTS
--   estab_dispatch_status_check; then re-add the 0031 version if reverting.
SET lock_timeout = '5s';

ALTER TABLE files.estab_dispatch
  DROP CONSTRAINT IF EXISTS estab_dispatch_status_check;

DO $$ BEGIN
  ALTER TABLE files.estab_dispatch
    ADD CONSTRAINT estab_dispatch_status_check
    CHECK (status IN ('pending', 'dispatched'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE files.estab_dispatch VALIDATE CONSTRAINT estab_dispatch_status_check;
