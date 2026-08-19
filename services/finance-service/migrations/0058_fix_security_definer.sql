-- DB-H3: Add fixed search_path to SECURITY DEFINER function to prevent search_path injection
CREATE OR REPLACE FUNCTION budget.current_tenant_id()
  RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = budget, pg_catalog
AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;
