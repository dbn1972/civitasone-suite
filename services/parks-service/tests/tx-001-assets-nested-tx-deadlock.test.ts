/**
 * TX-001 (parks-service slice) -- assets module nested-transaction
 * connection-pool deadlock regression.
 *
 * Found via the ENTERPRISE-GAP-REPORT-2026-09-07.md TX-001 sweep (evidence
 * column cited `parks assets:68`), confirmed by an independent manual scan
 * of every db.transaction() block in this service (14 total across
 * assets/complaints/inspections/tree_requests) plus a run of
 * /tmp/scan_nested_tx_v2.py against the service -- both agree on exactly
 * ONE genuine site, in assets/consumer.ts's RECORD_MAINTENANCE handler:
 *
 *   `repo.findById(p.id, msg.tenantId)`  (line 68, inside the db.transaction
 *   opened at line 66)
 *
 * findById() is defined via this service's scopedRead() helper
 * (src/shared/db.ts), which is a bare `db.transaction(fn)` -- i.e. every
 * bare read repo function in this service already opens its OWN
 * transaction, same failure shape as estab/procurement/parking's TX-001
 * fixes. Called from INSIDE RECORD_MAINTENANCE's already-open outer
 * db.transaction(), it needs a second, nested pool connection. Under
 * pool.max concurrent in-flight consumer transactions, no second connection
 * is ever free and the whole queue deadlocks silently forever.
 *
 * (Every other db.transaction() block in this service was checked and is
 * NOT a genuine site: complaints/consumer.ts's RESOLVE_COMPLAINT and
 * tree_requests/consumer.ts's APPROVE/REJECT/COMPLETE handlers already read
 * `existing` BEFORE opening the write transaction, not nested inside it;
 * inspections/consumer.ts's SCHEDULE_INSPECTION already routes its
 * cross-module reads through complaintsRepo.findByIdTx/
 * treeRequestsRepo.findByIdTx, which already exist.)
 *
 * This test drives recordMaintenance (parks.asset.record_maintenance) at
 * pool.max + 3 concurrency, real Postgres, real pool, many officers logging
 * maintenance on DIFFERENT assets at once (a realistic trigger -- e.g. an
 * end-of-day bulk maintenance sweep across a park zone). Fixed by routing
 * the nested read onto repo.findByIdTx(tx, ...), reading through the
 * caller's already-open tx instead of opening a second one.
 *
 * Sabotage check (see PR body): reverting the call site back to the bare
 * findById() reproduces the drain timeout below.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { parksAssets } from "../src/modules/assets/schema.js";
import { outboxMessages } from "@civitasone/outbox";
import { registerAssetConsumers } from "../src/modules/assets/consumer.js";
import { tenantScoped } from "../src/shared/tenant-queue.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "9a161000-dead-4000-8000-00000000f1a1";
const OFFICER = "9a161000-dead-4000-8000-0000000ac70a";
// pool.max defaults to 10 (packages/db/src/pool.ts, DB_POOL_MAX) when not
// routed through pgbouncer, which is exactly this test DB's connection style
// (vitest.config.ts DATABASE_URL points straight at Postgres). +3 to clear it.
const CONCURRENCY = 13;

function makeMsg(assetId: string) {
  return {
    messageId: randomUUID(), type: COMMANDS.RECORD_MAINTENANCE, tenantId: TENANT,
    actorId: OFFICER, correlationId: randomUUID(), schemaVersion: "1.0",
    payload: {
      id: assetId,
      maintenanceEntry: { note: "TX-001 deadlock fixture sweep" },
      version: 1,
    },
  };
}

async function clean() {
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
      // _inbox.processed has no tenantId column (just messageId + processedAt) --
      // messageIds here are always fresh randomUUID()s per test run, so there
      // is nothing of this tenant's to clean there (same as parking-service's
      // TX-001 deadlock test precedent).
      await tx.delete(parksAssets).where(eq(parksAssets.tenantId, TENANT));
    }),
  );
}

let assetIds: string[] = [];

beforeAll(async () => {
  await clean();
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      assetIds = Array.from({ length: CONCURRENCY }, () => randomUUID());
      for (const [i, id] of assetIds.entries()) {
        await tx.insert(parksAssets).values({
          id, tenantId: TENANT, assetCode: `PRKA-TX001-${i}`, assetType: "tree",
          name: `TX-001 Deadlock Fixture Tree ${i}`, location: { line1: "X", city: "Pune", pin: "411001" },
          area: null, areaUnit: null, status: "active",
          createdBy: OFFICER, updatedBy: OFFICER,
        });
      }
    }),
  );
});

afterAll(async () => { await clean(); await sqlClient.end(); });

describe("assets consumer recordMaintenance -- nested-transaction pool-exhaustion deadlock (real DB, no mocks)", () => {
  it(
    `${CONCURRENCY} concurrent recordMaintenance commands across different assets drain without deadlocking the connection pool`,
    async () => {
      const q = tenantScoped(new MemoryQueue());
      registerAssetConsumers(q);
      await q.start();

      await Promise.all(assetIds.map((id) => q.publish(COMMANDS.RECORD_MAINTENANCE, makeMsg(id))));

      const DRAIN_TIMEOUT_MS = 10_000;
      let timedOut = false;
      await Promise.race([
        q.drain(),
        new Promise<void>((resolve) => setTimeout(() => { timedOut = true; resolve(); }, DRAIN_TIMEOUT_MS)),
      ]);
      expect(timedOut, `queue did not drain within ${DRAIN_TIMEOUT_MS}ms -- nested-tx pool deadlock regressed`).toBe(false);
      // MemoryQueue.deliver() swallows handler errors into q.dlq instead of
      // rejecting -- assert the DLQ is empty so a silent per-command failure
      // (e.g. every command timing out on the pool and erroring out) isn't
      // masked by a "drained" queue.
      expect((q as MemoryQueue).dlq, `handler errors were swallowed into the DLQ: ${JSON.stringify((q as MemoryQueue).dlq)}`).toHaveLength(0);
      await q.stop();

      const rows = await runWithTenant(TENANT, () =>
        db.transaction((tx) => tx.select().from(parksAssets).where(inArray(parksAssets.id, assetIds))),
      );
      expect(rows).toHaveLength(CONCURRENCY);
      for (const row of rows) {
        // Every asset must have actually recorded the maintenance entry --
        // proving the fix didn't just avoid the deadlock but that the nested
        // read (the existing asset + its maintenanceHistory) actually landed
        // correctly for every concurrent handler.
        const history = (row.maintenanceHistory ?? []) as Record<string, unknown>[];
        expect(history.length, `asset ${row.id} did not record maintenance`).toBe(1);
        expect(history[0]?.note).toBe("TX-001 deadlock fixture sweep");
        expect(row.lastMaintenanceDate, `asset ${row.id} lastMaintenanceDate not stamped`).not.toBeNull();
      }
    },
    { timeout: 20_000 },
  );
});
