-- Phase 3 wiring — persistence for the FN modules landed in #561.
--
-- Those modules are pure domain with publish gates but nothing stored their
-- config, so none of Phase 3 was reachable. This adds one column per concept,
-- following the established pattern on this table (engine_bindings,
-- lane_bindings, profile_attribute_bindings — see 0025/0026).
--
-- FN-16, FN-31 and FN-32 need no column: reports, KPI tiles and the
-- accessibility preview are all DERIVED from blocks the definition already
-- carries. Storing them would let a stored copy drift from the form it
-- describes.
--
-- Rollback:
--   ALTER TABLE catalogue.service_definitions
--     DROP COLUMN IF EXISTS office_overrides,
--     DROP COLUMN IF EXISTS webhook_subscriptions,
--     DROP COLUMN IF EXISTS appeal_linkage,
--     DROP COLUMN IF EXISTS rti_linkage,
--     DROP COLUMN IF EXISTS renewal_policy,
--     DROP COLUMN IF EXISTS locales;
-- Affected services: citizen-service

SET lock_timeout = '5s';

ALTER TABLE catalogue.service_definitions
  -- List-shaped config: empty list is a meaningful "none configured", so these
  -- are NOT NULL with a default rather than nullable.
  ADD COLUMN IF NOT EXISTS office_overrides      jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS webhook_subscriptions jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS locales               jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Object-shaped config: NULL means "not configured", which is distinct from a
  -- configured-but-disabled object ({appealable:false}). The publish gates rely
  -- on that distinction, so these stay nullable.
  ADD COLUMN IF NOT EXISTS appeal_linkage        jsonb,
  ADD COLUMN IF NOT EXISTS rti_linkage           jsonb,
  ADD COLUMN IF NOT EXISTS renewal_policy        jsonb;

COMMENT ON COLUMN catalogue.service_definitions.office_overrides IS
  'FN-22: per-offering-office fee/SLA/extra-document variants [{officeId,feeFromMinor,slaDays,additionalDocuments,...}]. Form, workflow, pattern and HOA are never overridable.';
COMMENT ON COLUMN catalogue.service_definitions.webhook_subscriptions IS
  'FN-30: outbound state-change subscriptions [{id,url,events,secret,active}]. Events are drawn from APPLICATION_STATUSES.';
COMMENT ON COLUMN catalogue.service_definitions.locales IS
  'FN-18/FN-32: locales this service publishes content in, e.g. ["en","or"]. Fewer than two raises the GIGW bilingual warning.';
COMMENT ON COLUMN catalogue.service_definitions.appeal_linkage IS
  'FN-27: {appealable,filingWindowDays,appellateDesignationId,statutoryReference}. NULL = never configured.';
COMMENT ON COLUMN catalogue.service_definitions.rti_linkage IS
  'FN-28: {published,pioDesignationId,pioDesignationLabel}. NULL = never configured.';
COMMENT ON COLUMN catalogue.service_definitions.renewal_policy IS
  'FN-15: {renewable,renewalWindowDays,validityMode,validityYears,validityFixedDate}. NULL = never configured.';
