-- Purpose: LM-002 — capture leads through PUBLIC, UNAUTHENTICATED web forms with
--          consent, source, campaign and UTM attribution.
--
--          Two additive parts:
--          (a) crm.contacts gains the attribution columns it never had. A "lead" in
--              this service is a crm.contacts row (lead_status + lead_source); there
--              is deliberately no crm.leads table, so attribution belongs here. Zero
--              files in src matched "utm" before this migration — the acceptance
--              criterion "records attribution" was simply unrepresentable.
--          (b) crm.lead_capture_forms — the registry of public form endpoints. It is
--              what makes an unauthenticated write safe: the form key resolves the
--              tenant, and it carries the per-form consent, origin and rate-limit
--              policy so none of those come from the caller.
--
-- Rollback: -- (b) drop the registry
--           DROP TABLE IF EXISTS crm.lead_capture_forms;
--           -- (a) attribution columns; DROP COLUMN needs tech-lead approval per
--           -- steering, so prefer leaving them (they are nullable and inert).
--           DROP INDEX IF EXISTS crm.idx_contacts_tenant_campaign;
--           DROP INDEX IF EXISTS crm.idx_contacts_tenant_utm_campaign;
--           ALTER TABLE crm.contacts
--             DROP COLUMN IF EXISTS utm_source, DROP COLUMN IF EXISTS utm_medium,
--             DROP COLUMN IF EXISTS utm_campaign, DROP COLUMN IF EXISTS utm_term,
--             DROP COLUMN IF EXISTS utm_content, DROP COLUMN IF EXISTS campaign_id,
--             DROP COLUMN IF EXISTS capture_form_id;
--
-- Affected services: crm-service (owner). No other service reads these columns; the
--          crm.lead.captured / crm.lead.public_captured events carry attribution
--          identifiers only and never the submitted PII, so analytics-service and
--          ml-service can consume them without a schema change here.
--
-- Sequencing: additive and idempotent, safe to apply BEFORE the code that uses it.
--          Every new contacts column is NULLABLE with no default — an existing row is
--          untouched and no table rewrite happens. No backfill: a lead captured before
--          LM-002 has no attribution to recover, and inventing one ('unknown') would
--          corrupt campaign ROI reporting. The registry starts empty, which means the
--          public endpoint 404s for every key until a tenant admin creates a form —
--          i.e. the unauthenticated surface is closed by default.

SET lock_timeout = '5s';

-- ─────────────────────────────────────────────────────────────────────────────
-- (a) Attribution on crm.contacts
-- ─────────────────────────────────────────────────────────────────────────────
-- All five UTM parameters are stored verbatim as varchar(128) rather than parsed
-- or normalised: they are opaque marketing identifiers whose meaning is owned by
-- the tenant's ad platform, and the length cap is what keeps an unauthenticated
-- caller from using them as free storage. campaign_id / capture_form_id are plain
-- uuid with NO foreign key on purpose — a campaign lives in crm.campaign_* which a
-- tenant may prune for retention, and an FK would then either block the prune or
-- cascade away the lead's attribution.
ALTER TABLE crm.contacts ADD COLUMN IF NOT EXISTS utm_source      varchar(128);
ALTER TABLE crm.contacts ADD COLUMN IF NOT EXISTS utm_medium      varchar(128);
ALTER TABLE crm.contacts ADD COLUMN IF NOT EXISTS utm_campaign    varchar(128);
ALTER TABLE crm.contacts ADD COLUMN IF NOT EXISTS utm_term        varchar(128);
ALTER TABLE crm.contacts ADD COLUMN IF NOT EXISTS utm_content     varchar(128);
ALTER TABLE crm.contacts ADD COLUMN IF NOT EXISTS campaign_id     uuid;
ALTER TABLE crm.contacts ADD COLUMN IF NOT EXISTS capture_form_id uuid;

-- Attribution's only real query shape is "every lead this campaign produced", which
-- is per tenant. CONCURRENTLY because crm.contacts is a live, large table.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contacts_tenant_campaign
  ON crm.contacts (tenant_id, campaign_id)
  WHERE campaign_id IS NOT NULL;

