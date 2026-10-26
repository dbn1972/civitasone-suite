/**
 * V4-C-01 -- market_properties.property_code was globally UNIQUE while the value
 * is tenant-supplied: tenant B creating a property with the same code tenant A
 * already uses hit a unique violation (cross-tenant availability failure and a
 * code-existence oracle). The constraint must be per-tenant (tenant_id,
 * property_code). Real Postgres, real RLS, no mocks.
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { marketProperties } from "../src/modules/properties/schema.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { registerPropertyConsumers } from "../src/modules/properties/consumer.js";
import { tenantScoped } from "../src/shared/tenant-queue.js";
import { COMMANDS } from "../src/topics.js";

const TENANT_A = randomUUID();
const TENANT_B = randomUUID();
const ACTOR = randomUUID();
const CODE = `SHOP-${randomUUID().slice(0, 8)}`;

function msg(tenantId: string, id: string, propertyCode: string) {
  return {
    messageId: randomUUID(), type: COMMANDS.createProperty, tenantId, actorId: ACTOR,
    correlationId: randomUUID(), schemaVersion: "1.0",
    payload: { id, tenantId, propertyCode, marketName: "Central Market", propertyType: "shop" },
  };
}

async function clean() {
  for (const t of [TENANT_A, TENANT_B]) {
    await runWithTenant(t, () =>
      db.transaction(async (tx) => {
        await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, t));
        await tx.delete(marketProperties).where(eq(marketProperties.tenantId, t));
      }),
    );
  }
}

beforeAll(clean);
afterAll(async () => { await clean(); await sqlClient.end(); });

describe("V4-C-01 property_code uniqueness is per tenant", () => {
  it("two tenants can each create a property with the same code; a tenant cannot reuse its own", async () => {
    const q = tenantScoped(new MemoryQueue());
    registerPropertyConsumers(q);
    await q.start();
    const idA = randomUUID();
    const idB = randomUUID();
    await q.publish(COMMANDS.createProperty, msg(TENANT_A, idA, CODE));
    await q.drain();
    await q.publish(COMMANDS.createProperty, msg(TENANT_B, idB, CODE));
    await q.drain();
    expect((q as unknown as MemoryQueue).dlq, "cross-tenant create must not hit a unique violation").toHaveLength(0);

    const rowsB = await runWithTenant(TENANT_B, () =>
      db.transaction((tx) => tx.select().from(marketProperties).where(inArray(marketProperties.id, [idA, idB]))),
    );
    expect(rowsB.map((r) => r.id)).toEqual([idB]);

    // Same tenant, same code: still rejected (per-tenant uniqueness preserved).
    await q.publish(COMMANDS.createProperty, msg(TENANT_A, randomUUID(), CODE));
    await q.drain();
    expect((q as unknown as MemoryQueue).dlq).toHaveLength(1);
    await q.stop();
  });
});
