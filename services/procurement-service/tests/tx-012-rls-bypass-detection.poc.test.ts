/**
 * TX-012 evidence — does the test environment's DB role actually enforce
 * FORCE ROW LEVEL SECURITY, or does it silently BYPASSRLS like a superuser?
 *
 * Context (docs/ENTERPRISE-GAP-REPORT-2026-09-07.md, TX-012): TX-002 and
 * TX-003 both describe a bug shape — a bare `db.execute`/`db.select` call
 * that never goes through `db.transaction()`, so `wrapWithTenantGuc`
 * (packages/db/src/wrap-tenant-db.ts) never sets `app.tenant_id`, and the
 * call runs against a FORCE-RLS table with the GUC unset. If that bug is
 * real, the query should be silently blocked by Postgres — but only if the
 * connecting role is NOBYPASSRLS. If CI/local test roles instead carry
 * BYPASSRLS (or FORCE RLS isn't actually binding them), the same buggy code
 * would quietly see/touch every row and all existing tests would stay green,
 * masking the bug. TX-012 asks: which is it?
 *
 * Ground truth, established against a fresh, isolated postgres:16-alpine
 * container bootstrapped via scripts/ci/bootstrap-postgres.sh (the same way
 * CI/local dev provisions roles) — see the TX-012 PR description for the
 * full transcript:
 *
 *   SELECT rolname, rolsuper, rolbypassrls FROM pg_roles
 *     WHERE rolname IN ('procurement_svc','plugin_svc');
 *
 *     rolname          | rolsuper | rolbypassrls
 *     -----------------+----------+--------------
 *     plugin_svc       | f        | f
 *     procurement_svc  | f        | f
 *
 * `procurement_svc` is exactly the role this service's vitest.config.ts
 * DATABASE_URL connects as. NOBYPASSRLS confirmed — this is the GOOD CASE
 * described in TX-012's task: FORCE RLS genuinely binds the test role, so a
 * regression test for TX-002 would actually catch the bug once written.
 *
 * UPDATE (TX-002 fix landed): this file originally exercised the real,
 * then-buggy `repo.reinstate()` (vendor-blacklist/repo.ts:90-99) directly,
 * calling it exactly the way vendor-blacklist/consumer.ts:83 called it —
 * with no tenant context ever wrapping its bare `db.execute` — and asserted
 * its CURRENT (broken) behavior: 0 rows silently touched. That function has
 * since been removed and replaced by `repo.reinstateTx(tx, ...)`, which
 * takes the caller's already-open, GUC-scoped transaction and throws unless
 * exactly one row is affected (see repo.ts's TX-002 fix doc-comment). The
 * correct-behavior regression test — asserting `reinstateTx` genuinely
 * flips the row to 'reinstated', sabotage-checked per report §5 step 4 —
 * now lives in tests/tx-002-vendor-blacklist-reinstate.test.ts.
 *
 * This file keeps only the TX-012-specific evidence that does not depend on
 * application code: proof that FORCE RLS itself, at the Postgres level,
 * genuinely blocks an unscoped write against this table under the real
 * `procurement_svc` NOBYPASSRLS role (test 1, unchanged, and a new test 2
 * that exercises a raw unscoped UPDATE directly against `sqlClient` — the
 * same shape of connection the old buggy bare-`db.execute` call used —
 * without going through any application function at all).
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { vendorBlacklist } from "../src/modules/vendor-blacklist/schema.js";
import * as repo from "../src/modules/vendor-blacklist/repo.js";

const TENANT = "3c012000-aaaa-4000-8000-0000000000f1";
const VENDOR_ID = randomUUID();
const ACTOR_ID = randomUUID();

async function clean() {
  // Cleanup must go through the properly tenant-scoped path (db.transaction
  // under runWithTenant), since that is the one path in this file that
  // actually gets the RLS GUC set.
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.delete(vendorBlacklist).where(eq(vendorBlacklist.tenantId, TENANT));
    }),
  );
}

afterAll(async () => {
  await clean();
  await sqlClient.end();
});

describe("TX-012 evidence — RLS is enforced against the real test role (procurement_svc)", () => {
  it("a properly tenant-scoped write is visible under RLS (control)", async () => {
    await clean();
    await runWithTenant(TENANT, () =>
      repo.insertBlacklist({
        tenantId: TENANT,
        vendorId: VENDOR_ID,
        reason: "TX-012 PoC seed",
        blacklistedBy: ACTOR_ID,
        createdBy: ACTOR_ID,
        status: "active",
      }),
    );
    const found = await runWithTenant(TENANT, () => repo.findActive(TENANT, VENDOR_ID));
    expect(found).not.toBeNull();
    expect(found?.status).toBe("active");
  });

  it("a raw unscoped UPDATE (no tenant context, no db.transaction()) is silently blocked by FORCE RLS at the Postgres level — independent of any application function", async () => {
    await clean();
    await runWithTenant(TENANT, () =>
      repo.insertBlacklist({
        tenantId: TENANT,
        vendorId: VENDOR_ID,
        reason: "TX-012 PoC seed",
        blacklistedBy: ACTOR_ID,
        createdBy: ACTOR_ID,
        status: "active",
      }),
    );

    // Exactly the connection shape the old buggy repo.reinstate() used: a
    // bare query against the pool-level client, no runWithTenant, no
    // db.transaction() to trigger wrapWithTenantGuc's SET LOCAL. This
    // bypasses application code entirely to isolate the DB-level guarantee
    // TX-012 was opened to verify.
    const rows = await sqlClient`
      UPDATE procurement.vendor_blacklist
         SET status = 'reinstated', reinstated_at = NOW()
       WHERE tenant_id = ${TENANT}::uuid
         AND vendor_id = ${VENDOR_ID}::uuid
         AND status = 'active'
    `;
    expect(rows.count).toBe(0);

    const stillActive = await runWithTenant(TENANT, () => repo.findActive(TENANT, VENDOR_ID));
    expect(stillActive).not.toBeNull();
    expect(stillActive?.status).toBe("active");
  });
});
