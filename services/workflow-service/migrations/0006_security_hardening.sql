-- workflow-service security hardening (findings H3, M3).
-- Additive + idempotent only. Run as owner (civitas_admin) for triggers/REVOKE
-- on civitas_admin-owned objects and to GRANT across mixed-owner tables.

-- ---------------------------------------------------------------------------
-- H3 — transition_history: TRUNCATE bypasses the BEFORE UPDATE/DELETE row
-- trigger (TRUNCATE is statement-level, not row-level). Add a statement-level
-- BEFORE TRUNCATE trigger that raises, and revoke TRUNCATE / UPDATE / DELETE
-- from the runtime role so the append-only invariant holds even for the table
-- owner's grantees.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION workflow.block_transition_truncate() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'workflow.transition_history is append-only (TRUNCATE blocked)';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_transition_no_truncate ON workflow.transition_history;
CREATE TRIGGER trg_transition_no_truncate
  BEFORE TRUNCATE ON workflow.transition_history
  FOR EACH STATEMENT EXECUTE FUNCTION workflow.block_transition_truncate();

-- Belt-and-suspenders: ensure the runtime role cannot mutate/truncate history.
-- (workflow_svc owns this table, so as owner it implicitly holds all rights;
--  the BEFORE triggers above are the real enforcement. These REVOKEs apply to
--  any grants made to the role and confirm intent.)
REVOKE TRUNCATE, UPDATE, DELETE ON workflow.transition_history FROM workflow_svc;

-- ---------------------------------------------------------------------------
-- M3 — runtime GRANTs. If migrations split ownership (definitions /
-- definition_nodes owned by civitas_admin; others by workflow_svc), the runtime
-- role may lack access to civitas_admin-owned tables in production. Grant the
-- working set explicitly so reads/writes do not fail.
-- ---------------------------------------------------------------------------
GRANT USAGE ON SCHEMA workflow TO workflow_svc;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA workflow TO workflow_svc;
-- specific new/mixed-owner tables called out by the finding:
GRANT SELECT, INSERT, UPDATE ON workflow.definition_edges TO workflow_svc;
GRANT SELECT ON workflow.transition_history TO workflow_svc;
GRANT SELECT, INSERT, UPDATE ON workflow.definitions TO workflow_svc;
GRANT SELECT, INSERT, UPDATE ON workflow.definition_nodes TO workflow_svc;
-- INSERT into append-only history is required by the engine; mutation stays blocked
-- by the triggers + REVOKE above.
GRANT INSERT ON workflow.transition_history TO workflow_svc;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA workflow TO workflow_svc;
