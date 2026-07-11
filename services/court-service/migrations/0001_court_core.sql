-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration: 0001_court_core.sql
-- Service:   court-service (gateway /api/v1/courts) — DB civitas_court
--
-- Purpose:
--   Initial schema for the court-service. Creates the `court` PostgreSQL schema
--   with all 10 domain tables (courts, benches, cases, case parties, case state
--   transitions, cause lists, cause-list items, hearings, orders, filings), plus
--   the transactional outbox (`_outbox.messages`) and consumer-idempotency inbox
--   (`_inbox.processed`). Enables (and FORCEs) row-level security with per-tenant
--   isolation policies on every tenant-scoped table, creates all read-path indexes,
--   and adds a btree_gist exclusion constraint preventing a courtroom from being
--   double-booked in the same (tenant, list_date, slot).
--
--   This migration is ADDITIVE and IDEMPOTENT: every object is created with
--   IF NOT EXISTS (tables, schemas, indexes) or guarded (policies via DROP-then-CREATE,
--   the exclusion constraint via a pg_constraint existence check), so it can be
--   re-applied safely.
--
-- PII at rest (DPDP Act 2023):
--   court.case_parties.name_enc / address_enc / phone_enc / email_enc hold
--   AES-256-GCM ciphertext produced by the app-layer encryptedText() Drizzle type
--   (src/shared/pii-crypto.ts) — stored as TEXT, never cleartext.
--
-- Money:
--   All monetary amounts are BIGINT paise (minor units, `_minor` suffix). No floats.
--
-- Row-level security (RLS) — the CORRECT form:
--   Every tenant-scoped table has BOTH `ENABLE` AND `FORCE` ROW LEVEL SECURITY, so
--   even the table-owner role is subject to the policy (ENABLE alone lets the owner
--   bypass RLS). The tenant_isolation policy uses the missing-ok GUC form
--   `NULLIF(current_setting('app.tenant_id', true), '')::uuid` so an UNSET GUC yields
--   NULL (rows invisible — fail-closed) instead of raising, avoiding latent outages.
--
-- Outbox/inbox alignment:
--   `_outbox.messages` and `_inbox.processed` intentionally match the schema defined
--   by the shared @civitasone/outbox package and the sibling services' 0001
--   migrations. The relay scans across tenants, so these tables are intentionally
--   NOT tenant-scoped and have NO row-level security.
--
-- Rollback (DESTRUCTIVE — requires tech-lead / DBA written approval per Migration
--           Safety Rules; no automatic down-migration is provided):
--   DROP SCHEMA IF EXISTS court CASCADE;
--   DROP TABLE IF EXISTS _outbox.messages;
--   DROP TABLE IF EXISTS _inbox.processed;
--   -- (Leave the _outbox/_inbox schemas in place; they are shared infra.)
--
-- Affected services: court-service only (own database, no cross-service tables).
-- ═══════════════════════════════════════════════════════════════════════════════

-- Guard against long lock waits blocking production queries during any ALTER TABLE.
SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS court;
CREATE SCHEMA IF NOT EXISTS _outbox;
CREATE SCHEMA IF NOT EXISTS _inbox;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ═══════════════════════════════════════════════════════════════════════════════
-- TABLES (court schema)
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── Court registry ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS court.courts (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL,
    name                TEXT NOT NULL,
    court_type          VARCHAR(32) NOT NULL,
    jurisdiction        TEXT,
    establishment_code  VARCHAR(64),
    parent_court_id     UUID REFERENCES court.courts(id),
    address             TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by          UUID,
    updated_by          UUID,
    version             INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS court.benches (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id          UUID NOT NULL,
    court_id           UUID NOT NULL REFERENCES court.courts(id),
    name               TEXT NOT NULL,
    presiding_judge_id UUID,
    bench_type         VARCHAR(32),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by         UUID,
    updated_by         UUID,
    version            INTEGER NOT NULL DEFAULT 1
);

-- ── Case registry ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS court.cases (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID NOT NULL,
    cnr_number     VARCHAR(64) NOT NULL,
    case_type      VARCHAR(32),
    filing_number  VARCHAR(64),
    filing_date    DATE,
    title          TEXT,
    status         VARCHAR(32) NOT NULL DEFAULT 'filed',
    stage          VARCHAR(32),
    court_id       UUID REFERENCES court.courts(id),
    bench_id       UUID REFERENCES court.benches(id),
    disposal_date  DATE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by     UUID,
    updated_by     UUID,
    version        INTEGER NOT NULL DEFAULT 1
);

-- case_parties.name_enc / address_enc / phone_enc / email_enc hold AES-256-GCM
-- ciphertext produced by the app-layer encryptedText() Drizzle type — TEXT at rest.
CREATE TABLE IF NOT EXISTS court.case_parties (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL,
    case_id         UUID NOT NULL REFERENCES court.cases(id),
    party_role      VARCHAR(32) NOT NULL,
    name_enc        TEXT,
    address_enc     TEXT,
    phone_enc       TEXT,
    email_enc       TEXT,
    advocate_name   TEXT,
    advocate_bar_id VARCHAR(64),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by      UUID,
    updated_by      UUID,
    version         INTEGER NOT NULL DEFAULT 1
);

-- Append-only audit log: no updated_*/version columns.
CREATE TABLE IF NOT EXISTS court.case_state_transitions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL,
    case_id     UUID NOT NULL REFERENCES court.cases(id),
    from_status VARCHAR(32),
    to_status   VARCHAR(32) NOT NULL,
    actor_id    UUID,
    reason      TEXT,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by  UUID
);

