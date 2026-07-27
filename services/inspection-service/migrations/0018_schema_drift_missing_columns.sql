-- 0018_schema_drift_missing_columns.sql
--
-- Purpose: add four more columns declared in Drizzle models but never created by
-- any migration. Found by scripts/ci/schema-drift-guard.mjs immediately after it
-- was written to catch the verification_evidence case (0017).
--
-- Each was verified individually against the live database: the table exists, the
-- column does not. So these are omissions, not renames or parser artifacts.
--
--   execution.inspections.report_s3_key         declared in execution/schema.ts
--   execution.inspection_history.created_at     declared in execution/schema.ts
--   findings.compliance_notices.updated_at      declared in findings/schema.ts
--   findings.compliance_notices.updated_by      declared in findings/schema.ts
--
-- Any SELECT built from those models fails at runtime with
-- 'column "x" does not exist' — a 500, not a test failure. All four were latent
-- because inspection-service had never run: it had no role and no database, so
-- no query was ever executed against it.
--
-- Types are matched to the platform convention and to the sibling columns on the
-- same tables:
--   *_s3_key   -> text
--   created_at -> timestamptz NOT NULL DEFAULT now()  (steering: never bare
--                 `timestamp`; safe as NOT NULL here because the default
--                 backfills existing rows in the same statement)
--   updated_at -> timestamptz NOT NULL DEFAULT now()
--   updated_by -> uuid NULL (no safe default for an actor; nullable so existing
--                 rows stay valid, per the no-NOT-NULL-without-backfill rule)
--
-- Rollback:
--   ALTER TABLE execution.inspections        DROP COLUMN IF EXISTS report_s3_key;
--   ALTER TABLE execution.inspection_history DROP COLUMN IF EXISTS created_at;
--   ALTER TABLE findings.compliance_notices  DROP COLUMN IF EXISTS updated_at;
--   ALTER TABLE findings.compliance_notices  DROP COLUMN IF EXISTS updated_by;
--
-- Affected services: inspection-service (execution, findings modules)
-- All additive and idempotent.

SET lock_timeout = '5s';

ALTER TABLE execution.inspections
  ADD COLUMN IF NOT EXISTS report_s3_key text;

ALTER TABLE execution.inspection_history
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE findings.compliance_notices
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE findings.compliance_notices
  ADD COLUMN IF NOT EXISTS updated_by uuid;
