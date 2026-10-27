-- 0017_assistant_interactions_expires_at.sql
-- UAT owner decision #16 (GAP-KNOWLEDGE-ASSISTANT-06): assistant interactions are
-- kept for 90 days and then purged. expires_at = created_at + 90 days; the purge
-- sweep (src/modules/assistant/retention.ts) deletes rows whose expires_at has
-- passed. Audit events are not touched: they follow the audit service retention.
--
-- The backfill UPDATE touches a FORCE RLS table, so it uses the NO FORCE / FORCE wrap.
ALTER TABLE knowledge.assistant_interactions
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

ALTER TABLE knowledge.assistant_interactions NO FORCE ROW LEVEL SECURITY;
UPDATE knowledge.assistant_interactions
   SET expires_at = created_at + interval '90 days'
 WHERE expires_at IS NULL;
ALTER TABLE knowledge.assistant_interactions FORCE ROW LEVEL SECURITY;

ALTER TABLE knowledge.assistant_interactions
  ALTER COLUMN expires_at SET DEFAULT (now() + interval '90 days'),
  ALTER COLUMN expires_at SET NOT NULL;

-- Sweep discovery scans by expiry across tenants.
CREATE INDEX IF NOT EXISTS idx_assistant_interactions_expires
  ON knowledge.assistant_interactions (expires_at);