-- ── Cause lists ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS court.cause_lists (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  UUID NOT NULL,
    court_id   UUID NOT NULL REFERENCES court.courts(id),
    bench_id   UUID REFERENCES court.benches(id),
    list_date  DATE NOT NULL,
    status     VARCHAR(32) NOT NULL DEFAULT 'draft',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by UUID,
    updated_by UUID,
    version    INTEGER NOT NULL DEFAULT 1
);

-- list_date is denormalized from the parent cause_list so the courtroom
-- double-booking exclusion can span DIFFERENT cause_lists that share a calendar
-- date (e.g. two benches sitting the same day cannot claim the same courtroom+slot).
CREATE TABLE IF NOT EXISTS court.cause_list_items (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID NOT NULL,
    cause_list_id UUID NOT NULL REFERENCES court.cause_lists(id),
    case_id       UUID NOT NULL REFERENCES court.cases(id),
    item_number   INTEGER,
    slot          VARCHAR(32),
    courtroom     VARCHAR(64),
    list_date     DATE NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by    UUID,
    updated_by    UUID,
    version       INTEGER NOT NULL DEFAULT 1
);

-- ── Hearings ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS court.hearings (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id          UUID NOT NULL,
    case_id            UUID NOT NULL REFERENCES court.cases(id),
    bench_id           UUID REFERENCES court.benches(id),
    scheduled_date     TIMESTAMPTZ,
    status             VARCHAR(32) NOT NULL DEFAULT 'scheduled',
    next_date          DATE,
    purpose            VARCHAR(64),
    adjournment_reason TEXT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by         UUID,
    updated_by         UUID,
    version            INTEGER NOT NULL DEFAULT 1
);

-- ── Orders ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS court.orders (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID NOT NULL,
    case_id       UUID NOT NULL REFERENCES court.cases(id),
    hearing_id    UUID REFERENCES court.hearings(id),
    order_type    VARCHAR(32),
    order_text    TEXT,
    signed_by     UUID,
    dsc_signature TEXT,
    order_date    DATE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by    UUID,
    updated_by    UUID,
    version       INTEGER NOT NULL DEFAULT 1
);

-- ── Filings ───────────────────────────────────────────────────────────────────
-- filing_fee_minor / court_fee_minor are BIGINT paise (minor units).

