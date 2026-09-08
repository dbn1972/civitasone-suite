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
 * This file is that proof, not that regression test. It exercises the real,
 * currently-buggy `repo.reinstate()` (vendor-blacklist/repo.ts:90-99) and
 * documents its CURRENT (broken) behavior: called the way
 * vendor-blacklist/consumer.ts:83 calls it today — with no tenant context
 * ever wrapping the bare `db.execute` — it silently updates zero rows and
 * returns 0, even though a matching active row exists. That is TX-002 itself,
 * reproduced live against a real NOBYPASSRLS role.
 *
 * IMPORTANT — do not treat this file as "the TX-002 fix's regression test."
 * TX-002's own PR should replace/extend this with a test that asserts the
 * CORRECT post-fix behavior (rowCount === 1, throws otherwise) and is
 * sabotage-checked per report §5 step 4. This file intentionally asserts
 * today's incorrect behavior, to prove — for TX-012's purposes — that the
 * infrastructure is capable of noticing it.
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

  it("TX-002 bug shape: bare db.execute reinstate() with no tenant context silently touches 0 rows", async () => {
    // No runWithTenant() wrapper here — this is exactly how
    // vendor-blacklist/consumer.ts:83 calls repo.reinstate() today: no
    // surrounding tenant context, and reinstate() itself never opens a
    // db.transaction(), so wrapWithTenantGuc has nothing to intercept.
    const affected = await repo.reinstate(TENANT, VENDOR_ID, ACTOR_ID);

    // Today's (buggy) behavior: silently 0, not a thrown error. If the
    // connecting role held BYPASSRLS, this would instead return 1 and this
    // assertion would fail — which is exactly the failure mode TX-012 was
    // opened to rule out.
    expect(affected).toBe(0);

    // Row must still read back as 'active' — the "vendor flipped, blacklist
    // row untouched" split-brain state TX-002 describes.
    const stillActive = await runWithTenant(TENANT, () => repo.findActive(TENANT, VENDOR_ID));
    expect(stillActive).not.toBeNull();
    expect(stillActive?.status).toBe("active");
  });

  it("control: even WITH a tenant context active, bare db.execute still bypasses the GUC (proves the bug is in reinstate() itself, not caller discipline)", async () => {
    // wrapWithTenantGuc only overrides db.transaction(); it does not, and
    // cannot, intercept a bare db.execute() call — see
    // packages/db/src/wrap-tenant-db.ts. So even wrapping the call site in
    // runWithTenant() does not save it.
    const affected = await runWithTenant(TENANT, () => repo.reinstate(TENANT, VENDOR_ID, ACTOR_ID));
    expect(affected).toBe(0);
  });
});
