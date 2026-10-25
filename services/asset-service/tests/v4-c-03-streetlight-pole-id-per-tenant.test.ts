/**
 * V4-C-03 -- streetlight.asset_streetlights.pole_id was globally UNIQUE while the
 * value is tenant-supplied: tenant B registering pole "SL-001" collided with
 * tenant A's identical pole id (cross-tenant availability failure and an
 * existence oracle). Uniqueness must be per tenant. Real Postgres, real RLS.
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { assetStreetlights } from "../src/modules/streetlight/schema.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { registerStreetlightConsumers } from "../src/modules/streetlight/consumer.js";
import { COMMANDS } from "../src/topics.js";

const TENANT_A = randomUUID();
const TENANT_B = randomUUID();
const ACTOR = randomUUID();
const POLE = `SL-${randomUUID().slice(0, 8)}`;

function msg(tenantId: string, id: string) {
  return {
    messageId: randomUUID(), type: COMMANDS.streetlightCreate, tenantId, actorId: ACTOR,
    correlationId: randomUUID(), schemaVersion: "1.0",
    payload: { id, tenantId, poleId: POLE, lampType: "led", wattage: 60 },
  };
}

async function clean() {
  for (const t of [TENANT_A, TENANT_B]) {
    await runWithTenant(t, () =>
      db.transaction(async (tx) => {
        await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, t));
        await tx.delete(assetStreetlights).where(eq(assetStreetlights.tenantId, t));
      }),
    );
  }
}

beforeAll(clean);
afterAll(async () => { await clean(); await sqlClient.end(); });

describe("V4-C-03 streetlight pole_id uniqueness is per tenant", () => {
  it("two tenants can register the same pole id; a tenant cannot reuse its own", async () => {
    const q = new MemoryQueue();
    registerStreetlightConsumers(q);
    await q.start();
    const idA = randomUUID();
    const idB = randomUUID();
    await q.publish(COMMANDS.streetlightCreate, msg(TENANT_A, idA));
    await q.drain();
    await q.publish(COMMANDS.streetlightCreate, msg(TENANT_B, idB));
    await q.drain();

    const rowsB = await runWithTenant(TENANT_B, () =>
      db.transaction((tx) => tx.select().from(assetStreetlights).where(inArray(assetStreetlights.id, [idA, idB]))),
    );
    expect(rowsB.map((r) => r.id), "tenant B's pole must persist despite tenant A using the same pole id").toEqual([idB]);

    // Same tenant, same pole id: still rejected (per-tenant uniqueness preserved).
    const idDup = randomUUID();
    await q.publish(COMMANDS.streetlightCreate, msg(TENANT_A, idDup));
    await q.drain();
    const rowsA = await runWithTenant(TENANT_A, () =>
      db.transaction((tx) => tx.select().from(assetStreetlights).where(eq(assetStreetlights.tenantId, TENANT_A))),
    );
    expect(rowsA.map((r) => r.id)).toEqual([idA]);
    await q.stop();
  });
});
