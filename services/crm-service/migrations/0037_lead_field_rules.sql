-- Purpose: Create crm.lead_field_rules — per-tenant configuration of which lead
--          fields are mandatory on manual lead capture, and how much each field
--          contributes to the completeness score (LM-001). Mandatory fields were
--          hardcoded in the contact validator (only `name`) and the completeness
--          weights were a hardcoded const, so a tenant that requires, say, a
--          phone number on every lead had no way to say so and no way to see the
--          gap reflected in its data-quality score.
-- Rollback: DROP TABLE IF EXISTS crm.lead_field_rules;
-- Affected services: crm-service
-- Narrowing (design review): the governable set was originally 9 names and is now 7 —
--          'country' and 'ownerId' were removed. Both are server-defaulted on
--          POST /v1/crm/contacts (ownerId := actor, country := 'IN') and neither is
--          collected by the guided lead form, so allowing a tenant to mark either
--          mandatory produced a permanent 422 on every UI lead creation: the route
--          would reject a lead for omitting a value it was about to fill in itself.
--          Because an earlier revision of this file was already applied to dev
--          databases, the CHECK is dropped and recreated below (and any row naming
--          the two removed fields is deleted first) so re-running this file converges.
-- Sequencing: additive — a new table with no foreign keys into existing tables, so it
--             is safe to apply before the code that reads it. No backfill by design:
--             a tenant with zero rows keeps today's behaviour exactly (only `name`
--             mandatory via the zod schema, and the hardcoded default weights), so
--             the requirement is opt-in per tenant.

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS crm.lead_field_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  -- Constrained to the fields the guided lead form actually collects AND that the
  -- server does not fill in for the caller. A free-text column would let a tenant
  -- mark a non-existent field mandatory and make every lead unsaveable with no way
  -- to discover why. 'country' and 'ownerId' are excluded for the same reason even
  -- though the contact table has them: commands.ts defaults them (country := 'IN',
  -- ownerId := ctx.actorId) and the guided form never asks for them, so a rule on
  -- either would reject every UI lead for a value the route supplies itself.
  -- Custom fields have their own configuration table (crm.custom_fields) and are
  -- deliberately out of scope.
  field_name varchar(64) NOT NULL
    CONSTRAINT lead_field_rules_field_name_check CHECK (field_name IN (
      'name', 'email', 'phone', 'company', 'designation',
      'city', 'leadSource'
    )),
  required boolean NOT NULL DEFAULT false,
  -- Relative contribution to the 0–100 completeness score. Bounded so one field
  -- cannot swamp the score; the sum is NOT constrained to 100 because a tenant may
  -- legitimately configure a partial set, and the scorer normalises. The 0 default
  -- means "unweighted": when a tenant sets no weights at all, its enabled rules are
  -- scored equally, so enforcement and scoring govern the same fields.
  weight integer NOT NULL DEFAULT 0 CHECK (weight BETWEEN 0 AND 100),
  -- Soft switch, so a tenant can suspend a rule during a data-cleanup window
  -- without losing its configured weight.
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  version integer NOT NULL DEFAULT 1
);

-- Narrow the governable set on databases where an earlier revision of this file was
-- already applied: there CREATE TABLE IF NOT EXISTS above is a no-op, so the old
-- 9-value CHECK (including 'country' and 'ownerId') would survive untouched. Drop and
-- recreate it by name, deleting the rows it would no longer admit first — otherwise
-- ADD CONSTRAINT fails validating them. `ADD CONSTRAINT IF NOT EXISTS` is not valid
-- PostgreSQL, hence the pg_constraint guard, which also keeps this a no-op on a fresh
-- database where CREATE TABLE has just installed the same constraint.
SET lock_timeout = '5s';

DELETE FROM crm.lead_field_rules WHERE field_name IN ('country', 'ownerId');

ALTER TABLE crm.lead_field_rules
  DROP CONSTRAINT IF EXISTS lead_field_rules_field_name_check;

DO $c$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'lead_field_rules_field_name_check'
      AND conrelid = 'crm.lead_field_rules'::regclass
  ) THEN
    ALTER TABLE crm.lead_field_rules
      ADD CONSTRAINT lead_field_rules_field_name_check
      CHECK (field_name IN (
        'name', 'email', 'phone', 'company', 'designation',
        'city', 'leadSource'
      ));
  END IF;
END $c$;

-- One rule per field per tenant. This is also what makes the upsert command safe to
-- replay: the consumer writes ON CONFLICT (tenant_id, field_name) DO UPDATE, so a
-- redelivered command converges on the same single row instead of duplicating rules
-- that would then contradict each other during validation.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_lead_field_rules_tenant_field
  ON crm.lead_field_rules(tenant_id, field_name);

ALTER TABLE crm.lead_field_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.lead_field_rules FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'lead_field_rules_tenant_isolation'
      AND schemaname = 'crm' AND tablename = 'lead_field_rules'
  ) THEN
    CREATE POLICY lead_field_rules_tenant_isolation ON crm.lead_field_rules
      USING (tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
END $$;

DO $g$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_svc') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON crm.lead_field_rules TO crm_svc;
  END IF;
END $g$;
