/**
 * TX-001 (procurement-service slice) — regression test for
 * vendor-blacklist/consumer.ts's vendorBlacklistAdd handler, the more
 * dangerous of this file's TX-001 sites: `repo.insertBlacklist({...})` was
 * called with NO `writer`/tx argument, even though insertBlacklist has
 * supported an optional `writer` param since before this fix — a nested
 * WRITE, not just a read, running in its own separate, independently-
 * committing transaction from inside this consumer's already-open outer
 * db.transaction(). That is worse than a nested read in two ways this suite
 * checks:
 *
 *  1. Pool exhaustion under load (same shape as TX-002/TX-003 and
 *     three-way-match's four reads): pool.max concurrent outer transactions
 *     each needing one extra nested connection deadlocks the pool.
 *  2. Atomicity: because the old insertBlacklist() opened its OWN
 *     transaction, it committed independently of the outer one. If the
 *     outer transaction's LATER steps (vendorRepo.updateVendor, the outbox
 *     enqueue calls) ever failed and rolled back, the blacklist row would
 *     already be permanently committed — a vendor "blacklisted" in the
 *     vendor_blacklist table whose own vendor record was never flipped and
 *     for which no event was ever emitted. Routing through insertBlacklistTx
 *     (this file's existing `writer` support, now actually wired up) makes
 *     the write part of the same atomic unit of work.
 *
 * Also verifies — matching TX-002's own verification standard for this exact
 * file (tests/tx-002-vendor-blacklist-reinstate.test.ts) — that the write is
 * genuinely tenant-scoped under this table's FORCE ROW LEVEL SECURITY, not
 * merely deadlock-safe: a nested write outside the transaction's GUC scope
 * could silently no-op or land against the wrong tenant, the same class of
 * bug TX-002 fixed for reinstate() here.
 *
 * Sabotage check (see PR body): reverting insertBlacklistTx's call site back
 * to bare `repo.insertBlacklist({...})` reproduces the drain timeout below.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant, withTenantScope } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { registerVendorBlacklistConsumers } from "../src/modules/vendor-blacklist/consumer.js";
import { vendorBlacklist } from "../src/modules/vendor-blacklist/schema.js";
import { procurementVendors } from "../src/modules/vendor/schema.js";
import * as repo from "../src/modules/vendor-blacklist/repo.js";
import { COMMANDS, EVENTS } from "../src/topics.js";

const TENANT_A = "7b7b7b7b-3002-4000-8000-0000000000f1";
const TENANT_B = "7b7b7b7b-3002-4000-8000-0000000000f2";
const ACTOR = randomUUID();
// pool.max defaults to 10 (packages/db/src/pool.ts, DB_POOL_MAX); +3 clears it.
const CONCURRENCY = 13;

function tenantWrappedQueue(): MemoryQueue {
  const q = new MemoryQueue();
  const rawSubscribe = q.subscribe.bind(q);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (q as any).subscribe = (topic: string, handler: (msg: any) => Promise<void>) =>
    rawSubscribe(topic, (msg: any) => runWithTenant(msg.tenantId, () => handler(msg)));
  return q;
}

function makeMsg(tenantId: string, payload: Record<string, unknown>) {
  return {
    messageId: randomUUID(), type: COMMANDS.vendorBlacklistAdd, tenantId,
    actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0", payload,
  };
}

async function cleanupTenant(tenantId: string) {
  await runWithTenant(tenantId, () => db.transaction(async (tx) => {
    await tx.delete(vendorBlacklist).where(eq(vendorBlacklist.tenantId, tenantId));
    await tx.delete(procurementVendors).where(eq(procurementVendors.tenantId, tenantId));
  }));
}

afterAll(async () => {
  await cleanupTenant(TENANT_A);
  await cleanupTenant(TENANT_B);
  await sqlClient.end();
});

describe("vendor-blacklist consumer — nested WRITE pool-exhaustion deadlock (real DB, no mocks)", () => {
  it(
    `${CONCURRENCY} concurrent procurement.vendor_blacklist.add commands drain without deadlocking the pool, and every write persists`,
    async () => {
      await cleanupTenant(TENANT_A);

      const vendorIds: string[] = [];
      for (let i = 0; i < CONCURRENCY; i++) {
        const vendorId = randomUUID();
        vendorIds.push(vendorId);
        await withTenantScope(db, TENANT_A, (tx: any) => tx.insert(procurementVendors).values({
          id: vendorId, tenantId: TENANT_A, name: `Vendor ${i}`,
          vendorType: "registered", createdBy: ACTOR, updatedBy: ACTOR,
        }));
      }

      const q = tenantWrappedQueue();
      registerVendorBlacklistConsumers(q);
      await q.start();

      await Promise.all(vendorIds.map((vendorId) =>
        q.publish(COMMANDS.vendorBlacklistAdd, makeMsg(TENANT_A, {
          id: randomUUID(), tenantId: TENANT_A, vendorId,
          reason: "TX-001 regression", blacklistedFrom: new Date().toISOString().slice(0, 10),
        })),
      ));

      const DRAIN_TIMEOUT_MS = 10_000;
      let timedOut = false;
      await Promise.race([
        q.drain(),
        new Promise<void>((resolve) => setTimeout(() => { timedOut = true; resolve(); }, DRAIN_TIMEOUT_MS)),
      ]);
      expect(timedOut, `queue did not drain within ${DRAIN_TIMEOUT_MS}ms — nested-write pool deadlock regressed`).toBe(false);
      await q.stop();

      // State correctness: every vendor must have an active blacklist row
      // AND its vendorType flipped — both steps of the same outer
      // transaction must have landed together for all N messages.
      const rows = await runWithTenant(TENANT_A, () => db.transaction((tx) =>
        tx.select().from(vendorBlacklist).where(eq(vendorBlacklist.tenantId, TENANT_A))));
      expect(rows).toHaveLength(CONCURRENCY);
      const vendors = await runWithTenant(TENANT_A, () => db.transaction((tx) =>
        tx.select().from(procurementVendors).where(eq(procurementVendors.tenantId, TENANT_A))));
      for (const vendorId of vendorIds) {
        expect(rows.some((r) => r.vendorId === vendorId && r.status === "active"),
          `no active blacklist row for vendor ${vendorId}`).toBe(true);
        const v = vendors.find((v) => v.id === vendorId);
        expect(v?.vendorType, `vendor ${vendorId} not flipped to blacklisted`).toBe("blacklisted");
      }
    },
    { timeout: 20_000 },
  );
});

describe("insertBlacklistTx — genuinely tenant-scoped under FORCE RLS (not just deadlock-safe)", () => {
  it("writes land under the correct tenant and are invisible under a different tenant's GUC scope", async () => {
    await cleanupTenant(TENANT_A);
    await cleanupTenant(TENANT_B);
    const vendorId = randomUUID();

    const inserted = await runWithTenant(TENANT_A, () => db.transaction((tx) =>
      repo.insertBlacklistTx(tx, {
        id: randomUUID(), tenantId: TENANT_A, vendorId, reason: "RLS scoping check",
        blacklistedBy: ACTOR, createdBy: ACTOR, status: "active",
      })));
    expect(inserted.tenantId).toBe(TENANT_A);

    // Visible under the correct tenant's GUC scope.
    const foundOwn = await runWithTenant(TENANT_A, () => db.transaction((tx) =>
      repo.findActiveTx(tx, TENANT_A, vendorId)));
    expect(foundOwn?.vendorId).toBe(vendorId);

    // A raw, unscoped select (no runWithTenant, no db.transaction — the same
    // connection shape the old bare insertBlacklist()/reinstate() bug used)
    // must be blocked by FORCE RLS: current_tenant_id() is NULL, so it can
    // match nothing, proving the GUC — not an app-level WHERE clause — is
    // what is actually binding this table.
    const rawRows = await sqlClient`
      SELECT * FROM procurement.vendor_blacklist WHERE vendor_id = ${vendorId}::uuid
    `;
    expect(rawRows.length, "FORCE RLS did not block an unscoped raw read — GUC is not binding this table as expected").toBe(0);

    // And under a DIFFERENT tenant's GUC scope, the row must not be visible
    // either — the write did not silently land against, or become readable
    // from, the wrong tenant.
    const foundOther = await runWithTenant(TENANT_B, () => db.transaction((tx) =>
      repo.findActiveTx(tx, TENANT_B, vendorId)));
    expect(foundOther).toBeNull();

    await cleanupTenant(TENANT_A);
  });

  it("participates in the outer transaction's atomicity: a later failure in the SAME transaction rolls the write back (not orphaned by its own nested commit)", async () => {
    await cleanupTenant(TENANT_A);
    const vendorId = randomUUID();

    await expect(
      runWithTenant(TENANT_A, () => db.transaction(async (tx) => {
        await repo.insertBlacklistTx(tx, {
          id: randomUUID(), tenantId: TENANT_A, vendorId, reason: "atomicity check",
          blacklistedBy: ACTOR, createdBy: ACTOR, status: "active",
        });
        // Simulate a later step in the same handler failing (e.g. the
        // vendorRepo.updateVendor or outbox enqueue call) after the write.
        throw new Error("simulated downstream failure");
      })),
    ).rejects.toThrow("simulated downstream failure");

    // Because insertBlacklistTx shares the caller's tx (fix), the whole unit
    // of work rolled back together — no orphaned blacklist row. Before this
    // fix, insertBlacklist() opened its own transaction and would have
    // committed this row independently of the throw above.
    const found = await runWithTenant(TENANT_A, () => db.transaction((tx) =>
      repo.findActiveTx(tx, TENANT_A, vendorId)));
    expect(found, "insertBlacklistTx's write survived a rollback of its own outer transaction").toBeNull();
  });
});
