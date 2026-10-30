/**
 * F67 regression: audit-service publishes `audit.para.pending_recovery` when a para moves to
 * pending_recovery; finance-service must add it to its audit-para register (audit.finance_audit_paras).
 *
 * The handler used to insert status 'pending_recovery', which the table's CHECK
 * (open | responded | settled | escalated | dropped, migrations/0036) rejects, so every event threw,
 * rolled back its markProcessed and was retried until dead-lettered: no recovery ever reached the
 * register. It now lands as an 'open' para (the entry state of the finance respond / escalate / settle
 * workflow) carrying the recoverable amount, keyed on the full audit-service paraId so a redelivery
 * (or a second messageId for the same para) is a no-op instead of a unique-violation retry loop.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { MemoryQueue } from "@civitasone/queue";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerIntegrationConsumers } from "../src/modules/integrations/consumer.js";
import { financeAuditParas } from "../src/modules/audit/schema.js";
import { CONSUMED_EVENTS } from "../src/topics.js";
import { scoped } from "./_tenant.js";
import { auditRows, wipeOutbox } from "./_fp02.js";

const T = "aaaaaaaa-0f67-4000-8000-000000000067";
const ACTOR = "00000000-0f67-4000-8000-0000000000a1";
const TOPIC = CONSUMED_EVENTS.auditParaPendingRecovery;
const mq = queue as unknown as MemoryQueue;

async function publish(paraId: string, amountInvolvedMinor: string, deptRef = "PWD") {
  await queue.publish(TOPIC, {
    messageId: randomUUID(), type: TOPIC, schemaVersion: "1.0", tenantId: T, actorId: ACTOR, correlationId: `f67-${paraId.slice(-4)}`,
    payload: { paraId, deptRef, amountInvolvedMinor },
  } as never);
  await mq.drain();
}
const rows = () => scoped(T, (tx) => tx.select().from(financeAuditParas).where(eq(financeAuditParas.tenantId, T)));
const dlqFor = () => mq.dlq.filter((d) => d.topic === TOPIC && d.msg.tenantId === T);

async function cleanup() {
  await scoped(T, (tx) => tx.delete(financeAuditParas).where(eq(financeAuditParas.tenantId, T)));
  await wipeOutbox(T);
}
beforeAll(async () => { await cleanup(); registerIntegrationConsumers(queue); await queue.start(); });
afterAll(async () => { await cleanup(); await sqlClient.end(); });

describe("audit.para.pending_recovery -> finance audit-para register", () => {
  it("writes an open register row with the recoverable amount (not dead-lettered on the status CHECK)", async () => {
    const paraId = "6f670000-0000-4000-8000-000000000001";
    await publish(paraId, "12345678901");
    expect(dlqFor()).toEqual([]);
    const r = await rows();
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({
      tenantId: T, paraNo: `AUDIT-${paraId}`, source: "internal", dept: "PWD",
      moneyValueMinor: 12345678901n, currency: "INR", status: "open", createdBy: ACTOR, updatedBy: ACTOR,
    });
    expect(await auditRows(T, "recovery_flag", paraId)).toHaveLength(1);
  });

  it("is idempotent per paraId: a re-publish under a new messageId adds no row and does not dead-letter", async () => {
    const paraId = "6f670000-0000-4000-8000-000000000001";
    await publish(paraId, "12345678901");
    expect(dlqFor()).toEqual([]);
    expect(await rows()).toHaveLength(1);
  });

  it("two paras sharing the first 8 uuid chars get distinct register rows", async () => {
    await publish("6f670000-0000-4000-8000-000000000002", "500", "Health");
    expect(dlqFor()).toEqual([]);
    const r = await rows();
    expect(r).toHaveLength(2);
    expect(r.find((x) => x.paraNo === "AUDIT-6f670000-0000-4000-8000-000000000002")).toMatchObject({ dept: "Health", moneyValueMinor: 500n, status: "open" });
  });
});
