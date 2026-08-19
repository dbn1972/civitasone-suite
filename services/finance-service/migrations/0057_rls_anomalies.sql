-- DB-H2: FORCE ROW LEVEL SECURITY on public.finance_anomalies
-- Also upgrades policy to use STABLE-function form (fixes re-evaluation per row)
DO $$ BEGIN
  ALTER TABLE public.finance_anomalies FORCE ROW LEVEL SECURITY;
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DROP POLICY IF EXISTS finance_anomalies_tenant_isolation ON public.finance_anomalies;

DO $$ BEGIN
  CREATE POLICY finance_anomalies_tenant_isolation ON public.finance_anomalies
    USING (tenant_id = (SELECT budget.current_tenant_id()))
    WITH CHECK (tenant_id = (SELECT budget.current_tenant_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
