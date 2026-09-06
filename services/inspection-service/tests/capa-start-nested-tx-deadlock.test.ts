/**
 * inspection-service capaStart nested-transaction connection-pool deadlock
 * regression. Found via .claude/skills/16-production-readiness-audit.md
 * section 1: capaStart (capa/consumer.ts) -- and its siblings capaComplete/
 * capaVerify/capaTriggerReinspection -- called repo.findCapaById, a
 * scopedRead-based (and cache-wrapped) function that opens its OWN
 * db.transaction(), from INSIDE its own already-open outer db.transaction().
 * Real CAPA workflow commands under concurrent load is a realistic trigger.
 * Same shape as notification-service (#1028), building-service (#1035),
 * payroll-service (#1042, #1048), finance-service (#1043), hrms-service
 * (#1045, #1047), grant-service (#1049), billing-service (#1050),
 * inspection-service assignment module (#1052).
 *
 * Fixed by routing onto findCapaByIdTx, reading through the caller's
 * already-open tx (and deliberately bypassing the read-through cache).
 */
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant, withTenantScope } from "@civitasone/db";
import { db } from "../src/shared/db.js";
import { registerCapaConsumers } from "../src/modules/capa/consumer.js";
import { correctiveActions } from "../src/modules/capa/schema.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "ca9a0000-dead-4000-8000-00000000ca9a";
const ACTOR = "ca9a0000-dead-4000-8000-0000000ac70a";
const CONCURRENCY = 13; // pool.max (10) + 3

function tenantWrappedQueue(): MemoryQueue {
  const q = new MemoryQueue();
  const rawSubscribe = q.subscribe.bind(q);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (q as any).subscribe = (topic: string, handler: (msg: any) => Promise<void>) =>
    rawSubscribe(topic, (msg: any) => runWithTenant(msg.tenantId, () => handler(msg)));
  return q;
}

function makeMsg(type: string, payload: Record<string, unknown>) {
  return { messageId: randomUUID(), type, tenantId: TENANT, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0", payload };
}

describe("inspection-service capaStart -- nested-transaction pool-exhaustion deadlock (real DB, no mocks)", () => {
  it(
    `${CONCURRENCY} concurrent capaStart commands (each with a real open CAPA row) drain without deadlocking the connection pool`,
    async () => {
      const capaIds: string[] = [];
      for (let i = 0; i < CONCURRENCY; i++) {
        const capaId = randomUUID();
        capaIds.push(capaId);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await withTenantScope(db, TENANT, (tx: any) => tx.insert(correctiveActions).values({
          id: capaId, tenantId: TENANT, findingId: randomUUID(),
          type: "corrective", description: "fix the thing", status: "open",
          createdBy: ACTOR, updatedBy: ACTOR,
        }));
      }

      const q = tenantWrappedQueue();
      registerCapaConsumers(q);
      await q.start();

      await Promise.all(capaIds.map((capaId) =>
        q.publish(COMMANDS.capaStart, makeMsg(COMMANDS.capaStart, { capaId })),
      ));

      const DRAIN_TIMEOUT_MS = 10_000;
      let timedOut = false;
      await Promise.race([
        q.drain(),
        new Promise<void>((resolve) => setTimeout(() => { timedOut = true; resolve(); }, DRAIN_TIMEOUT_MS)),
      ]);

      expect(timedOut, `queue did not drain within ${DRAIN_TIMEOUT_MS}ms -- nested-transaction pool deadlock regressed`).toBe(false);

      await q.stop();
    },
    { timeout: 20_000 },
  );
});
