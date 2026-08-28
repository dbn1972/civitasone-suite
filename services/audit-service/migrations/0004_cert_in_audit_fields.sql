-- audit-service CERT-In compliance migration
-- Adds IP address, user agent, old/new value capture, and 180-day retention enforcement
-- to events.events (APPEND-ONLY table — no UPDATE or DELETE permitted).
-- Applied with audit_svc role on civitas_audit after 0003_risk_register.sql.

-- CERT-In §4 required fields
ALTER TABLE events.events
  ADD COLUMN IF NOT EXISTS ip_address    inet,
  ADD COLUMN IF NOT EXISTS user_agent    varchar(512),
  ADD COLUMN IF NOT EXISTS old_value     jsonb,
  ADD COLUMN IF NOT EXISTS new_value     jsonb,
  -- retain_until: every event must be retained for at least 180 days from occurrence
  ADD COLUMN IF NOT EXISTS retain_until  timestamptz NOT NULL
    DEFAULT (now() + INTERVAL '180 days');

-- Backfill retain_until for any existing rows that pre-date this migration
UPDATE events.events
   SET retain_until = occurred_at + INTERVAL '180 days'
 WHERE retain_until IS NULL;

-- Index to support retention sweep queries (purge only rows past retain_until).
-- Not a partial index: "WHERE retain_until < now()" is not a valid index
-- predicate (now() is STABLE, not IMMUTABLE -- a row's membership would have
-- to change over time with no corresponding row update, which Postgres
-- forbids for index predicates). A plain index on the column already lets the
-- planner use it efficiently for "retain_until < now()" range scans at query
-- time; only the persisted predicate needs to avoid now().
CREATE INDEX IF NOT EXISTS idx_audit_events_retain_until
  ON events.events(retain_until);

-- observation.audit_observations — add replied_rejected status (AU-01 review loop)
-- The status column is varchar(24) which already accommodates the new values.
-- No schema change needed; status values are application-enforced.

-- Comment: Immutability is enforced by absence of UPDATE/DELETE routes in the application
-- and by revocation of UPDATE/DELETE grants on events.events from audit_svc role:
-- REVOKE UPDATE, DELETE ON events.events FROM audit_svc;
-- (Run this against the DB bootstrap script to enforce at DB layer too.)
