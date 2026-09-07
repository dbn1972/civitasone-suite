/**
 * hrms-service recruitment module nested-transaction connection-pool deadlock
 * regression. Found via .claude/skills/16-production-readiness-audit.md
 * section 1: recruitment/f3-consumer.ts had ~30 call sites across 21 repo
 * files that opened their own db.transaction() via scopedRead() while being
 * called from INSIDE an already-open outer db.transaction() -- a second
 * transaction competing for a connection from the same pool as the outer
 * one, deadlocking every in-flight command once concurrency reaches
 * pool.max. All 30 sites were fixed by adding Tx-suffixed siblings that
 * read through the caller-supplied tx instead of opening their own.
 *
 * This test exercises "recruitment_requisition_routes__8" (close
 * requisition), the simplest affected site: requisitionRepo.findRequisitionTx
 * followed by the version-guarded requisitionRepo.updateRequisition write,
 * at pool.max + 3 concurrency, real Postgres, real pool.
 */
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant, withTenantScope } from "@civitasone/db";
import { db } from "../src/shared/db.js";
import { registerF3_recruitment_Consumers } from "../src/modules/recruitment/f3-consumer.js";
import { hrmsRequisitions } from "../src/modules/recruitment/requisition-schema.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "d0000000-dead-4000-8000-00000000d0de";
const ACTOR = "d0000000-dead-4000-8000-0000000ac70b";
const CONCURRENCY = 13; // pool.max (10) + 3

function tenantWrappedQueue(): MemoryQueue {
  const q = new MemoryQueue();
  const rawSubscribe = q.subscribe.bind(q);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (q as any).subscribe = (topic: string, handler: (msg: any) => Promise<void>) =>
    rawSubscribe(topic, (msg: any) => runWithTenant(msg.tenantId, () => handler(msg)));
  return q;
}

function makeMsg(payload: Record<string, unknown>) {
  return {
    messageId: randomUUID(), type: COMMANDS.f3RouteWrite, tenantId: TENANT,
    actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0", payload,
  };
}

async function seedOpenRequisition(): Promise<string> {
  const reqId = randomUUID();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await withTenantScope(db, TENANT, (tx: any) => tx.insert(hrmsRequisitions).values({
    id: reqId, tenantId: TENANT, requisitionNo: "REQ-" + reqId.slice(0, 8).toUpperCase(),
    title: "Assistant Engineer", status: "approved",
    createdBy: ACTOR, updatedBy: ACTOR,
  }));
  return reqId;
}

describe("recruitment consumer -- nested-transaction pool-exhaustion deadlock (real DB, no mocks)", () => {
  it(
    CONCURRENCY + " concurrent recruitment_requisition_routes__8 (close requisition) commands drain without deadlocking the connection pool",
    async () => {
      const reqIds: string[] = [];
      for (let i = 0; i < CONCURRENCY; i++) {
        reqIds.push(await seedOpenRequisition());
      }

      const q = tenantWrappedQueue();
      registerF3_recruitment_Consumers(q);
      await q.start();

      await Promise.all(reqIds.map((requisitionId) =>
        q.publish(COMMANDS.f3RouteWrite, makeMsg({
          op: "recruitment_requisition_routes__8",
          tenantId: TENANT,
          params: { id: requisitionId },
          body: { reason: "position no longer needed" },
        })),
      ));

      const DRAIN_TIMEOUT_MS = 10_000;
      let timedOut = false;
      await Promise.race([
        q.drain(),
        new Promise<void>((resolve) => setTimeout(() => { timedOut = true; resolve(); }, DRAIN_TIMEOUT_MS)),
      ]);

      expect(timedOut, "queue did not drain within " + DRAIN_TIMEOUT_MS + "ms -- nested-transaction pool deadlock regressed").toBe(false);
      expect(q.dlq, "handler errors were swallowed into the DLQ: " + JSON.stringify(q.dlq)).toHaveLength(0);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows = await withTenantScope(db, TENANT, (tx: any) =>
        tx.select().from(hrmsRequisitions).where(eq(hrmsRequisitions.tenantId, TENANT)),
      );
      const updated = rows.filter((r: { id: string }) => reqIds.includes(r.id));
      expect(updated).toHaveLength(CONCURRENCY);
      for (const row of updated) {
        expect(row.status).toBe("closed");
        expect(row.closeReason).toBe("position no longer needed");
        expect(row.version).toBe(2);
      }

      await q.stop();
    },
    { timeout: 20_000 },
  );
});
