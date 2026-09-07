/**
 * hrms-service deputation f3-consumer nested-transaction connection-pool
 * deadlock regression. Found via
 * .claude/skills/16-production-readiness-audit.md section 1.
 *
 * Note on provenance: the nested-tx scanner flagged this file for a call to
 * repo.findById, but that string only ever appears inside a comment
 * describing still-unfixed dead code in the OTHER switch case
 * (deputation_routes__1, left deliberately broken -- see the
 * TODO(unresolved-f3-bug) block in the source, out of scope here). The real,
 * working case (deputation_routes__0) had a DIFFERENT, textually invisible
 * instance of the same bug class: an inline
 * scopedRead((rtx) => rtx.select()...) read of hrmsEmployees, written
 * directly in the consumer (not through a repo function, so invisible to a
 * repo-name-based scanner) from INSIDE the already-open outer
 * db.transaction() -- found only by manually tracing the transaction body
 * per the skill doc gotcha on bare/inline scopedRead calls.
 *
 * Fixed by replacing the inline scopedRead(...) employee read with a direct
 * read through the already-open tx. This test exercises
 * deputation_routes__0 (depute employee out) at pool.max + concurrency,
 * real Postgres, real pool.
 */
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant, withTenantScope } from "@civitasone/db";
import { db } from "../src/shared/db.js";
import { registerF3_deputation_Consumers } from "../src/modules/deputation/f3-consumer.js";
import { hrmsDeputations } from "../src/modules/deputation/schema.js";
import { hrmsEmployees } from "../src/modules/employee/schema.js";
import { hrmsServiceBookEntries } from "../src/modules/service-book/schema.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "f0000000-dead-4000-8000-00000000c0de";
const ACTOR = "f0000000-dead-4000-8000-0000000ac70a";
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

async function seedEmployee(): Promise<{ employeeId: string; parentDepartmentId: string }> {
  const employeeId = randomUUID();
  const parentDepartmentId = randomUUID();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await withTenantScope(db, TENANT, (tx: any) => tx.insert(hrmsEmployees).values({
    id: employeeId, tenantId: TENANT, employeeNo: `TEST-${employeeId.slice(0, 8)}`,
    fullName: "Test Employee", departmentId: parentDepartmentId, designationId: randomUUID(),
    dateOfJoining: "2020-01-01", createdBy: ACTOR, updatedBy: ACTOR,
  }));
  return { employeeId, parentDepartmentId };
}

describe("deputation f3-consumer -- nested-transaction pool-exhaustion deadlock (real DB, no mocks)", () => {
  it(
    `${CONCURRENCY} concurrent deputation_routes__0 (depute out) commands drain without deadlocking the connection pool`,
    async () => {
      const seeded: Array<{ employeeId: string; parentDepartmentId: string; depId: string; borrowingDepartmentId: string }> = [];
      for (let i = 0; i < CONCURRENCY; i++) {
        const { employeeId, parentDepartmentId } = await seedEmployee();
        seeded.push({ employeeId, parentDepartmentId, depId: randomUUID(), borrowingDepartmentId: randomUUID() });
      }

      const q = tenantWrappedQueue();
      registerF3_deputation_Consumers(q);
      await q.start();

      await Promise.all(seeded.map(({ employeeId, depId, borrowingDepartmentId }) =>
        q.publish(COMMANDS.f3RouteWrite, makeMsg({
          op: "deputation_routes__0", tenantId: TENANT, id: depId, params: { id: employeeId },
          body: {
            parentCadre: "Central Secretariat Service",
            borrowingDepartment: "Digital India Corporation",
            borrowingDepartmentId,
            deputationAllowanceMinor: 500000,
            tenureFrom: "2027-01-01", tenureTo: "2029-12-31",
          },
        })),
      ));

      const DRAIN_TIMEOUT_MS = 10_000;
      let timedOut = false;
      await Promise.race([
        q.drain(),
        new Promise<void>((resolve) => setTimeout(() => { timedOut = true; resolve(); }, DRAIN_TIMEOUT_MS)),
      ]);

      expect(timedOut, `queue did not drain within ${DRAIN_TIMEOUT_MS}ms -- nested-transaction pool deadlock regressed`).toBe(false);
      expect(q.dlq, `dlq should be empty, got: ${JSON.stringify(q.dlq)}`).toHaveLength(0);

      // Real DB state: every deputation row inserted with the parent-cadre
      // snapshot correctly captured off the just-read employee row, the
      // employee switched to the borrowing department, and a matching
      // service-book entry recorded (proves the fixed inline employee read
      // resolved the real row inside the transaction).
      for (const { employeeId, parentDepartmentId, depId, borrowingDepartmentId } of seeded) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const depRows = await withTenantScope(db, TENANT, (tx: any) =>
          tx.select().from(hrmsDeputations).where(eq(hrmsDeputations.id, depId)));
        expect(depRows[0]?.status).toBe("active");
        expect(depRows[0]?.parentDepartmentId).toBe(parentDepartmentId);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const empRows = await withTenantScope(db, TENANT, (tx: any) =>
          tx.select().from(hrmsEmployees).where(eq(hrmsEmployees.id, employeeId)));
        expect(empRows[0]?.departmentId).toBe(borrowingDepartmentId);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sbRows = await withTenantScope(db, TENANT, (tx: any) =>
          tx.select().from(hrmsServiceBookEntries).where(and(
            eq(hrmsServiceBookEntries.employeeId, employeeId),
            eq(hrmsServiceBookEntries.entryType, "deputation_out"),
          )));
        expect(sbRows).toHaveLength(1);
      }

      await q.stop();
    },
    { timeout: 20_000 },
  );
});
