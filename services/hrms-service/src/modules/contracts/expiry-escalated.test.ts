/**
 * V4-D-06 -- the contract expiry detector must keep processing contracts it
 * has itself escalated. Real Postgres, no mocks of the detector.
 */
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant, withTenantScope } from "@civitasone/db";
import { eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { registerContractExpiryConsumers } from "./expiry-consumer.js";
import { hrmsContracts, hrmsContractNotifications } from "./schema.js";
import { isValidTransition } from "./domain.js";
import { COMMANDS } from "../../topics.js";

const TENANT = randomUUID();
const ACTOR = randomUUID();

function dayOffset(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

async function seed(status: string, endDate: string): Promise<string> {
  const id = randomUUID();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await withTenantScope(db, TENANT, (tx: any) =>
    tx.insert(hrmsContracts).values({
      id, tenantId: TENANT, employeeId: randomUUID(),
      contractNo: `V4D06-${id.slice(0, 8)}`, startDate: "2024-01-01", endDate,
      status, createdBy: ACTOR, updatedBy: ACTOR,
    }),
  );
  return id;
}

async function runDetector(): Promise<void> {
  const q = new MemoryQueue();
  const raw = q.subscribe.bind(q);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (q as any).subscribe = (topic: string, h: (m: any) => Promise<void>) =>
    raw(topic, async (m: any) => { await runWithTenant(m.tenantId, () => h(m)); });
  registerContractExpiryConsumers(q);
  await q.start();
  await q.publish(COMMANDS.contractExpiryDetect, {
    messageId: randomUUID(), type: COMMANDS.contractExpiryDetect, tenantId: TENANT, actorId: ACTOR,
    correlationId: randomUUID(), schemaVersion: "1.0", payload: { tenantId: TENANT },
  });
  await q.drain();
}

async function statusOf(id: string): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (await withTenantScope(db, TENANT, (tx: any) =>
    tx.select().from(hrmsContracts).where(eq(hrmsContracts.id, id)))) as Array<{ status: string }>;
  return rows[0]!.status;
}

describe("V4-D-06 -- expiry detector handles escalated contracts", () => {
  it("state machine allows escalated -> expired", () => {
    expect(isValidTransition("escalated", "expired")).toBe(true);
  });

  it("auto-expires an escalated contract whose end date has passed", async () => {
    const id = await seed("escalated", dayOffset(-1));
    await runDetector();
    expect(await statusOf(id)).toBe("expired");
  });

  it("keeps sending milestones for an escalated contract still inside the window", async () => {
    const id = await seed("escalated", dayOffset(5));
    await runDetector();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = (await withTenantScope(db, TENANT, (tx: any) =>
      tx.select().from(hrmsContractNotifications).where(eq(hrmsContractNotifications.contractId, id)))) as Array<{ milestone: number }>;
    expect(rows.map((r) => r.milestone)).toContain(7);
    expect(await statusOf(id)).toBe("escalated");
  });
});
