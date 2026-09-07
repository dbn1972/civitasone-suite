/**
 * hrms-service consultant-invoice module nested-transaction connection-pool
 * deadlock regression. Found via
 * .claude/skills/16-production-readiness-audit.md section 1:
 * consultant_invoice_routes__2 (f3-consumer.ts) called scopedRead-based
 * repo.findInvoice from INSIDE its own already-open outer db.transaction()
 * -- a second transaction competing for a connection from the same pool as
 * the outer one (plus the advisory-lock `lockConsultantForInvoicing` +
 * `ytdApprovedGrossTx` calls, which already correctly read through the
 * caller's tx), deadlocking every in-flight command once concurrency
 * reaches pool.max.
 *
 * Fixed by routing findInvoice onto findInvoiceTx (repo.ts), reading
 * through the caller's already-open tx. This test exercises
 * consultant_invoice_routes__2 (approve) -- the case with the most
 * additional work inside the transaction after the fixed read (advisory
 * lock, YTD aggregate, GST/194J computation) -- at pool.max + concurrency,
 * real Postgres, real pool.
 */
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant, withTenantScope } from "@civitasone/db";
import { db } from "../src/shared/db.js";
import { registerF3_consultant_invoice_Consumers } from "../src/modules/consultant-invoice/f3-consumer.js";
import { hrmsConsultantInvoices } from "../src/modules/consultant-invoice/schema.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "c2000000-dead-4000-8000-00000000c0de";
const ACTOR = "c2000000-dead-4000-8000-0000000ac70a";
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

describe("consultant-invoice consumer -- nested-transaction pool-exhaustion deadlock (real DB, no mocks)", () => {
  it(
    `${CONCURRENCY} concurrent consultant_invoice_routes__2 (approve) commands drain without deadlocking the connection pool`,
    async () => {
      const invoiceIds: string[] = [];
      for (let i = 0; i < CONCURRENCY; i++) {
        const consultantId = randomUUID();
        const invoiceId = randomUUID();
        invoiceIds.push(invoiceId);
        // Distinct consultant per invoice so 13 concurrent approvals don't
        // serialize against each other's advisory lock for an unrelated reason.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await withTenantScope(db, TENANT, (tx: any) =>
          tx.insert(hrmsConsultantInvoices).values({
            id: invoiceId, tenantId: TENANT, consultantId,
            invoiceNo: `INV-${invoiceId.slice(0, 8)}`, invoiceDate: "2026-09-01",
            grossMinor: 5_000_000n, gstApplicable: false, tdsRateBps: 1000,
            status: "submitted", createdBy: ACTOR, updatedBy: ACTOR,
          }),
        );
      }

      const q = tenantWrappedQueue();
      registerF3_consultant_invoice_Consumers(q);
      await q.start();

      await Promise.all(invoiceIds.map((invId) =>
        q.publish(COMMANDS.f3RouteWrite, makeMsg({
          op: "consultant_invoice_routes__2", tenantId: TENANT,
          params: { invId }, body: {},
        })),
      ));

      const DRAIN_TIMEOUT_MS = 10_000;
      let timedOut = false;
      await Promise.race([
        q.drain(),
        new Promise<void>((resolve) => setTimeout(() => { timedOut = true; resolve(); }, DRAIN_TIMEOUT_MS)),
      ]);

      expect(timedOut, `queue did not drain within ${DRAIN_TIMEOUT_MS}ms -- nested-transaction pool deadlock regressed`).toBe(false);

      // MemoryQueue.deliver() swallows handler errors into q.dlq instead of
      // rejecting -- assert the DLQ is empty so a silent per-command failure
      // can't hide behind a "drained" result.
      expect(q.dlq, `handler errors were swallowed into the DLQ: ${JSON.stringify(q.dlq)}`).toHaveLength(0);

      for (const invoiceId of invoiceIds) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rows = await withTenantScope(db, TENANT, (tx: any) =>
          tx.select().from(hrmsConsultantInvoices)
            .where(and(eq(hrmsConsultantInvoices.tenantId, TENANT), eq(hrmsConsultantInvoices.id, invoiceId))),
        );
        const row = rows[0];
        expect(row?.status).toBe("approved");
        expect(row?.tdsMinor).toBeGreaterThan(0n);
      }

      await q.stop();
    },
    { timeout: 20_000 },
  );
});