-- Separate index on the STRING campaign: most inbound traffic carries only
-- utm_campaign (the ad platform's name for it) and never resolves to a
-- campaign_id row, so reporting has to be able to group by the raw value too.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contacts_tenant_utm_campaign
  ON crm.contacts (tenant_id, utm_campaign)
  WHERE utm_campaign IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- (b) crm.lead_capture_forms — the public endpoint registry
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crm.lead_capture_forms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  -- The bearer-token-shaped secret in the URL. Server-generated high-entropy hex
  -- (see capture-forms-commands.ts); a client may never choose it, because a
  -- guessable or sequential key would let anyone enumerate every tenant's forms
  -- and post leads into them.
  form_key varchar(64) NOT NULL,
  name varchar(200) NOT NULL,
  -- Kill switch. A disabled form answers 404, identical to a key that never
  -- existed, so switching a form off does not confirm to a spammer that it once
  -- worked.
  enabled boolean NOT NULL DEFAULT true,
  -- DPDP Act 2023: consent must be explicit and demonstrable. Defaults to TRUE so
  -- a form created without thinking about consent is the SAFE one, not the leaky
  -- one. A tenant that opts out is making an auditable choice.
  require_consent boolean NOT NULL DEFAULT true,
  -- Browser Origin allowlist, empty = accept any origin (a server-side form post
  -- carries no Origin header at all, so an allowlist cannot be mandatory).
  allowed_origins jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Fallback for lead_source when the submission does not declare one.
  default_lead_source varchar(64),
  campaign_id uuid,
  -- Per-form abuse budget, enforced per (form, client IP) in a 60s fixed window.
  -- Bounded 1..600 so a form cannot be configured into an unlimited open relay,
  -- and cannot be configured to zero either (which would silently 429 every
  -- genuine prospect while looking like a working form).
  max_per_minute integer NOT NULL DEFAULT 10 CHECK (max_per_minute BETWEEN 1 AND 600),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  version integer NOT NULL DEFAULT 1
);

-- GLOBALLY unique, not per tenant. The key is the ONLY thing an anonymous caller
-- presents, so it is what resolves the tenant: if two tenants could share a key the
-- resolution would be ambiguous and a submission could land in the wrong tenant.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_lead_capture_forms_form_key
  ON crm.lead_capture_forms (form_key);

-- Admin list route reads "this tenant's forms".
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lead_capture_forms_tenant
  ON crm.lead_capture_forms (tenant_id);

ALTER TABLE crm.lead_capture_forms ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.lead_capture_forms FORCE ROW LEVEL SECURITY;

-- `CREATE POLICY IF NOT EXISTS` is not valid PostgreSQL, hence the pg_policies guard.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'lead_capture_forms_tenant_isolation'
      AND schemaname = 'crm' AND tablename = 'lead_capture_forms'
  ) THEN
    -- FOR ALL: reads AND writes are confined to the GUC's tenant. crm.current_tenant_id()
    -- returns NULL when app.tenant_id is unset, and `tenant_id = NULL` is NULL (not true),
    -- so this policy admits nothing at all on an unscoped connection.
    CREATE POLICY lead_capture_forms_tenant_isolation ON crm.lead_capture_forms
      USING (tenant_id = crm.current_tenant_id())
      WITH CHECK (tenant_id = crm.current_tenant_id());
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'lead_capture_forms_anon_key_lookup'
      AND schemaname = 'crm' AND tablename = 'lead_capture_forms'
  ) THEN
    -- ── Deliberate, narrow RLS exception. Read this before changing it. ──
    -- The public capture route has no tenant when the request arrives: the form key
    -- IS the tenant resolver. So the resolving SELECT necessarily runs on a
    -- connection with no app.tenant_id, where the isolation policy above admits zero
    -- rows. Without this policy the endpoint would 404 every single valid key.
    --
    -- Why this is acceptable:
    --   * FOR SELECT only — an unscoped connection still cannot INSERT, UPDATE or
    --     DELETE a form (the isolation policy's WITH CHECK is the only write gate).
    --   * The table holds NO PII and no customer data: a form name, a key, and
    --     policy flags.
    --   * The only caller is publicCaptureRepo.findByFormKey(), which filters on an
    --     equality match against a 48-hex-char server-generated key, so "all rows are
    --     visible" is worthless without already knowing a key.
    --   * The tenant_id it yields is then used to scope everything downstream — the
    --     command envelope and the consumer's write both run tenant-scoped.
    -- Anything that needs to read this table WITH a tenant in hand must keep using a
    -- tenant-scoped transaction so the isolation policy applies.
    CREATE POLICY lead_capture_forms_anon_key_lookup ON crm.lead_capture_forms
      FOR SELECT
      USING (crm.current_tenant_id() IS NULL);
  END IF;
END $$;

DO $g$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_svc') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON crm.lead_capture_forms TO crm_svc;
  END IF;
END $g$;
