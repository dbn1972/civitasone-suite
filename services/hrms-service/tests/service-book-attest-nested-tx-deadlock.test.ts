/**
 * hrms-service service-book consumer nested-transaction connection-pool
 * deadlock regression. Found via
 * .claude/skills/16-production-readiness-audit.md section 1:
 * COMMANDS.serviceBookVerify (service-book/consumer.ts) called
 * repo.attestEntry from INSIDE its own already-open outer db.transaction().
 * attestEntry opened its own RAW db.transaction() internally (not
 * scopedRead, but the identical bug shape -- see the skill doc note on
 * equivalent transaction-opening helpers under a different name) -- a
 * second transaction competing for a connection from the same pool as the
 * outer one, deadlocking every in-flight command once concurrency reaches
 * pool.max.
 *
 * Fixed by adding repo.attestEntryTx(tx, ...), reading/writing through the
 * already-open tx, and routing the consumer onto it. This test exercises
 * COMMANDS.serviceBookVerify at pool.max + concurrency, real Postgres, real
 * pool.
 */
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant, withTenantScope } from "@civitasone/db";
import { db } from "../src/shared/db.js";
import { registerServiceBookConsumers } from "../src/modules/service-book/consumer.js";
import { hrmsServiceBookEntries } from "../src/modules/service-book/schema.js";
import { hrmsEmployees } from "../src/modules/employee/schema.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "a1000000-dead-4000-8000-00000000c0de";
const ACTOR = "a1000000-dead-4000-8000-0000000ac70a";
const VERIFIER = "a1000000-dead-4000-8000-0000000ac70b";
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
    messageId: randomUUID(), type: COMMANDS.serviceBookVerify, tenantId: TENANT, actorId: VERIFIER,
    correlationId: randomUUID(), schemaVersion: "1.0", payload,
  };
}

async function seedUnattestedEntry(): Promise<string> {
  const entryId = randomUUID();
  const employeeId = randomUUID();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await withTenantScope(db, TENANT, (tx: any) => tx.insert(hrmsEmployees).values({
    id: employeeId, tenantId: TENANT, employeeNo: `TEST-${employeeId.slice(0, 8)}`,
    fullName: "Test Employee", departmentId: randomUUID(), designationId: randomUUID(),
    dateOfJoining: "2020-01-01", createdBy: ACTOR, updatedBy: ACTOR,
  }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await withTenantScope(db, TENANT, (tx: any) => tx.insert(hrmsServiceBookEntries).values({
    id: entryId, tenantId: TENANT, employeeId, entryType: "increment", effectiveDate: "2026-04-01",
    description: "Annual increment", recordedBy: ACTOR, attested: false,
  }));
  return entryId;
}

describe("service-book consumer -- nested-transaction pool-exhaustion deadlock (real DB, no mocks)", () => {
  it(
    `${CONCURRENCY} concurrent serviceBookVerify commands drain without deadlocking the connection pool`,
    async () => {
      const entryIds: string[] = [];
      for (let i = 0; i < CONCURRENCY; i++) {
        entryIds.push(await seedUnattestedEntry());
      }

      const q = tenantWrappedQueue();
      registerServiceBookConsumers(q);
      await q.start();

      await Promise.all(entryIds.map((entryId) =>
        q.publish(COMMANDS.serviceBookVerify, makeMsg({
          id: randomUUID(), tenantId: TENANT, entryId, remarks: "Verified per attendance register",
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

      // Real DB state: every entry actually attested (proves attestEntryTx
      // performed the real UPDATE inside the transaction).
      for (const entryId of entryIds) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rows = await withTenantScope(db, TENANT, (tx: any) =>
          tx.select().from(hrmsServiceBookEntries).where(eq(hrmsServiceBookEntries.id, entryId)));
        expect(rows[0]?.attested).toBe(true);
        expect(rows[0]?.attestedBy).toBe(VERIFIER);
      }

      await q.stop();
    },
    { timeout: 20_000 },
  );
});
