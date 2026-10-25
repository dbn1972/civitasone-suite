/**
 * V4-D-01 regression: `finance.payment.made` (outcome=success) is emitted only AFTER the bank file has actually been
 * handed to the PFMS gateway -- never at batch-creation time.
 *
 * Grant disbursements ('completed') and payroll slips ('paid') treat finance.payment.made/success as "money moved".
 * Before the fix the EFT-initiate handler enqueued it in the same transaction that inserted the *pending* PFMS batch,
 * so a production-blocked (unsigned) batch or a failed SFTP upload still told downstream services the beneficiary was
 * paid.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant, withTenantScope } from "@civitasone/db";
import { db } from "../src/shared/db.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { financePfms } from "../src/modules/payments/schema.js";
import { registerIntegrationConsumers } from "../src/modules/integrations/consumer.js";
import { CONSUMED_EVENTS, EVENTS } from "../src/topics.js";

const { uploadBankFileMock } = vi.hoisted(() => ({ uploadBankFileMock: vi.fn() }));
vi.mock("../src/modules/integrations/sftp-egress.js", () => ({
  uploadBankFile: (...args: unknown[]) => uploadBankFileMock(...args),
}));

const ACTOR = "bb000001-ec00-4000-8000-0000000000d1";

function tenantWrappedQueue(): MemoryQueue {
  const q = new MemoryQueue();
  const rawSubscribe = q.subscribe.bind(q);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (q as any).subscribe = (topic: string, handler: (msg: any) => Promise<void>, o?: unknown) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (rawSubscribe as any)(topic, (msg: any) => runWithTenant(msg.tenantId, () => handler(msg)), o);
  return q;
}

async function initiate(tenant: string, extra: Record<string, unknown>) {
  const pfmsTxnId = `EFT-${randomUUID().slice(0, 8)}`;
  const q = tenantWrappedQueue();
  registerIntegrationConsumers(q);
  await q.start();
  await q.publish(CONSUMED_EVENTS.eftInitiate, {
    messageId: randomUUID(), type: CONSUMED_EVENTS.eftInitiate, tenantId: tenant, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0",
    payload: { amountMinor: "125000", currency: "INR", pfmsTxnId, mode: "NEFT", beneficiaryBankRef: "SBIN0001234:123456789012", ...extra },
  });
  await q.drain();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = await withTenantScope(db, tenant, (tx: any) => tx.select().from(financePfms).where(and(eq(financePfms.tenantId, tenant), eq(financePfms.pfmsId, pfmsTxnId))));
  return { batch: rows[0]!, pfmsTxnId };
}

async function paymentMade(tenant: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = await withTenantScope(db, tenant, (tx: any) => tx.select().from(outboxMessages)
    .where(and(eq(outboxMessages.tenantId, tenant), eq(outboxMessages.topic, EVENTS.paymentMade))));
  return rows as Array<{ payload: Record<string, unknown> }>;
}

describe("V4-D-01 -- payment.made follows actual egress", () => {
  beforeEach(() => { uploadBankFileMock.mockReset(); uploadBankFileMock.mockResolvedValue("/remote/NACH.txt"); });
  afterEach(() => vi.unstubAllEnvs());

  it("production + unsigned batch (egress blocked): batch stays pending and NO payment.made is emitted", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const tenant = randomUUID();
    const { batch } = await initiate(tenant, { disbursementId: randomUUID() });
    expect(batch.submissionStatus).toBe("pending");
    expect(uploadBankFileMock).not.toHaveBeenCalled();
    expect(await paymentMade(tenant)).toHaveLength(0);
  });

  it("SFTP upload failure: batch stays pending and NO payment.made is emitted", async () => {
    uploadBankFileMock.mockRejectedValue(new Error("ECONNREFUSED"));
    const tenant = randomUUID();
    const { batch } = await initiate(tenant, { payrollRunId: randomUUID() });
    expect(batch.submissionStatus).toBe("pending");
    expect(await paymentMade(tenant)).toHaveLength(0);
  });

  it("file handed to the gateway: batch is file_sent and exactly one payment.made/success is emitted with the same ids", async () => {
    const tenant = randomUUID();
    const disbursementId = randomUUID();
    const { batch, pfmsTxnId } = await initiate(tenant, { disbursementId });
    expect(batch.submissionStatus).toBe("file_sent");
    const events = await paymentMade(tenant);
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toMatchObject({ disbursementId, pfmsTxnId, amountMinor: "125000", mode: "NEFT", outcome: "success" });
  });
});
