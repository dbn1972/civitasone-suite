-- citizen-service migration 0021 — Sandbox test run history (FN-10).
-- Additive, idempotent.

CREATE TABLE IF NOT EXISTS packs.sandbox_test_runs (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL,
  service_definition_id uuid NOT NULL,
  status                varchar(16) NOT NULL
                          CHECK (status IN ('running','pass','fail')),
  steps                 jsonb NOT NULL DEFAULT '[]'::jsonb,
  duration_ms           integer,
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sandbox_runs_def_created
  ON packs.sandbox_test_runs (tenant_id, service_definition_id, created_at DESC);

ALTER TABLE packs.sandbox_test_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE packs.sandbox_test_runs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON packs.sandbox_test_runs;
CREATE POLICY tenant_isolation ON packs.sandbox_test_runs
  USING (tenant_id = portal.current_tenant_id())
  WITH CHECK (tenant_id = portal.current_tenant_id());

ALTER TABLE packs.sandbox_test_runs OWNER TO citizen_svc;
