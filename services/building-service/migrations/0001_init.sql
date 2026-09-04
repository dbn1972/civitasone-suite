-- Purpose: Create building-service schema (building.*) and initial tables.
-- Schema: building (single schema for all 5 modules); plus _outbox/_inbox.
-- RLS: FORCE RLS + tenant_id isolation on all building.* domain tables.
-- Generated from src/modules/*/schema.ts — columns verified 1:1 against the
-- current Drizzle definitions there (types, nullability, defaults all match;
-- no drift found against the held ai/feature-municipal-sec5-services branch
-- this was ported from).
--
-- Four fixes applied vs. the held branch's version (verified independently,
-- not ported blind — see PR description for the reasoning on each):
--   1. NO RLS on _outbox.messages. The relay (packages/outbox/src/index.ts
--      relayOnce, invoked from worker.ts's startRelay with the raw `db`
--      handle, no tenant AsyncLocalStorage entry set — worker.ts is not a
--      Fastify request, so createTenantTxHook's onRequest hook never runs
--      for it) would read with app.tenant_id unset. NULLIF(current_setting(
--      'app.tenant_id', true), '')::uuid then evaluates to NULL, and
--      `tenant_id = NULL` is never true under any tenant_isolation policy —
--      the relay's own SELECT would silently return zero rows forever and no
--      building-service event would ever publish. Confirmed no sibling
--      municipal migration applies RLS to _outbox.messages (checked
--      advertisement-service/migrations/0001_initial.sql) — fleet convention
--      is deliberately no RLS there, matched here.
--   2. Added (tenant_id) and (tenant_id, status) indexes on the 5 domain
--      tables, plus FK indexes on building_scrutiny.application_id,
--      building_permits.application_id, building_renewals.permit_id (and
--      building_certificates.permit_id, the same class of FK the task list
--      didn't name but which is the same overlooked-index pattern) —
--      matching advertisement-service/shop-service's indexing convention.
--   3. Added a tenant-scoped uniqueness backstop on building_permits so a
--      duplicate/retried issuePermit command can't double-issue a permit for
--      the same application — services/building-service/src/modules/permits/
--      routes.ts + consumer.ts have no application-layer duplicate-issue
--      guard at all (unlike shop-service, whose consumer catches the 23505
--      this constraint produces — see the note at the bottom of this file).
--      Mirrors shop-service/migrations/0002_permits_application_unique.sql's
--      exact pattern: UNIQUE on (application_id) alone, not a composite with
--      tenant_id — application_id is a FK to a single tenant's application
--      row, so it already implies tenant scope.
--   4. Dropped the held branch's unqualified `SECURITY DEFINER
--      current_tenant_id()` function. No sibling migration uses it — the
--      fleet convention (advertisement-service, shop-service) is an inline
--      `NULLIF(current_setting('app.tenant_id', true), '')::uuid` predicate
--      per policy, guarded by an idempotent DO block checking pg_policies.
--      Matched here instead of introducing a new, unreviewed pattern.
--
-- CREATE INDEX CONCURRENTLY: used for the outbox unpublished index only,
-- matching advertisement-service's convention (works because the CI/dev
-- bootstrap scripts run each migration file via `psql -f` in autocommit
-- mode, not inside an explicit transaction). Plain tables are empty at
-- migration time either way, so this buys nothing here beyond consistency
-- with the sibling migrations.
--
-- Rollback: DROP SCHEMA building CASCADE;

SET lock_timeout = '5s';

-- ===================== SCHEMAS =====================
CREATE SCHEMA IF NOT EXISTS building;
CREATE SCHEMA IF NOT EXISTS _outbox;
CREATE SCHEMA IF NOT EXISTS _inbox;

-- ===================== _outbox / _inbox (CQRS) =====================
CREATE TABLE IF NOT EXISTS _outbox.messages (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  topic          varchar(128) NOT NULL,
  event_type     varchar(128) NOT NULL,
  tenant_id      uuid        NOT NULL,
  actor_id       uuid        NOT NULL,
  correlation_id varchar(64) NOT NULL,
  payload        jsonb       NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  published_at   timestamptz
);

CREATE TABLE IF NOT EXISTS _inbox.processed (
  message_id   uuid PRIMARY KEY,
  processed_at timestamptz NOT NULL DEFAULT now()
);

-- No RLS on _outbox.messages — see fix #1 in the header note above. The
-- table is intentionally left without ENABLE/FORCE ROW LEVEL SECURITY or any
-- tenant_isolation policy so the relay (which runs with no app.tenant_id GUC
-- set) can read every unpublished row across all tenants.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_building_outbox_unpublished
  ON _outbox.messages (created_at)
  WHERE published_at IS NULL;

-- ===================== building.building_applications =====================
CREATE TABLE IF NOT EXISTS building.building_applications (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL,
  application_number    varchar(64) NOT NULL UNIQUE,
  status                varchar(32) NOT NULL DEFAULT 'draft',
  site_address          jsonb NOT NULL,
  plot_area             numeric(12, 2),
  built_up_area         numeric(12, 2),
  proposed_floors       integer,
  fsi_requested         numeric(6, 3),
  far_computed          numeric(6, 3),
  architect_name        varchar(256),
  architect_licence_no  varchar(64),
  structural_engineer   varchar(256),
  documents             jsonb NOT NULL DEFAULT '[]'::jsonb,
  drawings              jsonb NOT NULL DEFAULT '[]'::jsonb,
  fee_minor             bigint,
  fee_currency          varchar(3) NOT NULL DEFAULT 'INR',
  fee_paid              boolean NOT NULL DEFAULT false,
  fee_transaction_id    varchar(128),
  submitted_at          timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid NOT NULL,
  updated_by            uuid NOT NULL,
  version               integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS building_applications_tenant_idx ON building.building_applications (tenant_id);
CREATE INDEX IF NOT EXISTS building_applications_status_idx ON building.building_applications (tenant_id, status);

ALTER TABLE building.building_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE building.building_applications FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'building_applications' AND schemaname = 'building' AND policyname = 'tenant_isolation') THEN
    EXECUTE $pol$
      CREATE POLICY tenant_isolation ON building.building_applications
        USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    $pol$;
  END IF;
END $$;

-- ===================== building.building_scrutiny =====================
CREATE TABLE IF NOT EXISTS building.building_scrutiny (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL,
  application_id      uuid NOT NULL,
  discipline          varchar(32) NOT NULL,
  officer_id          uuid NOT NULL,
  status              varchar(32) NOT NULL DEFAULT 'pending',
  findings            jsonb,
  dcr_results         jsonb,
  deficiency_details  text,
  completed_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid NOT NULL,
  updated_by          uuid NOT NULL,
  version             integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS building_scrutiny_tenant_idx ON building.building_scrutiny (tenant_id);
CREATE INDEX IF NOT EXISTS building_scrutiny_status_idx ON building.building_scrutiny (tenant_id, status);
CREATE INDEX IF NOT EXISTS building_scrutiny_application_idx ON building.building_scrutiny (application_id);

ALTER TABLE building.building_scrutiny ENABLE ROW LEVEL SECURITY;
ALTER TABLE building.building_scrutiny FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'building_scrutiny' AND schemaname = 'building' AND policyname = 'tenant_isolation') THEN
    EXECUTE $pol$
      CREATE POLICY tenant_isolation ON building.building_scrutiny
        USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    $pol$;
  END IF;
END $$;

-- ===================== building.building_permits =====================
CREATE TABLE IF NOT EXISTS building.building_permits (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL,
  application_id        uuid NOT NULL,
  permit_number         varchar(64) NOT NULL UNIQUE,
  status                varchar(32) NOT NULL DEFAULT 'active',
  issued_at             timestamptz,
  valid_until           timestamptz,
  conditions            jsonb,
  suspended_at          timestamptz,
  suspension_reason     text,
  cancelled_at          timestamptz,
  cancellation_reason   text,
  verification_code     varchar(64) NOT NULL UNIQUE,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid NOT NULL,
  updated_by            uuid NOT NULL,
  version               integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS building_permits_tenant_idx ON building.building_permits (tenant_id);
CREATE INDEX IF NOT EXISTS building_permits_status_idx ON building.building_permits (tenant_id, status);
CREATE INDEX IF NOT EXISTS building_permits_application_idx ON building.building_permits (application_id);

-- Tenant-scoped uniqueness backstop (fix #3): at most one permit per
-- application. application_id is a FK into building_applications, whose row
-- already carries a single tenant_id, so a plain unique index on
-- application_id is equivalent to a (tenant_id, application_id) composite —
-- mirrors shop-service/migrations/0002_permits_application_unique.sql
-- exactly. Without this, POST /v1/building/permits (routes.ts ->
-- commands.issuePermit -> permits/consumer.ts's issuePermit handler) has no
-- application-layer duplicate-issue guard at all: two concurrent or retried
-- issue commands for the same application would both insert a permit. This
-- index is the only thing preventing that today.
CREATE UNIQUE INDEX IF NOT EXISTS building_permits_application_id_key
  ON building.building_permits (application_id);

ALTER TABLE building.building_permits ENABLE ROW LEVEL SECURITY;
ALTER TABLE building.building_permits FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'building_permits' AND schemaname = 'building' AND policyname = 'tenant_isolation') THEN
    EXECUTE $pol$
      CREATE POLICY tenant_isolation ON building.building_permits
        USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    $pol$;
  END IF;
END $$;

-- ===================== building.building_certificates =====================
CREATE TABLE IF NOT EXISTS building.building_certificates (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL,
  permit_id           uuid NOT NULL,
  cert_type           varchar(32) NOT NULL,
  status              varchar(32) NOT NULL DEFAULT 'issued',
  issued_at           timestamptz,
  inspection_report   jsonb,
  verification_code   varchar(64) NOT NULL UNIQUE,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid NOT NULL,
  updated_by          uuid NOT NULL,
  version             integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS building_certificates_tenant_idx ON building.building_certificates (tenant_id);
CREATE INDEX IF NOT EXISTS building_certificates_status_idx ON building.building_certificates (tenant_id, status);
CREATE INDEX IF NOT EXISTS building_certificates_permit_idx ON building.building_certificates (permit_id);

ALTER TABLE building.building_certificates ENABLE ROW LEVEL SECURITY;
ALTER TABLE building.building_certificates FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'building_certificates' AND schemaname = 'building' AND policyname = 'tenant_isolation') THEN
    EXECUTE $pol$
      CREATE POLICY tenant_isolation ON building.building_certificates
        USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    $pol$;
  END IF;
END $$;

-- ===================== building.building_renewals =====================
CREATE TABLE IF NOT EXISTS building.building_renewals (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               uuid NOT NULL,
  permit_id               uuid NOT NULL,
  renewal_type            varchar(32) NOT NULL,
  status                  varchar(32) NOT NULL DEFAULT 'submitted',
  details                 jsonb,
  fee_minor               bigint,
  fee_currency            varchar(3) NOT NULL DEFAULT 'INR',
  previous_valid_until    timestamptz,
  new_valid_until         timestamptz,
  decided_by              uuid,
  decided_at              timestamptz,
  decision_reason         text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  created_by              uuid NOT NULL,
  updated_by              uuid NOT NULL,
  version                 integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS building_renewals_tenant_idx ON building.building_renewals (tenant_id);
CREATE INDEX IF NOT EXISTS building_renewals_status_idx ON building.building_renewals (tenant_id, status);
CREATE INDEX IF NOT EXISTS building_renewals_permit_idx ON building.building_renewals (permit_id);

ALTER TABLE building.building_renewals ENABLE ROW LEVEL SECURITY;
ALTER TABLE building.building_renewals FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'building_renewals' AND schemaname = 'building' AND policyname = 'tenant_isolation') THEN
    EXECUTE $pol$
      CREATE POLICY tenant_isolation ON building.building_renewals
        USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    $pol$;
  END IF;
END $$;

-- ===================== Grants =====================
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'building_svc') THEN
    GRANT USAGE ON SCHEMA _outbox TO building_svc;
    GRANT USAGE ON SCHEMA _inbox TO building_svc;
    GRANT SELECT, INSERT, UPDATE ON _outbox.messages TO building_svc;
    GRANT SELECT, INSERT ON _inbox.processed TO building_svc;
    GRANT USAGE ON SCHEMA building TO building_svc;
    GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA building TO building_svc;
  END IF;
END $$;
