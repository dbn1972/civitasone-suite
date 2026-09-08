# TX-012 — Test-role RLS posture: findings

**Gap:** `docs/ENTERPRISE-GAP-REPORT-2026-09-07.md` §4, row TX-012 — "Unknown whether test
suites run with a BYPASSRLS role (would explain TX-002/003 passing)."

**Verdict: GOOD CASE.** Test/CI service roles are correctly `NOBYPASSRLS`, and FORCE ROW
LEVEL SECURITY genuinely binds them. TX-002 and TX-003's bugs are real and would be caught
by a real regression test today — the reason they currently pass is that no such regression
test has been written yet, not that the test environment is silently letting them through.

## Method

1. Started a fresh, isolated `postgres:16-alpine` container (not the shared dev/CI Postgres
   already running on the host at :5435 — this one runs on a throwaway port and is destroyed
   at the end of this investigation).
2. Bootstrapped it exactly the way CI/local dev does: `scripts/ci/bootstrap-postgres.sh`
   against that container, with no modifications. It completed with `RATCHET HOLDING` — the
   same 6 pre-existing allow-listed migration failures as any fresh bootstrap, no new ones.
3. Read `packages/db/src/tenant-scope.ts` (states the NOBYPASSRLS precondition) and
   `scripts/ci/bootstrap-postgres.sh` in full (greps for `CREATE ROLE`/`ALTER ROLE`/
   `BYPASSRLS`/`NOBYPASSRLS` across `infra/db/bootstrap/*.sql` and the script itself).
4. Queried the actual bootstrapped roles directly:

   ```sql
   SELECT rolname, rolsuper, rolbypassrls FROM pg_roles
     WHERE rolname IN ('procurement_svc', 'plugin_svc', 'civitas', 'civitas_admin');
   ```

   ```
        rolname     | rolsuper | rolbypassrls
   -----------------+----------+--------------
    civitas         | t        | t              -- bootstrapping superuser only
    civitas_admin   | f        | f
    plugin_svc      | f        | f
    procurement_svc | f        | f
   ```

   `procurement_svc` and `plugin_svc` are exactly the roles
   `services/procurement-service/vitest.config.ts` and `services/plugin-service/vitest.config.ts`
   point `DATABASE_URL` at by default — i.e. the actual roles the two named suites run as.

5. Widened the check fleet-wide:

   ```sql
   SELECT rolname, rolsuper, rolbypassrls FROM pg_roles
     WHERE rolname LIKE '%_svc' AND (rolsuper OR rolbypassrls);
   -- 0 rows
   ```

   No `*_svc` role anywhere in the bootstrapped cluster holds `BYPASSRLS` or `SUPERUSER`.
   The only roles with `BYPASSRLS` are the deliberate `*_scanner` roles (documented in
   `scripts/ci/bootstrap-postgres.sh` around the `SERVICE_DBS` map as needed for legitimate
   cross-tenant maintenance loops — outbox relay, scheduled purge) and the bootstrapping
   superuser `civitas` itself. Neither is what a service's own test suite connects as.

6. Live proof-of-concept against `procurement.vendor_blacklist` (FORCE RLS confirmed via
   `\d procurement.vendor_blacklist` → `Policies (forced row security enabled)`), connected
   as `procurement_svc` exactly as the test suite does:
   - Seeded an active blacklist row via the properly tenant-scoped path (`db.transaction`
     under `runWithTenant`, which sets `app.tenant_id`).
   - Reproduced TX-002's exact bug shape: called `repo.reinstate()`
     (`vendor-blacklist/repo.ts:90-99`) — its bare `db.execute`, no `db.transaction()`
     wrapper, no GUC — with no surrounding tenant context, exactly how
     `vendor-blacklist/consumer.ts:83` calls it today.
   - Result: `UPDATE 0`. The row is untouched and still reads back as `active`. This is
     TX-002, reproduced live: FORCE RLS silently rejected the unscoped write, and the
     application code has no check on the affected-row count, so it appears to succeed.
   - Control: the identical statement with `set_config('app.tenant_id', ...)` set first
     succeeds (`UPDATE 1`), ruling out a broken table/policy/test setup as the explanation.

7. **Sabotage-check (inverted, per report §5 step 4):** since this PoC documents *today's
   buggy behavior* rather than a post-fix correctness assertion, the meaningful sabotage
   check is the reverse — prove the test fails once the bad case is simulated.
   `ALTER ROLE procurement_svc BYPASSRLS;`, re-ran the PoC test: the "silently touches 0
   rows" assertion now fails (`affected` becomes `1`), confirming the test is actually
   sensitive to the exact failure mode TX-012 was opened to rule out. Reverted with
   `ALTER ROLE procurement_svc NOBYPASSRLS;` and re-ran — passes again.

## Evidence committed

`services/procurement-service/tests/tx-012-rls-bypass-detection.poc.test.ts` — 3 tests,
passing against a fresh isolated Postgres container bootstrapped via
`scripts/ci/bootstrap-postgres.sh`. Full `procurement-service` suite (40 files / 620 tests)
still passes with this file added — no regressions.

This file is evidence for TX-012, **not** the TX-002 fix's regression test. It intentionally
asserts today's incorrect behavior (`reinstate()` returns `0` and leaves the row `active`
when called unscoped) so that TX-012's own uncertainty is resolved. TX-002's dedicated PR
should replace/extend it with a test asserting the *correct* post-fix behavior
(`rowCount === 1`, or throws — per the report's DoD for TX-002), sabotage-checked the normal
way (break the fix, watch it fail, restore).

## Scope / limits

- Verified directly by role query and live PoC: `procurement_svc` (TX-002) and `plugin_svc`
  (TX-003, role attributes only — did not additionally write a PoC test against
  `registry.plugins`, since the procurement PoC already demonstrates the infrastructure is
  capable of catching this bug class, and duplicating it would not add new evidence).
- Verified in bulk (no `*_svc` role has `BYPASSRLS`/`SUPERUSER`): confidence that this is
  not a per-service accident, but this does not by itself prove every FORCE RLS table across
  every service has a correct, non-bypassable policy — only that the login role itself isn't
  the hole. Policy correctness per-table is out of scope for TX-012.
- This was run against a throwaway container bootstrapped fresh in this session, not the
  shared dev/CI Postgres already running on the host (:5435). If that long-lived instance's
  roles have ever been hand-altered outside of `bootstrap-postgres.sh` (the `bootstrap_admin_role.sql`
  comments already flag this failure mode for `civitas_admin` on hand-provisioned dev
  machines), this finding would not catch that specific drift. Recommend an occasional
  `SELECT rolname, rolbypassrls FROM pg_roles WHERE rolname LIKE '%_svc'` sanity check
  against the actual CI runner's Postgres as a cheap follow-up, since this repo does not appear
  to have one today.

## Conclusion

TX-012's uncertainty is resolved: test/CI roles are correctly `NOBYPASSRLS`, FORCE RLS is
live against them, and TX-002/TX-003 are real, currently-undetected bugs — not false
positives masked by a bypassing test environment. Both should proceed to their own
dedicated fix PRs per the report (route through the caller's transaction; assert the
affected-row count).
