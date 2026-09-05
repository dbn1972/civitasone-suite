/**
 * billing-service checkout-verify nested-transaction connection-pool
 * deadlock regression. Found via
 * .claude/skills/16-production-readiness-audit.md section 1:
 * checkoutVerify/webhookRazorpay (payments/consumer.ts) called
 * subsRepo.findByTenant -- scopedRead-based, and worse than most instances
 * tonight: it opens up to TWO nested transactions per call (subscription
 * row, then trial row) -- from INSIDE their own already-open outer
 * db.transaction(). Real Razorpay payment-gateway processing (checkout
 * verification and server-to-server webhooks) -- concurrent webhook
 * deliveries across many tenants (e.g. a billing-cycle renewal wave) is a
 * realistic trigger. Same shape as notification-service (#1028),
 * building-service (#1035), payroll-service (#1042, #1048),
 * finance-service (#1043), hrms-service (#1045, #1047), grant-service
 * (#1049).
 *
 * Fixed by routing onto findByTenantTx, reading through the caller's
 * already-open tx.
 */
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant, withTenantScope } from "@civitasone/db";
import { db } from "../src/shared/db.js";
import { registerPaymentsConsumers } from "../src/modules/payments/consumer.js";
import { billingSubscriptions, billingTrials } from "../src/modules/subscriptions/schema.js";
import { COMMANDS } from "../src/topics.js";

const ACTOR = "d0000000-dead-4000-8000-0000000ac70a";
const CONCURRENCY = 13; // pool.max (10) + 3

function tenantWrappedQueue(): MemoryQueue {
  const q = new MemoryQueue();
  const rawSubscribe = q.subscribe.bind(q);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (q as any).subscribe = (topic: string, handler: (msg: any) => Promise<void>) =>
    rawSubscribe(topic, (msg: any) => runWithTenant(msg.tenantId, () => handler(msg)));
  return q;
}

function makeMsg(tenantId: string, type: string, payload: Record<string, unknown>) {
  return { messageId: randomUUID(), type, tenantId, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0", payload };
}

describe("billing checkoutVerify -- nested-transaction pool-exhaustion deadlock (real DB, no mocks)", () => {
  it(
    `${CONCURRENCY} concurrent checkoutVerify commands (each with a real subscription + trial row) drain without deadlocking the connection pool`,
    async () => {
      const tenantIds: string[] = [];
      for (let i = 0; i < CONCURRENCY; i++) {
        const tenantId = randomUUID();
        const subId = randomUUID();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await withTenantScope(db, tenantId, (tx: any) => tx.insert(billingSubscriptions).values({
          id: subId, tenantId, planId: randomUUID(), status: "trial",
          createdBy: ACTOR, updatedBy: ACTOR,
        }));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await withTenantScope(db, tenantId, (tx: any) => tx.insert(billingTrials).values({
          id: randomUUID(), tenantId, subscriptionId: subId,
          expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
          createdBy: ACTOR, updatedBy: ACTOR,
        }));
        tenantIds.push(tenantId);
      }

      const q = tenantWrappedQueue();
      registerPaymentsConsumers(q);
      await q.start();

      await Promise.all(tenantIds.map((tenantId) =>
        q.publish(COMMANDS.checkoutVerify, makeMsg(tenantId, COMMANDS.checkoutVerify, {
          razorpayOrderId: `order_${randomUUID().slice(0, 8)}`,
          razorpayPaymentId: `pay_${randomUUID().slice(0, 8)}`,
          razorpaySignature: "sig",
        })),
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
