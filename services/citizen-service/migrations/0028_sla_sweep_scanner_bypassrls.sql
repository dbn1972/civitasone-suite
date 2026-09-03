-- 0028_sla_sweep_scanner_bypassrls.sql
-- Fix: the SLA-sweep scheduler's four cross-tenant scans
-- (sweepApplications/sweepGrievances/sweepTickets/sweepRti in
-- src/modules/sla-sweep/scheduler.ts) run as bare Drizzle `db.select()`
-- queries through the ordinary citizen_svc connection, with no
-- app.tenant_id GUC set (deliberately -- the whole point of the sweep is to
-- scan ACROSS every tenant, so there is no single tenant to scope a
-- db.transaction()/runWithTenant() to). application.citizen_applications,
-- grievance.citizen_grievances, helpdesk.citizen_tickets and
-- rti.citizen_rti_requests are all FORCE ROW LEVEL SECURITY, and citizen_svc
-- is NOBYPASSRLS, so each scan's `tenant_id = <schema>.current_tenant_id()`
-- policy check evaluates against a NULL current_tenant_id() and matches
-- NOTHING -- always zero rows, regardless of how many applications/
-- grievances/tickets/RTIs are actually overdue. Verified empirically against
-- a fresh cluster: seeding an application with status='submitted' and a past
-- deadline, `sweepApplications()` still returned 0 rows.
--
-- This means the SLA breach sweep (applicationSlaCheck / grievanceSlaCheck /
-- ticketSlaCheck / rtiSlaCheck) has never actually fired in production --
-- the exact "SECURITY DEFINER / NOBYPASSRLS role / FORCE RLS table -> silent
-- zero rows forever" bug class already fixed tonight for admin's SFTP
-- lead-ingestion sweep (0030) and workflow's message-timeout + task
-- sweepers (workflow_scanner, 0039), just at the Drizzle-query layer instead
-- of a SECURITY DEFINER SQL function.
--
-- FIX: same narrow-role pattern as contract-service 0015 / works-service
-- 0012 / payroll-service 0032 (BYPASSRLS scanner role, password from a
-- `civitas.<role>_password` GUC with a random-if-absent fallback -- see
-- scripts/ci/bootstrap-postgres.sh's scanner_role_guc_options()) -- but
-- exposed as four SECURITY DEFINER functions (one per table, read-only,
-- exactly the columns/filter each sweep needs) rather than a raw table
-- grant, so citizen_scanner can never be used to read a business table's
-- full contents even if a future caller mistakenly connects as it directly.

DO $$
DECLARE
  scanner_pw text := coalesce(
    nullif(current_setting('civitas.citizen_scanner_password', true), ''),
    -- No pgcrypto dependency: 64 hex chars of non-deterministic entropy.
    md5(random()::text || clock_timestamp()::text) || md5(random()::text || clock_timestamp()::text)
  );
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'citizen_scanner') THEN
    EXECUTE format(
      'CREATE ROLE citizen_scanner LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT BYPASSRLS',
      scanner_pw);
  ELSE
    IF nullif(current_setting('civitas.citizen_scanner_password', true), '') IS NOT NULL THEN
      EXECUTE format('ALTER ROLE citizen_scanner PASSWORD %L', scanner_pw);
    END IF;
    ALTER ROLE citizen_scanner BYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO citizen_scanner', current_database());
END
$$;

GRANT USAGE ON SCHEMA application TO citizen_scanner;
GRANT USAGE ON SCHEMA grievance TO citizen_scanner;
GRANT USAGE ON SCHEMA helpdesk TO citizen_scanner;
GRANT USAGE ON SCHEMA rti TO citizen_scanner;

GRANT SELECT ON application.citizen_applications TO citizen_scanner;
GRANT SELECT ON grievance.citizen_grievances TO citizen_scanner;
GRANT SELECT ON helpdesk.citizen_tickets TO citizen_scanner;
GRANT SELECT ON rti.citizen_rti_requests TO citizen_scanner;

-- One function per table: read-only, returns only id/tenant_id (+serviceId
-- for applications, which the sweep publishes as serviceType) for rows
-- matching exactly the sweep's existing filter. No other column, and no
-- other table, is reachable through citizen_scanner.

CREATE OR REPLACE FUNCTION application.sweep_overdue_applications()
RETURNS TABLE(id uuid, tenant_id uuid, service_id uuid)
LANGUAGE sql SECURITY DEFINER SET search_path = application, pg_temp AS $$
  SELECT id, tenant_id, service_id
  FROM application.citizen_applications
  WHERE status IN ('submitted','under_review','pending_docs')
    AND (deadline < CURRENT_DATE OR deadline IS NULL)
  LIMIT 2000
$$;
ALTER FUNCTION application.sweep_overdue_applications() OWNER TO citizen_scanner;
REVOKE ALL ON FUNCTION application.sweep_overdue_applications() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION application.sweep_overdue_applications() TO citizen_svc;

CREATE OR REPLACE FUNCTION grievance.sweep_overdue_grievances(cutoff timestamptz)
RETURNS TABLE(id uuid, tenant_id uuid)
LANGUAGE sql SECURITY DEFINER SET search_path = grievance, pg_temp AS $$
  SELECT id, tenant_id
  FROM grievance.citizen_grievances
  WHERE status IN ('registered','assigned','in_progress','reopened')
    AND updated_at < cutoff
  LIMIT 2000
$$;
ALTER FUNCTION grievance.sweep_overdue_grievances(timestamptz) OWNER TO citizen_scanner;
REVOKE ALL ON FUNCTION grievance.sweep_overdue_grievances(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION grievance.sweep_overdue_grievances(timestamptz) TO citizen_svc;

CREATE OR REPLACE FUNCTION helpdesk.sweep_overdue_tickets(as_of timestamptz)
RETURNS TABLE(id uuid, tenant_id uuid)
LANGUAGE sql SECURITY DEFINER SET search_path = helpdesk, pg_temp AS $$
  SELECT id, tenant_id
  FROM helpdesk.citizen_tickets
  WHERE status IN ('open','in_progress')
    AND sla_due_at < as_of
  LIMIT 2000
$$;
ALTER FUNCTION helpdesk.sweep_overdue_tickets(timestamptz) OWNER TO citizen_scanner;
REVOKE ALL ON FUNCTION helpdesk.sweep_overdue_tickets(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION helpdesk.sweep_overdue_tickets(timestamptz) TO citizen_svc;

CREATE OR REPLACE FUNCTION rti.sweep_overdue_rti()
RETURNS TABLE(id uuid, tenant_id uuid)
LANGUAGE sql SECURITY DEFINER SET search_path = rti, pg_temp AS $$
  SELECT id, tenant_id
  FROM rti.citizen_rti_requests
  WHERE status IN ('filed','forwarded','under_review')
    AND deadline < CURRENT_DATE
  LIMIT 2000
$$;
ALTER FUNCTION rti.sweep_overdue_rti() OWNER TO citizen_scanner;
REVOKE ALL ON FUNCTION rti.sweep_overdue_rti() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rti.sweep_overdue_rti() TO citizen_svc;
