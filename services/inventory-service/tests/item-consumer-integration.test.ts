import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { items } from "../src/modules/items/schema.js";
import { registerItemConsumers } from "../src/modules/items/consumer.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "ee001111-1111-4000-8000-0000000e0101";
const ACTOR = "ee00aaaa-1111-4000-8000-0000000e010a";
const ITEM_ID = "ee002222-1111-4000-8000-0000000e0201";
const ids = new Set<string>();

async function cleanup() {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(items).where(eq(items.tenantId, TENANT));
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
  }));
  if (ids.size > 0) { await db.delete(processed).where(inArray(processed.messageId, [...ids])); ids.clear(); }
}

const payload = {
  id: ITEM_ID, tenantId: TENANT, name: "Office Paper A4", itemType: "consumable",
  reorderLevel: 100, reorderQty: 500, valuationMethod: "WAVG",
  unitCostMinor: 250, currency: "INR", requiresBatchTracking: false, requiresSerialTracking: false,
};

beforeAll(cleanup);
afterAll(async () => { await cleanup(); await sqlClient.end(); });

describe("item consumer — with tenantScoped fix", () => {
  beforeEach(cleanup);

  it("creates item row + audit outbox event (RLS passes with tenantScoped)", async () => {
    ids.add("ee003333-1111-4000-8000-0000000e0301");
    const q = new MemoryQueue();
    registerItemConsumers(q);
    await q.start();
    await q.publish(COMMANDS.itemCreate, { messageId: "ee003333-1111-4000-8000-0000000e0301", type: COMMANDS.itemCreate, tenantId: TENANT, actorId: ACTOR, correlationId: "c", schemaVersion: "1.0", payload });
    await q.drain(); await q.stop();

    expect(q.dlq).toHaveLength(0); // No DLQ = RLS passed!

    const rows = await runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(items).where(eq(items.tenantId, TENANT))));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe("Office Paper A4");

    const outbox = await runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT))));
    expect(outbox.map(m => m.eventType)).toContain("audit.event.record");
  });

  it("idempotent — same messageId = single row", async () => {
    const MSG = "ee003333-1111-4000-8000-0000000e0302";
    ids.add(MSG);
    const deliver = async () => {
      const q = new MemoryQueue(); registerItemConsumers(q); await q.start();
      await q.publish(COMMANDS.itemCreate, { messageId: MSG, type: COMMANDS.itemCreate, tenantId: TENANT, actorId: ACTOR, correlationId: "c", schemaVersion: "1.0", payload });
      await q.drain(); await q.stop();
    };
    await deliver();
    const first = await runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(items).where(eq(items.tenantId, TENANT))));
    await deliver();
    const second = await runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(items).where(eq(items.tenantId, TENANT))));
    expect(second).toHaveLength(first.length);
  });
});
