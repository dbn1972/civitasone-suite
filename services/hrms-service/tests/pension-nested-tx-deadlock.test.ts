/**
 * hrms-service pension f3-consumer nested-transaction connection-pool
 * deadlock regression. Found via
 * .claude/skills/16-production-readiness-audit.md section 1:
 * pension_routes__0 (pension/f3-consumer.ts) had TWO independent
 * nested-transaction call sites inside the same already-open outer
 * db.transaction():
 *
 *  1. A cross-module call to scopedRead-based
 *     serviceBookRepo.listServiceBookEntries (defined in
 *     service-book/repo.ts) -- the finding the scanner flagged by name.
 *  2. An inline scopedRead((rtx) => rtx.select()...) read of hrmsEmployees,
 *     written directly in the consumer rather than through a repo function --
 *     textually invisible to a repo-name-based scanner, found only by
 *     manually tracing the transaction body per the skill doc gotcha on
 *     bare/inline scopedRead calls.
 *
 * Either one alone is enough to deadlock the pool once concurrency reaches
 * pool.max, so both had to be fixed together for this consumer to be safe.
 *
 * Fixed by adding serviceBookRepo.listServiceBookEntriesTx(tx, ...) in
 * service-book/repo.ts and routing the cross-module call onto it, and by
 * replacing the inline scopedRead(...) employee read with a direct read
 * through the already-open tx. This test exercises pension_routes__0 at
 * pool.max + concurrency, real Postgres, real pool.
 */
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant, withTenantScope } from "@civitasone/db";
import { db } from "../src/shared/db.js";
import { registerF3_pension_Consumers } from "../src/modules/pension/f3-consumer.js";
import { hrmsPensionRecords } from "../src/modules/pension/schema.js";
import { hrmsEmployees } from "../src/modules/employee/schema.js";
import { hrmsServiceBookEntries } from "../src/modules/service-book/schema.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "e0000000-dead-4000-8000-00000000c0de";
const ACTOR = "e0000000-dead-4000-8000-0000000ac70a";
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

async function seedGpfEmployee(): Promise<string> {
  const employeeId = randomUUID();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await withTenantScope(db, TENANT, (tx: any) => tx.insert(hrmsEmployees).values({
    id: employeeId, tenantId: TENANT, employeeNo: `TEST-${employeeId.slice(0, 8)}`,
    fullName: "Test Employee", departmentId: randomUUID(), designationId: randomUUID(),
    dateOfJoining: "1995-01-01", dateOfBirth: "1970-01-01",
    pensionScheme: "GPF", basicMinor: 5_000_00n,
    createdBy: ACTOR, updatedBy: ACTOR,
  }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await withTenantScope(db, TENANT, (tx: any) => tx.insert(hrmsServiceBookEntries).values({
    tenantId: TENANT, employeeId, entryType: "promotion", effectiveDate: "2010-06-01",
    description: "Promoted to Senior Grade", recordedBy: ACTOR,
  }));
  return employeeId;
}

describe("pension f3-consumer -- nested-transaction pool-exhaustion deadlock (real DB, no mocks)", () => {
  it(
    `${CONCURRENCY} concurrent pension_routes__0 (compute + persist) commands drain without deadlocking the connection pool`,
    async () => {
      const employeeIds: string[] = [];
      for (let i = 0; i < CONCURRENCY; i++) {
        employeeIds.push(await seedGpfEmployee());
      }

      const q = tenantWrappedQueue();
      registerF3_pension_Consumers(q);
      await q.start();

      await Promise.all(employeeIds.map((employeeId) =>
        q.publish(COMMANDS.f3RouteWrite, makeMsg({
          op: "pension_routes__0", tenantId: TENANT, params: { id: employeeId }, body: {},
          query: { retirementDate: "2030-01-01" },
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

      // Real DB state: every employee must have a persisted, defined-benefit
      // pension record (proves both the employee read and the service-book
      // read resolved correctly inside the transaction).
      for (const employeeId of employeeIds) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rows = await withTenantScope(db, TENANT, (tx: any) =>
          tx.select().from(hrmsPensionRecords).where(eq(hrmsPensionRecords.employeeId, employeeId)));
        expect(rows).toHaveLength(1);
        expect(rows[0]?.pensionScheme).toBe("GPF");
        expect(BigInt(rows[0]?.monthlyPensionMinor ?? 0)).toBeGreaterThan(0n);
      }

      await q.stop();
    },
    { timeout: 20_000 },
  );
});
