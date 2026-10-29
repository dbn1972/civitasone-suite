-- 0057_custom_domains_domain_ci_unique.sql — FQ12-SEC: one tenant per host,
-- case-insensitively.
--
-- WHY: uq_custom_domains_domain (0004b) is UNIQUE(domain) on the raw value,
-- and the register validator accepted mixed case, so tenant A's
-- "victim.example.test" and tenant B's "VICTIM.EXAMPLE.TEST" (or
-- "victim.example.test.") were both accepted and could both reach `verified`
-- through the shared CNAME challenge target (security review of PR #2372).
-- The service now normalises domains (trim, lower-case, strip root dot) at
-- the API boundary and in the register consumer; this index enforces the
-- same rule in the database for every writer.
--
-- Guarded and idempotent:
--   - CREATE UNIQUE INDEX IF NOT EXISTS on the canonical expression.
--   - If existing rows already collide case-insensitively the index cannot be
--     built. That is reported with RAISE NOTICE (listing only counts) and the
--     index is skipped, never failing the migration run; resolve the
--     duplicates and re-run. (UAT read-only check 2026-10-29: 12 rows, all
--     lower-case, 0 collisions.)
-- The index is global (not tenant-scoped) on purpose and is not affected by
-- RLS: uniqueness is enforced across all tenants.

SET lock_timeout = '5s';

DO $body$
DECLARE
  dup_groups integer;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'custom_domains' AND indexname = 'uq_custom_domains_domain_ci'
  ) THEN
    RETURN;
  END IF;

  -- Counted with FORCE RLS lifted for this block only (the migration role
  -- owns the table; no tenant GUC is set while migrating), then restored.
  ALTER TABLE custom_domains.custom_domains NO FORCE ROW LEVEL SECURITY;
  SELECT count(*) INTO dup_groups FROM (
    SELECT 1 FROM custom_domains.custom_domains
     GROUP BY lower(rtrim(domain, '.'))
    HAVING count(*) > 1
  ) d;
  ALTER TABLE custom_domains.custom_domains FORCE ROW LEVEL SECURITY;

  IF dup_groups > 0 THEN
    RAISE NOTICE 'custom_domains: % case-insensitive duplicate domain group(s) exist; uq_custom_domains_domain_ci NOT created. Resolve the duplicates, then re-run this migration.', dup_groups;
    RETURN;
  END IF;

  CREATE UNIQUE INDEX uq_custom_domains_domain_ci
    ON custom_domains.custom_domains ((lower(rtrim(domain, '.'))));
END
$body$;
