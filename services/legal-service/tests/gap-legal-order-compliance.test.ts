import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MemoryQueue } from "@civitasone/queue";
import type { Queue, Handler } from "@civitasone/queue";
import { eq } from "drizzle-orm";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { legalCases } from "../src/modules/cases/schema.js";
import { legalOrders } from "../src/modules/hearings/schema.js";
import { processed } from "../src/shared/outbox.js";
import { registerHearingConsumers } from "../src/modules/hearings/consumer.js";
import { listCourtOrderSummaries } from "../src/modules/hearings/queries.js";
import { COMMANDS } from "../src/topics.js";

/**
 * GAP-LEGAL-COURT-ORDERS-NEW-01: an order recorded with complianceRequired +
 * complianceDeadline persists those fields, so the court-orders list (which
 * drives Compliance-Due / Contempt-Risk) can surface it as due/at-risk —
 * previously impossible (no columns, deadline always null).
 */

const ACTOR = "00000000-aaaa-4000-8000-000000000055";
const TENANT = "11111111-aaaa-4000-8000-000000000055";
const CASE_1 = "22222222-bbbb-4000-8000-000000000055";
const ORDER_1 = "33333333-cccc-4000-8000-000000000055";
const MSG_1 = "44444444-dddd-4000-8000-000000000055";

function wireTenantAwareQueue(q: Queue): Queue {
  const rawSubscribe = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    rawSubscribe(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  return q;
}

let queue: Queue;

beforeAll(async () => {
  queue = wireTenantAwareQueue(new MemoryQueue());
  registerHearingConsumers(queue);
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(legalOrders).where(eq(legalOrders.tenantId, TENANT));
    await tx.delete(legalCases).where(eq(legalCases.tenantId, TENANT));
    await tx.delete(processed).where(eq(processed.messageId, MSG_1));
    await tx.insert(legalCases).values({
      id: CASE_1, tenantId: TENANT, caseNo: "WP/CMP/2026",
      title: "Compliance test", court: "High Court", status: "pending",
      createdBy: ACTOR, updatedBy: ACTOR,
    });
  }));
});

afterAll(async () => { await sqlClient.end(); });

describe("record order compliance fields (GAP-LEGAL-COURT-ORDERS-NEW-01)", () => {
  it("persists complianceRequired + complianceDeadline and surfaces them in the list", async () => {
    await queue.start();
    await queue.publish(COMMANDS.orderRecord, {
      messageId: MSG_1, type: COMMANDS.orderRecord,
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-1", schemaVersion: "1.0",
      payload: {
        id: ORDER_1, caseId: CASE_1, tenantId: TENANT, orderType: "direction",
        summary: "Comply within 30 days", orderDate: "2026-02-01",
        complianceRequired: true, complianceDeadline: "2026-03-03",
      },
    });
    await new Promise<void>((r) => setTimeout(r, 300));
    await queue.stop();

    const row = await runWithTenant(TENANT, () => db.transaction(async (tx) => {
      const rows = await tx.select().from(legalOrders).where(eq(legalOrders.id, ORDER_1)).limit(1);
      return rows[0];
    }));
    expect(row?.complianceRequired).toBe(true);
    expect(row?.complianceDeadline).toBe("2026-03-03");

    const summaries = await runWithTenant(TENANT, () => listCourtOrderSummaries(TENANT, 50));
    const found = summaries.find((s) => s.id === ORDER_1);
    expect(found?.complianceRequired).toBe(true);
    expect(found?.complianceDeadline).toBe("2026-03-03");
  });
});
