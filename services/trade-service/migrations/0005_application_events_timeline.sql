-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration: 0005_application_events_timeline.sql
-- Service:   trade-service — DB civitas_trade
--
-- Purpose:
--   GAP-MUNICIPAL-SERVICEKEY-APPLICATIONS-DETAIL-02 — the municipal officer
--   console needs a HISTORY/timeline for an application (who did what, when, and
--   the status transition), and officer actions must leave an auditable trail.
--   Until now trade.trade_applications only carried the CURRENT status with no
--   per-transition record, so the generic municipal detail panel had nothing to
--   render as history. This adds an append-only event log, written in the SAME
--   transaction as every status transition (create/submit/withdraw/decide/
--   fee-payment) so the timeline can never drift from the row's status.
--
--     trade.trade_application_events
--       application_id  — the application the event belongs to
--       action          — create | submit | withdraw | approve | reject |
--                          inspect | issue | fee_payment (free-form, bounded)
--       from_status     — status before the transition (null for create)
--       to_status       — status after the transition
--       note            — optional officer remark / reason
--       actor_id        — the officer/citizen who performed the action
--       created_at      — when it happened (the timeline order)
--
--   Append-only: no updated_at/version (events are immutable facts). Additive +
--   idempotent (IF NOT EXISTS). RLS: ENABLE + FORCE + tenant_isolation, mirroring
--   every other trade.* table in 0001_initial.sql.
--
-- Rollback (DESTRUCTIVE — DBA approval; no automatic down-migration):
--   DROP TABLE IF EXISTS trade.trade_application_events;
--
-- Affected services: trade-service only (own database).
-- ═══════════════════════════════════════════════════════════════════════════════

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS trade.trade_application_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  application_id  uuid NOT NULL,
  action          varchar(32) NOT NULL,
  from_status     varchar(32),
  to_status       varchar(32) NOT NULL,
  note            text,
  actor_id        uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS trade_application_events_tenant_idx
  ON trade.trade_application_events (tenant_id);
CREATE INDEX IF NOT EXISTS trade_application_events_app_idx
  ON trade.trade_application_events (application_id, created_at);

ALTER TABLE trade.trade_application_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE trade.trade_application_events FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'trade_application_events' AND schemaname = 'trade' AND policyname = 'tenant_isolation') THEN
    EXECUTE $pol$
      CREATE POLICY tenant_isolation ON trade.trade_application_events
        USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    $pol$;
  END IF;
END $$;

-- Align ownership/grants with the sibling trade.* tables. In production the
-- migration runs AS the service role so the new table is already owned by it;
-- when applied by a superuser (e.g. the shared test harness) the table would
-- otherwise be inaccessible to the service login. Hand ownership to whichever
-- role owns trade.trade_applications so this table behaves identically.
DO $$
DECLARE svc_role name;
BEGIN
  SELECT pg_get_userbyid(relowner) INTO svc_role
    FROM pg_class WHERE oid = 'trade.trade_applications'::regclass;
  IF svc_role IS NOT NULL AND svc_role <> current_user THEN
    EXECUTE format('ALTER TABLE trade.trade_application_events OWNER TO %I', svc_role);
  END IF;
END $$;
