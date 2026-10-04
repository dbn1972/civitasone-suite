/**
 * GAP-FINANCE-PFMS-01 -- production egress gate: the EFT-initiate path never releases an unsigned batch to the PFMS
 * gateway in production; outside production it is unchanged (sandbox flows keep working, mock-labelled).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant, withTenantScope } from "@civitasone/db";
import { db } from "../src/shared/db.js";
import { financePfms } from "../src/modules/payments/schema.js";
import { registerIntegrationConsumers } from "../src/modules/integrations/consumer.js";
import { CONSUMED_EVENTS } from "../src/topics.js";
import { auditRows } from "./_fp02.js";

const ACTOR = "bb000001-ec00-4000-8000-0000000000bb";

function tenantWrappedQueue(): MemoryQueue {
  const q = new MemoryQueue();
  const rawSubscribe = q.subscribe.bind(q);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (q as any).subscribe = (topic: string, handler: (msg: any) => Promise<void>, o?: unknown) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (rawSubscribe as any)(topic, (msg: any) => runWithTenant(msg.tenantId, () => handler(msg)), o);
  return q;
}

async function initiate(tenant: string, pfmsTxnId: string) {
  const q = tenantWrappedQueue();
  registerIntegrationConsumers(q);
  await q.start();
  await q.publish(CONSUMED_EVENTS.eftInitiate, {
    messageId: randomUUID(), type: CONSUMED_EVENTS.eftInitiate, tenantId: tenant, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0",
    payload: { disbursementId: randomUUID(), amountMinor: "125000", currency: "INR", pfmsTxnId, mode: "NEFT", beneficiaryBankRef: "SBIN0001234:123456789012" },
  });
  await q.drain();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = await withTenantScope(db, tenant, (tx: any) => tx.select().from(financePfms).where(and(eq(financePfms.tenantId, tenant), eq(financePfms.pfmsId, pfmsTxnId))));
  return rows[0]!;
}

describe("PFMS egress gate (EFT initiate)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("production: an unsigned batch is NOT sent; it stays pending and the refusal is audited", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const tenant = randomUUID();
    const row = await initiate(tenant, `EFT-${randomUUID().slice(0, 8)}`);
    expect(row.submissionStatus).toBe("pending");
    const blocked = await auditRows(tenant, "send_blocked", row.id);
    expect(blocked).toHaveLength(1);
    expect(blocked[0]!.payload).toMatchObject({ outcome: "denied", details: { code: "UNSIGNED_BATCH" } });
  });

  it("fail closed: an UNSET or unexpected NODE_ENV (empty, staging) also blocks an unsigned batch; PFMS_SANDBOX=true opts a non-production env out", async () => {
    for (const v of ["", "staging"]) {
      vi.stubEnv("NODE_ENV", v);
      const tenant = randomUUID();
      const row = await initiate(tenant, `EFT-${randomUUID().slice(0, 8)}`);
      expect(row.submissionStatus, v).toBe("pending");
      expect(await auditRows(tenant, "send_blocked", row.id), v).toHaveLength(1);
    }
    vi.stubEnv("NODE_ENV", "staging");
    vi.stubEnv("PFMS_SANDBOX", "true");
    const tenant = randomUUID();
    const row = await initiate(tenant, `EFT-${randomUUID().slice(0, 8)}`);
    expect(row.submissionStatus).toBe("file_sent");
  });

  it("outside production the sandbox flow is unchanged: the batch is released (file_sent) and nothing is blocked", async () => {
    const tenant = randomUUID();
    const row = await initiate(tenant, `EFT-${randomUUID().slice(0, 8)}`);
    expect(row.submissionStatus).toBe("file_sent");
    expect(await auditRows(tenant, "send_blocked", row.id)).toHaveLength(0);
  });
});