CREATE TABLE IF NOT EXISTS court.filings (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID NOT NULL,
    case_id          UUID NOT NULL REFERENCES court.cases(id),
    filing_type      VARCHAR(32),
    filing_fee_minor BIGINT NOT NULL DEFAULT 0,
    court_fee_minor  BIGINT NOT NULL DEFAULT 0,
    status           VARCHAR(32) NOT NULL DEFAULT 'submitted',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by       UUID,
    updated_by       UUID,
    version          INTEGER NOT NULL DEFAULT 1
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- TRANSACTIONAL OUTBOX + CONSUMER-IDEMPOTENCY INBOX
--   Schema matches @civitasone/outbox and the sibling services' 0001 migrations.
--   The relay scans across tenants, so these tables are intentionally NOT
--   tenant-scoped and have NO row-level security.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS _outbox.messages (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    topic          VARCHAR(128) NOT NULL,
    event_type     VARCHAR(128) NOT NULL,
    tenant_id      UUID NOT NULL,
    actor_id       UUID NOT NULL,
    correlation_id VARCHAR(64) NOT NULL,
    payload        JSONB NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    published_at   TIMESTAMPTZ
);

-- Hot path for the relay: fetch unpublished rows oldest-first.
CREATE INDEX IF NOT EXISTS idx_outbox_unpublished
    ON _outbox.messages(created_at) WHERE published_at IS NULL;

CREATE TABLE IF NOT EXISTS _inbox.processed (
    message_id   UUID PRIMARY KEY,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Supports the scheduled purge of old idempotency records.
CREATE INDEX IF NOT EXISTS idx_inbox_processed_time
    ON _inbox.processed(processed_at);

-- ═══════════════════════════════════════════════════════════════════════════════
-- ROW-LEVEL SECURITY (tenant isolation) — ENABLE + FORCE + policy on every table.
--   FORCE ensures even the table owner is subject to the policy (ENABLE alone lets
--   the owner bypass RLS). The policy uses the missing-ok GUC form so an unset
--   app.tenant_id yields NULL → no rows (fail-closed) instead of raising.
--   USING also governs INSERT/UPDATE WITH CHECK (Postgres reuses the USING
--   expression), so writes cannot cross tenants. Policies are dropped-then-created
--   for idempotent re-runs (CREATE POLICY has no IF NOT EXISTS).
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE court.courts                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE court.courts                  FORCE  ROW LEVEL SECURITY;
ALTER TABLE court.benches                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE court.benches                 FORCE  ROW LEVEL SECURITY;
ALTER TABLE court.cases                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE court.cases                   FORCE  ROW LEVEL SECURITY;
ALTER TABLE court.case_parties            ENABLE ROW LEVEL SECURITY;
ALTER TABLE court.case_parties            FORCE  ROW LEVEL SECURITY;
ALTER TABLE court.case_state_transitions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE court.case_state_transitions  FORCE  ROW LEVEL SECURITY;
ALTER TABLE court.cause_lists             ENABLE ROW LEVEL SECURITY;
ALTER TABLE court.cause_lists             FORCE  ROW LEVEL SECURITY;
ALTER TABLE court.cause_list_items        ENABLE ROW LEVEL SECURITY;
ALTER TABLE court.cause_list_items        FORCE  ROW LEVEL SECURITY;
ALTER TABLE court.hearings                ENABLE ROW LEVEL SECURITY;
ALTER TABLE court.hearings                FORCE  ROW LEVEL SECURITY;
ALTER TABLE court.orders                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE court.orders                  FORCE  ROW LEVEL SECURITY;
ALTER TABLE court.filings                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE court.filings                 FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON court.courts;
CREATE POLICY tenant_isolation ON court.courts
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation ON court.benches;
CREATE POLICY tenant_isolation ON court.benches
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation ON court.cases;
CREATE POLICY tenant_isolation ON court.cases
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation ON court.case_parties;
CREATE POLICY tenant_isolation ON court.case_parties
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation ON court.case_state_transitions;
CREATE POLICY tenant_isolation ON court.case_state_transitions
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation ON court.cause_lists;
CREATE POLICY tenant_isolation ON court.cause_lists
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation ON court.cause_list_items;
CREATE POLICY tenant_isolation ON court.cause_list_items
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation ON court.hearings;
CREATE POLICY tenant_isolation ON court.hearings
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation ON court.orders;
CREATE POLICY tenant_isolation ON court.orders
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation ON court.filings;
CREATE POLICY tenant_isolation ON court.filings
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- ═══════════════════════════════════════════════════════════════════════════════
-- INDEXES
--   Plain CREATE INDEX (not CONCURRENTLY): these tables are brand-new and empty at
--   migration time, so index builds are instant and non-blocking. All IF NOT EXISTS
--   for idempotent re-runs.
-- ═══════════════════════════════════════════════════════════════════════════════

-- Courts
CREATE INDEX IF NOT EXISTS idx_courts_tenant        ON court.courts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_courts_parent        ON court.courts(parent_court_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_courts_estcode ON court.courts(tenant_id, establishment_code)
    WHERE establishment_code IS NOT NULL;

-- Benches
CREATE INDEX IF NOT EXISTS idx_benches_tenant ON court.benches(tenant_id);
CREATE INDEX IF NOT EXISTS idx_benches_court  ON court.benches(court_id);

-- Cases
CREATE INDEX IF NOT EXISTS idx_cases_tenant          ON court.cases(tenant_id);
CREATE INDEX IF NOT EXISTS idx_cases_tenant_status   ON court.cases(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_cases_court           ON court.cases(court_id);
CREATE INDEX IF NOT EXISTS idx_cases_bench           ON court.cases(bench_id);
CREATE INDEX IF NOT EXISTS idx_cases_filing_date     ON court.cases(tenant_id, filing_date);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cases_cnr_unique ON court.cases(tenant_id, cnr_number);

-- Case parties
CREATE INDEX IF NOT EXISTS idx_parties_tenant ON court.case_parties(tenant_id);
CREATE INDEX IF NOT EXISTS idx_parties_case   ON court.case_parties(case_id);

-- Case state transitions
CREATE INDEX IF NOT EXISTS idx_transitions_tenant ON court.case_state_transitions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_transitions_case   ON court.case_state_transitions(case_id);

-- Cause lists
CREATE INDEX IF NOT EXISTS idx_cause_lists_tenant ON court.cause_lists(tenant_id);
CREATE INDEX IF NOT EXISTS idx_cause_lists_court  ON court.cause_lists(court_id);
CREATE INDEX IF NOT EXISTS idx_cause_lists_date   ON court.cause_lists(tenant_id, list_date);

-- Cause list items
CREATE INDEX IF NOT EXISTS idx_cause_items_tenant ON court.cause_list_items(tenant_id);
CREATE INDEX IF NOT EXISTS idx_cause_items_list   ON court.cause_list_items(cause_list_id);
CREATE INDEX IF NOT EXISTS idx_cause_items_case   ON court.cause_list_items(case_id);

-- Hearings
CREATE INDEX IF NOT EXISTS idx_hearings_tenant    ON court.hearings(tenant_id);
CREATE INDEX IF NOT EXISTS idx_hearings_case      ON court.hearings(case_id);
CREATE INDEX IF NOT EXISTS idx_hearings_bench     ON court.hearings(bench_id);
CREATE INDEX IF NOT EXISTS idx_hearings_scheduled ON court.hearings(tenant_id, scheduled_date);
CREATE INDEX IF NOT EXISTS idx_hearings_status    ON court.hearings(tenant_id, status);

-- Orders
CREATE INDEX IF NOT EXISTS idx_orders_tenant  ON court.orders(tenant_id);
CREATE INDEX IF NOT EXISTS idx_orders_case    ON court.orders(case_id);
CREATE INDEX IF NOT EXISTS idx_orders_hearing ON court.orders(hearing_id);

-- Filings
CREATE INDEX IF NOT EXISTS idx_filings_tenant ON court.filings(tenant_id);
CREATE INDEX IF NOT EXISTS idx_filings_case   ON court.filings(case_id);
CREATE INDEX IF NOT EXISTS idx_filings_status ON court.filings(tenant_id, status);

-- ═══════════════════════════════════════════════════════════════════════════════
-- CONSTRAINTS
--   Courtroom double-booking prevention via a btree_gist exclusion constraint: no
--   two cause-list items may share the same (tenant_id, list_date, slot, courtroom)
--   — i.e. the same courtroom cannot be double-booked for the same slot on the same
--   list date, even across different cause_lists. Guarded by a pg_constraint
--   existence check so re-runs are idempotent (ADD CONSTRAINT has no IF NOT EXISTS).
--   Rows without an assigned courtroom are exempt (WHERE courtroom IS NOT NULL).
-- ═══════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'cause_list_items_no_double_booking'
    ) THEN
        ALTER TABLE court.cause_list_items
            ADD CONSTRAINT cause_list_items_no_double_booking
            EXCLUDE USING gist (
                tenant_id WITH =,
                list_date WITH =,
                slot      WITH =,
                courtroom WITH =
            ) WHERE (courtroom IS NOT NULL);
    END IF;
END $$;
