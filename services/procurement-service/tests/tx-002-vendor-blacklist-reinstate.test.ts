/**
 * TX-002 regression test — vendor-blacklist reinstate() silently updated 0
 * rows under FORCE RLS while the outer transaction still reported success.
 *
 * Context (docs/ENTERPRISE-GAP-REPORT-2026-09-07.md, TX-002; investigation
 * evidence in docs/TX-012-test-role-rls-posture.md and
 * tests/tx-012-rls-bypass-detection.poc.test.ts): the old `repo.reinstate()`
 * ran a bare `db.execute()` with no `db.transaction()` wrapper of its own,
 * so `wrapWithTenantGuc` (packages/db/src/wrap-tenant-db.ts) — which only
 * intercepts `.transaction()` calls — never set `app.tenant_id` on that
 * connection. Under `procurement.vendor_blacklist`'s FORCE ROW LEVEL
 * SECURITY, `current_tenant_id()` read NULL and the UPDATE silently matched
 * 0 rows, while vendor-blacklist/consumer.ts's outer transaction still
 * flipped the vendor to `registered`, enqueued
 * `procurement.vendor.reinstated`, and audited success — a split-brain
 * state where the system reported "reinstated" but the blacklist row never
 * changed.
 *
 * Fix: `repo.reinstateTx(tx, ...)` takes the caller's already-open
 * transaction (the same connection the outer `db.transaction()` already ran
 * `SET LOCAL app.tenant_id` on, via worker.ts's runWithTenant wrap — see
 * services/procurement-service/src/worker.ts) instead of touching the bare
 * `db` object, and throws unless exactly one row was affected.
 *
 * This suite runs against the real `procurement_svc` NOBYPASSRLS role
 * (services/procurement-service/vitest.config.ts's default DATABASE_URL,
 * or the DATABASE_URL override this run was invoked with), the same role
 * TX-012 confirmed is NOBYPASSRLS with FORCE RLS genuinely binding it — so
 * a regression here is a real signal, not masked by a bypassing test role.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { vendorBlacklist } from "../src/modules/vendor-blacklist/schema.js";
import * as repo from "../src/modules/vendor-blacklist/repo.js";

const TENANT = "3c002000-aaaa-4000-8000-0000000000f2";
const ACTOR_ID = randomUUID();

async function clean() {
  // Cleanup must go through the properly tenant-scoped path (db.transaction
  // under runWithTenant), since that is the path that actually gets the RLS
  // GUC set.
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.delete(vendorBlacklist).where(eq(vendorBlacklist.tenantId, TENANT));
    }),
  );
}

async function seedActive(vendorId: string) {
  await runWithTenant(TENANT, () =>
    repo.insertBlacklist({
      tenantId: TENANT,
      vendorId,
      reason: "TX-002 regression seed",
      blacklistedBy: ACTOR_ID,
      createdBy: ACTOR_ID,
      status: "active",
    }),
  );
}

afterAll(async () => {
  await clean();
  await sqlClient.end();
});

describe("TX-002 fix — reinstateTx genuinely flips the blacklist row under FORCE RLS (procurement_svc, NOBYPASSRLS)", () => {
  it("reinstates the active row through the caller's transaction: exactly 1 row affected, status flips to 'reinstated'", async () => {
    const vendorId = randomUUID();
    await clean();
    await seedActive(vendorId);

    // Mirrors exactly how vendor-blacklist/consumer.ts calls this today:
    // inside the outer db.transaction(), itself inside the tenant context
    // worker.ts's runWithTenant wrap establishes for every queue handler.
    const affected = await runWithTenant(TENANT, () =>
      db.transaction((tx) => repo.reinstateTx(tx, TENANT, vendorId, ACTOR_ID)),
    );

    expect(affected).toBe(1);

    const row = await runWithTenant(TENANT, () => repo.findActive(TENANT, vendorId));
    // No longer 'active' — findActive (which filters status = 'active')
    // must now find nothing.
    expect(row).toBeNull();

    const [persisted] = await runWithTenant(TENANT, () =>
      db.transaction((tx) => tx.select().from(vendorBlacklist)
        .where(eq(vendorBlacklist.vendorId, vendorId))),
    );
    expect(persisted?.status).toBe("reinstated");
    expect(persisted?.reinstatedAt).not.toBeNull();
  });

  it("throws instead of silently succeeding when there is no active row to reinstate (0-row case fails loudly)", async () => {
    const vendorId = randomUUID(); // never blacklisted
    await clean();

    await expect(
      runWithTenant(TENANT, () =>
        db.transaction((tx) => repo.reinstateTx(tx, TENANT, vendorId, ACTOR_ID)),
      ),
    ).rejects.toThrow(/expected exactly 1 active blacklist row/);
  });

  it("throws (does not silently touch 0 rows) for a cross-tenant vendor ID even when called with the wrong tenant's context", async () => {
    const vendorId = randomUUID();
    const OTHER_TENANT = "3c002000-bbbb-4000-8000-0000000000f3";
    await clean();
    await runWithTenant(OTHER_TENANT, () =>
      db.transaction(async (tx) => {
        await tx.delete(vendorBlacklist).where(eq(vendorBlacklist.tenantId, OTHER_TENANT));
      }),
    );
    await runWithTenant(OTHER_TENANT, () =>
      repo.insertBlacklist({
        tenantId: OTHER_TENANT,
        vendorId,
        reason: "TX-002 regression cross-tenant seed",
        blacklistedBy: ACTOR_ID,
        createdBy: ACTOR_ID,
        status: "active",
      }),
    );

    // Calling reinstateTx for TENANT (not OTHER_TENANT) against a vendor
    // that is only blacklisted under OTHER_TENANT: RLS scopes the UPDATE to
    // TENANT's rows, so it correctly matches 0 and must throw, not silently
    // report success.
    await expect(
      runWithTenant(TENANT, () =>
        db.transaction((tx) => repo.reinstateTx(tx, TENANT, vendorId, ACTOR_ID)),
      ),
    ).rejects.toThrow(/expected exactly 1 active blacklist row/);

    // Confirm the other tenant's row was untouched.
    const otherRow = await runWithTenant(OTHER_TENANT, () => repo.findActive(OTHER_TENANT, vendorId));
    expect(otherRow?.status).toBe("active");

    await runWithTenant(OTHER_TENANT, () =>
      db.transaction(async (tx) => {
        await tx.delete(vendorBlacklist).where(eq(vendorBlacklist.tenantId, OTHER_TENANT));
      }),
    );
  });
});
