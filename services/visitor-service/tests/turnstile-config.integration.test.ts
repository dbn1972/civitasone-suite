/**
 * Integration test (Fix 6): config-ready turnstile domain params wired to real
 * tenant config end-to-end.
 *
 * Drives the REAL turnstile passageRecord consumer (MemoryQueue → db.transaction
 * → transactional outbox) against the live DB with FK-valid device/gate/pass rows,
 * and proves that a tenant tuning `turnstile.tailgating_tolerance` in the config
 * engine CHANGES turnstile behavior with no code change:
 *
 *   - tenant B (unconfigured → default tolerance 1): passageCount 2 → tailgatingDetected;
 *   - tenant A (tolerance 2): the SAME passageCount 2 → NOTHING;
 *   - tenant A with passageCount 3 (> its tolerance) → tailgatingDetected.
 *
 * The tailgating decision now reads `getPolicyNumber` on the handler tx
 * (previously a hardcoded literal). Assertions key on the unique passage-event id.
 *
 * The seeded device's `gateId` is set to the SAME gate every passage in this
 * file claims (Fix 5: turnstile-control/consumer.ts's passageRecord handler
 * now rejects any passage whose claimed gateId doesn't match the publishing
 * device's registered binding — a device with no gateId at all would fail
 * that check unconditionally, which would mask this file's actual subject,
 * the config-driven tailgating tolerance).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { db } from "../src/shared/db.js";
import { scannerDb } from "../src/shared/scanner-db.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { passageEvents } from "../src/modules/turnstile-control/schema.js";
import { locations, gates } from "../src/modules/location/schema.js";
import { devices } from "../src/modules/device-registry/schema.js";
import { visitRequests } from "../src/modules/visit-request/schema.js";
import { digitalPasses } from "../src/modules/digital-pass/schema.js";
import { configEntries } from "../src/modules/config-registry/schema.js";
import { deriveConfigId } from "../src/modules/config-registry/domain.js";
import { POLICY_NS } from "../src/modules/config-registry/policy.js";
import { registerTurnstileControlConsumers, resetTurnstileConsumerForTests } from "../src/modules/turnstile-control/consumer.js";
import { COMMANDS, EVENTS } from "../src/topics.js";

const TENANT_A = randomUUID();
const TENANT_B = randomUUID();
const ACTOR = randomUUID();
const BUSINESS_HOURS = { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null };

interface Seed { locationId: string; gateId: string; deviceId: string; passId: string; visitReqId: string; }

async function seedTenant(tenant: string): Promise<Seed> {
  const s: Seed = {
    locationId: randomUUID(), gateId: randomUUID(), deviceId: randomUUID(),
    passId: randomUUID(), visitReqId: randomUUID(),
  };
  await runWithTenant(tenant, () =>
    db.transaction(async (tx) => {
      await tx.insert(locations).values({
        id: s.locationId, tenantId: tenant, name: "Loc", businessHours: BUSINESS_HOURS,
        createdBy: ACTOR, updatedBy: ACTOR,
      });
      await tx.insert(gates).values({
        id: s.gateId, tenantId: tenant, locationId: s.locationId, name: "Gate 1",
        createdBy: ACTOR, updatedBy: ACTOR,
      });
      await tx.insert(devices).values({
        id: s.deviceId, tenantId: tenant, deviceType: "turnstile", name: "Turnstile 1",
        serialNumber: "SN-" + s.deviceId.slice(0, 8), locationId: s.locationId, gateId: s.gateId, authType: "mtls",
        createdBy: ACTOR, updatedBy: ACTOR,
      });
      await tx.insert(visitRequests).values({
        id: s.visitReqId, tenantId: tenant, locationId: s.locationId, hostEmployeeId: randomUUID(),
        visitorName: "Pass Holder", visitorPhone: "+911234567890", createdBy: ACTOR, updatedBy: ACTOR,
      });
      await tx.insert(digitalPasses).values({
        id: s.passId, tenantId: tenant, visitRequestId: s.visitReqId, locationId: s.locationId,
        passNumber: "P" + Math.floor(Math.random() * 1e9), passType: "single", status: "active",
        qrJwt: "x", validFrom: new Date(), validUntil: new Date(Date.now() + 86_400_000),
        createdBy: ACTOR, updatedBy: ACTOR,
      });
    }),
  );
  return s;
}

async function setTolerance(tenant: string, value: number) {
  await runWithTenant(tenant, () =>
    db.transaction((tx) =>
      tx.insert(configEntries).values({
        id: deriveConfigId(tenant, POLICY_NS, "turnstile.tailgating_tolerance"),
        tenantId: tenant, namespace: POLICY_NS, configKey: "turnstile.tailgating_tolerance", value,
        createdBy: ACTOR, updatedBy: ACTOR,
      }),
    ),
  );
}

let queue: MemoryQueue;
let seedA: Seed;
let seedB: Seed;

async function publishPassage(tenant: string, seed: Seed, passageCount: number): Promise<string> {
  const passageId = randomUUID();
  await queue.publish(COMMANDS.passageRecord, {
    messageId: randomUUID(),
    type: COMMANDS.passageRecord,
    tenantId: tenant,
    actorId: seed.deviceId, // consumer records device_id = msg.actorId (FK to devices)
    correlationId: randomUUID(),
    schemaVersion: "1.0",
    payload: {
      id: passageId, tenantId: tenant, passId: seed.passId, gateId: seed.gateId,
      direction: "out", passageCount, eventTimestamp: new Date().toISOString(), offlineRecorded: false,
    },
  });
  // Fix 5 added one extra sequential DB round trip to every passageRecord
  // message (the gate-binding lookup, before the main transaction) — under
  // full-suite load (many tests sharing the same Postgres instance) the
  // original 25ms margin was occasionally too tight. Widened for headroom,
  // matching the "give it real headroom" precedent already established in
  // identity-verify-ownership.integration.test.ts for a real DB round trip.
  await new Promise((r) => setTimeout(r, 150));
  return passageId;
}

async function tailgatingRowsFor(passageId: string): Promise<any[]> {
  const rows = await scannerDb.select().from(outboxMessages).where(eq(outboxMessages.eventType, EVENTS.tailgatingDetected));
  return rows.filter((r) => {
    const pl = typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload;
    return pl?.id === passageId;
  });
}

beforeAll(async () => {
  seedA = await seedTenant(TENANT_A);
  seedB = await seedTenant(TENANT_B);
  await setTolerance(TENANT_A, 2); // tenant A raises tolerance to 2
  resetTurnstileConsumerForTests();
  queue = new MemoryQueue();
  // Mirror worker.ts: wrap each subscription in runWithTenant(msg.tenantId, ...)
  // so the handler's db.transaction sets the tenant GUC and RLS admits the
  // visitor_svc (NOBYPASSRLS) writes/reads — exactly how the worker runs it.
  const rawSubscribe = queue.subscribe.bind(queue);
  (queue as unknown as { subscribe: unknown }).subscribe = (topic: string, handler: (msg: any) => Promise<void>) =>
    rawSubscribe(topic, (msg: any) => runWithTenant(msg.tenantId, () => handler(msg)) as Promise<void>);
  registerTurnstileControlConsumers(queue);
});

afterAll(async () => {
  for (const [t, s] of [[TENANT_A, seedA], [TENANT_B, seedB]] as const) {
    await scannerDb.delete(outboxMessages).where(eq(outboxMessages.tenantId, t));
    await runWithTenant(t, () =>
      db.transaction(async (tx) => {
        await tx.delete(passageEvents).where(eq(passageEvents.tenantId, t));
        await tx.delete(digitalPasses).where(eq(digitalPasses.id, s.passId));
        await tx.delete(devices).where(eq(devices.id, s.deviceId));
        await tx.delete(gates).where(eq(gates.id, s.gateId));
        await tx.delete(visitRequests).where(eq(visitRequests.id, s.visitReqId));
        await tx.delete(configEntries).where(eq(configEntries.tenantId, t));
        await tx.delete(locations).where(eq(locations.id, s.locationId));
      }),
    );
  }
});

describe("turnstile tailgating tolerance — config-driven behavior (Fix 6)", () => {
  it("tenant B (default tolerance 1): passageCount 2 raises tailgatingDetected", async () => {
    const id = await publishPassage(TENANT_B, seedB, 2);
    expect(await tailgatingRowsFor(id)).toHaveLength(1);
  });

  it("tenant A (tolerance 2): the SAME passageCount 2 raises NOTHING", async () => {
    const id = await publishPassage(TENANT_A, seedA, 2);
    expect(await tailgatingRowsFor(id)).toHaveLength(0);
  });

  it("tenant A with passageCount 3 (> its tolerance) DOES raise tailgatingDetected", async () => {
    const id = await publishPassage(TENANT_A, seedA, 3);
    const rows = await tailgatingRowsFor(id);
    expect(rows).toHaveLength(1);
    const pl = typeof rows[0].payload === "string" ? JSON.parse(rows[0].payload) : rows[0].payload;
    expect(pl.tolerance).toBe(2); // proves the tenant's configured value drove the decision
  });
});
