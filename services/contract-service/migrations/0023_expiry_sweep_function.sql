-- 0023_expiry_sweep_function.sql
-- Owner decision #42: daily contract-expiry sweeper (contract.expiry.alert).
--
-- The sweeper scans contracts.contract_contracts ACROSS ALL TENANTS. That table
-- is FORCE ROW LEVEL SECURITY and contract_svc is NOBYPASSRLS, so a bare
-- cross-tenant select (no app.tenant_id GUC) would match zero rows forever.
-- Same fix shape as citizen-service 0028: a narrow, read-only SECURITY DEFINER
-- function owned by the BYPASSRLS contract_scanner role (0015), executable by
-- contract_svc only. It exposes id/tenant_id/expiry/days_remaining of ACTIVE
-- contracts expiring within the window; nothing else is reachable.
--
-- Run as the migration admin (needs to ALTER OWNER to contract_scanner), like 0015.
-- contract_svc cannot SET ROLE contract_scanner, so applied as contract_svc the
-- ALTER FUNCTION ... OWNER TO below aborts with "must be able to SET ROLE".
-- The idempotent role re-assertion (identical to the one in 0015) states that
-- this migration needs the migration admin, which is also what routes it to the
-- bootstrapping superuser in scripts/ci/bootstrap-postgres.sh (needs_superuser).
ALTER ROLE contract_scanner BYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;

GRANT USAGE ON SCHEMA contracts TO contract_scanner;
GRANT SELECT ON contracts.contract_contracts TO contract_scanner;

CREATE OR REPLACE FUNCTION contracts.sweep_expiring_contracts(window_days int)
RETURNS TABLE(id uuid, tenant_id uuid, expiry date, days_remaining int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = contracts, pg_temp AS $$
  SELECT c.id, c.tenant_id, c.expiry, (c.expiry - CURRENT_DATE)::int
  FROM contracts.contract_contracts c
  WHERE c.status = 'active'
    AND c.expiry >= CURRENT_DATE
    AND c.expiry <= CURRENT_DATE + window_days
  ORDER BY c.expiry
  LIMIT 5000
$$;
ALTER FUNCTION contracts.sweep_expiring_contracts(int) OWNER TO contract_scanner;
REVOKE ALL ON FUNCTION contracts.sweep_expiring_contracts(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION contracts.sweep_expiring_contracts(int) TO contract_svc;
