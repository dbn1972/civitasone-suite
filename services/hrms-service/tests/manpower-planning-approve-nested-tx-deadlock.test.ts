/**
 * hrms-service manpower-planning nested-transaction connection-pool deadlock
 * regression. Found via .claude/skills/16-production-readiness-audit.md
 * section 1: manpower_planning_routes__4 (plan approval, in
 * manpower-planning/f3-consumer.ts) called scopedRead-based repo.listRoster
 * from INSIDE its own already-open outer db.transaction() -- a second
 * transaction competing for a connection from the same pool as the outer
 * one, deadlocking every in-flight command once concurrency reaches
 * pool.max. Same shape as hrms-service contracts module and several other
 * services in this audit pass.
 *
 * Fixed by routing the call onto repo.listRosterTx(tx, ...), reading
 * through the already-open tx. This test exercises
 * manpower_planning_routes__4 (plan approval) at pool.max + concurrency,
 * real Postgres, real pool.
 */
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant, withTenantScope } from "@civitasone/db";
import { db } from "../src/shared/db.js";
import { registerF3_manpower_planning_Consumers } from "../src/modules/manpower-planning/f3-consumer.js";
import { manpowerPlans } from "../src/modules/manpower-planning/schema.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "c0000000-dead-4000-8000-00000000c0de";
const ACTOR = "c0000000-dead-4000-8000-0000000ac70a";
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
    messageId: randomUUID(), type: COMMANDS.f3RouteWrite, tenantId: TENANT, actorId: ACTOR,
    correlationId: randomUUID(), schemaVersion: "1.0", payload,
  };
}

async function seedPendingPlan(): Promise<string> {
  const id = randomUUID();
  // sanctionedStrength === filledStrength makes computeVacancy() yield
  // vacancy 0, so the test stays focused on the listRoster/listRosterTx call
  // site (which fires unconditionally) without also having to stand up the
  // downstream recruitment-requisition/hrms.job.create fan-out.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await withTenantScope(db, TENANT, (tx: any) => tx.insert(manpowerPlans).values({
    id, tenantId: TENANT, planYear: 2027, unitId: randomUUID(), cadre: `Cadre-${id.slice(0, 8)}`,
    requiredStrength: 10, sanctionedStrength: 5, filledStrength: 5,
    status: "pending_approval", createdBy: ACTOR,
  }));
  return id;
}

describe("manpower-planning f3-consumer -- nested-transaction pool-exhaustion deadlock (real DB, no mocks)", () => {
  it(
    `${CONCURRENCY} concurrent manpower_planning_routes__4 (approve) commands drain without deadlocking the connection pool`,
    async () => {
      const planIds: string[] = [];
      for (let i = 0; i < CONCURRENCY; i++) {
        planIds.push(await seedPendingPlan());
      }

      const q = tenantWrappedQueue();
      registerF3_manpower_planning_Consumers(q);
      await q.start();

      await Promise.all(planIds.map((id) =>
        q.publish(COMMANDS.f3RouteWrite, makeMsg({
          op: "manpower_planning_routes__4", tenantId: TENANT, params: { id }, body: {},
        })),
      ));

      // The failure mode of this bug is queue.drain() never resolving
      // (every in-flight transaction blocked on an unavailable connection
      // forever), so the proof this test needs is that drain() resolves at
      // all within a generous-but-bounded window.
      const DRAIN_TIMEOUT_MS = 10_000;
      let timedOut = false;
      await Promise.race([
        q.drain(),
        new Promise<void>((resolve) => setTimeout(() => { timedOut = true; resolve(); }, DRAIN_TIMEOUT_MS)),
      ]);

      expect(timedOut, `queue did not drain within ${DRAIN_TIMEOUT_MS}ms -- nested-transaction pool deadlock regressed`).toBe(false);
      // MemoryQueue.deliver() swallows handler errors into dlq instead of
      // rejecting -- a passing drain() alone does not prove every command
      // actually succeeded.
      expect(q.dlq, `dlq should be empty, got: ${JSON.stringify(q.dlq)}`).toHaveLength(0);

      // Real DB state, not just "did not hang": every plan must actually
      // have been approved (proves listRosterTx read inside the
      // transaction did not silently fail or get skipped).
      for (const id of planIds) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rows = await withTenantScope(db, TENANT, (tx: any) =>
          tx.select().from(manpowerPlans).where(eq(manpowerPlans.id, id)));
        expect(rows[0]?.status).toBe("approved");
      }

      await q.stop();
    },
    { timeout: 20_000 },
  );
});
