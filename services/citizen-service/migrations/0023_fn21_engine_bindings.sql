-- citizen-service migration 0023 — FN-21 Engine Binding Configuration.
-- Additive only. Idempotent for migrate-all.mjs.

SET lock_timeout = '5s';

-- Studio-editable engine bindings on the service definition (fee/assessment/…).
-- Packs already store engine_bindings; catalogue is the authoring source of truth
-- for drafts and sandbox (FN-10) honesty checks.
ALTER TABLE catalogue.service_definitions
  ADD COLUMN IF NOT EXISTS engine_bindings jsonb NOT NULL DEFAULT '[]'::jsonb;
