-- Migration 0068: payments.finance_pao audit/version columns
--
-- BUG FIX (schema drift): src/modules/masters/schema.ts's financePao
-- declares version/createdBy/updatedBy, and its sibling table finance_ddo
-- already has all three (added retroactively by
-- 0043_schema_drift_fixups.sql, part (d)) — but finance_pao itself was never
-- given the same treatment, so the actual DB table is missing all three
-- columns the drizzle schema and (per finance_ddo's precedent) the
-- established masters-table shape both expect. Currently dormant: no PAO
-- write path exists yet (only listPao/paoExists reads), so nothing has hit
-- "column does not exist" — but it would the moment one does, exactly as
-- 0043 documented for finance_ddo at the time.
--
-- Same idiom as 0043(d): additive, idempotent, forward-only, with the same
-- sentinel created_by/updated_by default (existing rows predate any real
-- actor id being available to backfill).

ALTER TABLE payments.finance_pao
  ADD COLUMN IF NOT EXISTS version    integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS created_by uuid    NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
  ADD COLUMN IF NOT EXISTS updated_by uuid    NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000';
