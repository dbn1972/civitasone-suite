-- 0185_finance_grant_posting_voids.sql
-- Section 8 NF-3 follow-up (B1 part b): the finance.gl.rejected reconciler for grant postings. ADDITIVE and idempotent: one NEW table
-- and nothing else (no existing table is altered, so there is no lock on gl.grants / gl.grant_postings beyond the FK check).
-- Dormant until a tenant has fund_accounting ON and a grant journal is refused by the GL consumer: a govt tenant never has a
-- gl.grant_postings row, so it never gets a void row and its ledger is byte-identical.
--
-- gl.grant_posting_voids  one row per grant posting whose journal the GL consumer REFUSED (finance.gl.rejected). gl.grant_postings is
--   append-only, so a refused posting is not deleted or edited: it is VOIDED by this row, and every read of the running totals
--   (headroom, UC totals, fund statements) excludes a voided posting. The reconciler also reverts the utilisation snapshot and the
--   grant status (active -> sanctioned if nothing live remains) in the same transaction.
--   Idempotency key: UNIQUE (tenant_id, journal_id) -- the rejected journal id IS the posting's journal id (deterministic from the
--   posting id), so a re-delivered or re-emitted rejection can never write a second void.
-- Append-only (trigger + no UPDATE/DELETE grant). RLS ENABLE + FORCE, standard tenant policy.
-- DEPLOY ORDER: grantTotalsTx reads this table on every grant op, so apply this BEFORE rolling the finance-service image.
-- Rollback (only while empty): DROP TABLE gl.grant_posting_voids; DROP FUNCTION gl.block_grant_void_mutation();
SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS gl.grant_posting_voids (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  grant_id         uuid        NOT NULL,
  grant_posting_id uuid        NOT NULL,
  journal_id       uuid        NOT NULL,
  kind             text        NOT NULL,
  amount_minor     bigint      NOT NULL,
  reject_code      text        NOT NULL,
  reject_reason    text,
  -- true when voiding leaves the grant's remaining live postings inconsistent (e.g. a recognition that leaned on the voided receipt)
  needs_review     boolean     NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT grant_posting_voids_kind_check   CHECK (kind IN ('receipt', 'recognition', 'capitalisation', 'release')),
  CONSTRAINT grant_posting_voids_amount_check CHECK (amount_minor > 0),
  CONSTRAINT grant_posting_voids_journal_key  UNIQUE (tenant_id, journal_id),
  CONSTRAINT grant_posting_voids_posting_key  UNIQUE (tenant_id, grant_posting_id),
  -- composite tenant-scoped FKs: a bare REFERENCES would bypass RLS and could point at another tenant's row
  CONSTRAINT grant_posting_voids_posting_fk FOREIGN KEY (tenant_id, journal_id) REFERENCES gl.grant_postings (tenant_id, journal_id),
  CONSTRAINT grant_posting_voids_grant_fk   FOREIGN KEY (tenant_id, grant_id)   REFERENCES gl.grants (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS idx_grant_posting_voids_grant ON gl.grant_posting_voids (tenant_id, grant_id);

ALTER TABLE gl.grant_posting_voids ENABLE ROW LEVEL SECURITY;
ALTER TABLE gl.grant_posting_voids FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON gl.grant_posting_voids;
CREATE POLICY tenant_isolation_policy ON gl.grant_posting_voids
  USING (tenant_id = budget.current_tenant_id()) WITH CHECK (tenant_id = budget.current_tenant_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'finance_svc') THEN
    GRANT USAGE ON SCHEMA gl TO finance_svc;
    GRANT SELECT, INSERT ON gl.grant_posting_voids TO finance_svc;   -- append-only: no UPDATE / DELETE
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION gl.block_grant_void_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'GRANT_VOID_IMMUTABLE: gl.grant_posting_voids is append-only' USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_grant_posting_voids_no_mutate ON gl.grant_posting_voids;
CREATE TRIGGER trg_grant_posting_voids_no_mutate BEFORE UPDATE OR DELETE ON gl.grant_posting_voids
  FOR EACH ROW EXECUTE FUNCTION gl.block_grant_void_mutation();
