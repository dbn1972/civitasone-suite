-- 0090_crm_scanner_function_ownership.sql
-- Fixes the cross-tenant discovery functions so they actually bypass RLS.
--
-- Bug (same shape as 0089, one layer deeper): a SECURITY DEFINER function
-- executes with the PRIVILEGES OF ITS OWNER, not of the caller. 0089 granted
-- crm_scanner (BYPASSRLS) permission to EXECUTE crm.list_document_alert_tenants(),
-- and scanner-db.ts / alert-scheduler.ts call it through scannerSqlClient — but
-- that only lets crm_scanner INVOKE the function. Ownership of the function
-- itself was never transferred, so it still runs as whoever CREATEd it.
--
-- Under this repo's own migration runner (scripts/ci/bootstrap-postgres.sh),
-- per-service migrations that do not create/alter a role run AS THE SERVICE
-- ROLE ITSELF (crm_svc here), not as civitas_admin — confirmed empirically:
--   SELECT proname, (SELECT rolname FROM pg_roles WHERE oid = proowner)
--   FROM pg_proc WHERE proname LIKE 'list_%tenants';
--     list_document_alert_tenants  | crm_svc
--     list_escalation_tenants      | crm_svc
--     list_task_escalation_tenants | crm_svc
-- crm_svc is deliberately NOBYPASSRLS, so FORCE ROW LEVEL SECURITY on
-- crm.document_types / crm.documents / crm.escalation_rules /
-- crm.task_escalation_rules still applies to these functions' effective user
-- no matter who is granted EXECUTE — they silently return zero cross-tenant
-- rows forever. (0089's comment assumed the owner would be civitas_admin;
-- civitas_admin is ALSO NOBYPASSRLS by design, so even under a bootstrap path
-- that runs migrations as civitas_admin this defect reproduces identically —
-- ownership, not the runner identity, is what has to change.)
--
-- Live-reproduced against a fresh bootstrap: tests/documents.test.ts's
-- "list_document_alert_tenants() discovers tenants across the WHOLE table"
-- case failed with an empty result before this migration.
--
-- Fix: transfer ownership of all three discovery functions to crm_scanner
-- (the dedicated BYPASSRLS role from 0089) and grant it SELECT on the
-- tables each function reads, so the SECURITY DEFINER + BYPASSRLS owner
-- combination actually does what 0089 documented. Also wires
-- crm.list_escalation_tenants() / crm.list_task_escalation_tenants() —
-- flagged as an explicit follow-up in 0089 ("Not in scope ... Tracked as a
-- follow-up") — through crm_scanner the same way, so the assignment and
-- task-escalation schedulers (src/modules/assignment/scheduler.ts,
-- src/modules/activities/task-escalation-scheduler.ts) get the same fix as
-- the document-alert scheduler.
--
-- Scope: ownership transfer + read grants only. crm_svc's own EXECUTE grants
-- on these functions (from 0068/0047/0055) are left untouched — after this
-- migration a call from crm_svc still runs as crm_scanner (SECURITY DEFINER
-- semantics), which is exactly the intended discovery-only behaviour.
--
-- Must run as a role that is either superuser or already owns these functions
-- AND is a member of crm_scanner (ALTER ... OWNER TO requires both). Content
-- below re-asserts the crm_scanner role (idempotent, mirrors 0089) so this
-- file is routed to the superuser lane by bootstrap-postgres.sh's
-- needs_superuser() detector, exactly like 0089 is.
--
-- Rollback: ALTER FUNCTION crm.list_document_alert_tenants() OWNER TO crm_svc;
--           ALTER FUNCTION crm.list_escalation_tenants() OWNER TO crm_svc;
--           ALTER FUNCTION crm.list_task_escalation_tenants() OWNER TO crm_svc;
--           REVOKE SELECT ON crm.escalation_rules, crm.task_escalation_rules FROM crm_scanner;
-- Affected services: crm-service

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_scanner') THEN
    RAISE EXCEPTION 'crm_scanner role does not exist — run 0089_crm_scanner_role.sql first';
  END IF;
  -- Idempotent no-op reassert (mirrors 0089's ELSE branch): its only purpose
  -- here is to make this file content-match bootstrap-postgres.sh's
  -- needs_superuser() detector so it runs with the privileges this migration
  -- actually needs.
  ALTER ROLE crm_scanner BYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
END
$$;

GRANT SELECT ON crm.escalation_rules TO crm_scanner;
GRANT SELECT ON crm.task_escalation_rules TO crm_scanner;

ALTER FUNCTION crm.list_document_alert_tenants() OWNER TO crm_scanner;
ALTER FUNCTION crm.list_escalation_tenants() OWNER TO crm_scanner;
ALTER FUNCTION crm.list_task_escalation_tenants() OWNER TO crm_scanner;

GRANT EXECUTE ON FUNCTION crm.list_escalation_tenants() TO crm_scanner;
GRANT EXECUTE ON FUNCTION crm.list_task_escalation_tenants() TO crm_scanner;
