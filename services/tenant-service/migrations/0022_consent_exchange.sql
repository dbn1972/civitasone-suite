-- Migration: 0022_consent_exchange.sql
-- Purpose: SVC-150 — consent-based inter-department data exchange hub.
--          A DEPA / account-aggregator-style consent broker: a requesting
--          department asks for consented data about a data-principal (citizen)
--          held by a providing department, bounded by purpose, data-categories,
--          a validity window and a frequency (one-time/recurring). Every
--          request/grant/deny/fetch/revoke is written to an append-only access
--          ledger (DPDP s.11 data-principal transparency). Providing depts
--          register the principal data they hold so a consented fetch returns
--          only the in-scope categories.
-- All tenant-scoped with FORCED RLS. Additive + idempotent.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION tenant.current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

-- ── consent artefacts (the consent lifecycle) ─────────────────────────
CREATE TABLE IF NOT EXISTS tenant.consent_artefacts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL,
  principal_id      uuid NOT NULL,
  requesting_dept   varchar(160) NOT NULL,
  providing_dept    varchar(160) NOT NULL,
  purpose_key       varchar(120) NOT NULL,
  data_categories   jsonb NOT NULL DEFAULT '[]'::jsonb,
  valid_from        timestamptz NOT NULL,
  valid_to          timestamptz NOT NULL,
  frequency         varchar(16) NOT NULL DEFAULT 'one-time'
                      CHECK (frequency IN ('one-time','recurring')),
  status            varchar(16) NOT NULL DEFAULT 'requested'
                      CHECK (status IN ('requested','granted','active','denied','revoked','expired')),
  fetch_count       integer NOT NULL DEFAULT 0,
  reason            text,
  requested_at      timestamptz NOT NULL DEFAULT now(),
  decided_at        timestamptz,
  decided_by        uuid,
  revoked_at        timestamptz,
  revoked_by        uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL,
  CONSTRAINT chk_consent_window CHECK (valid_to > valid_from)
);
CREATE INDEX IF NOT EXISTS idx_consent_artefacts_tenant ON tenant.consent_artefacts (tenant_id);
CREATE INDEX IF NOT EXISTS idx_consent_artefacts_principal ON tenant.consent_artefacts (tenant_id, principal_id);
CREATE INDEX IF NOT EXISTS idx_consent_artefacts_status ON tenant.consent_artefacts (tenant_id, status);

-- ── data holdings (providing dept's data about a principal, per category) ──
CREATE TABLE IF NOT EXISTS tenant.consent_holdings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  principal_id    uuid NOT NULL,
  providing_dept  varchar(160) NOT NULL,
  category        varchar(120) NOT NULL,
  value           jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_consent_holdings
  ON tenant.consent_holdings (tenant_id, principal_id, providing_dept, category);
CREATE INDEX IF NOT EXISTS idx_consent_holdings_lookup
  ON tenant.consent_holdings (tenant_id, principal_id, providing_dept);

-- ── access ledger (append-only, DPDP s.11 transparency) ───────────────
CREATE TABLE IF NOT EXISTS tenant.consent_ledger (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  artefact_id     uuid NOT NULL,
  principal_id    uuid NOT NULL,
  event_type      varchar(24) NOT NULL
                    CHECK (event_type IN ('request','grant','deny','fetch','revoke')),
  outcome         varchar(16) NOT NULL DEFAULT 'recorded'
                    CHECK (outcome IN ('recorded','allowed','denied')),
  requesting_dept varchar(160),
  purpose_key     varchar(120),
  categories      jsonb NOT NULL DEFAULT '[]'::jsonb,
  reason          text,
  actor_id        uuid NOT NULL,
  correlation_id  varchar(120),
  at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_consent_ledger_principal
  ON tenant.consent_ledger (tenant_id, principal_id, at);
CREATE INDEX IF NOT EXISTS idx_consent_ledger_artefact
  ON tenant.consent_ledger (tenant_id, artefact_id, at);

-- The ledger is immutable: forbid UPDATE/DELETE at the table level so the
-- transparency record cannot be rewritten after the fact.
CREATE OR REPLACE FUNCTION tenant.consent_ledger_append_only()
  RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'consent_ledger is append-only: % is not permitted', TG_OP
    USING ERRCODE = 'restrict_violation';
END $$;
DROP TRIGGER IF EXISTS trg_consent_ledger_append_only ON tenant.consent_ledger;
CREATE TRIGGER trg_consent_ledger_append_only
  BEFORE UPDATE OR DELETE ON tenant.consent_ledger
  FOR EACH ROW EXECUTE FUNCTION tenant.consent_ledger_append_only();

-- ── RLS ───────────────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['consent_artefacts','consent_holdings','consent_ledger'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_policy ON tenant.%I', t);
    EXECUTE format('CREATE POLICY tenant_isolation_policy ON tenant.%I USING (tenant_id = tenant.current_tenant_id()) WITH CHECK (tenant_id = tenant.current_tenant_id())', t);
  END LOOP;
END $$;
