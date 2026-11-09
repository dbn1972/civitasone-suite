/**
 * UAT bundle 23 (DLQ gate): visitor.overstay.detect dead-lettered every cycle for tenant 67fc1140.
 *
 * The overstayDetect handler selected visit_requests.visitor_name through encryptedText(), whose driver
 * mapping decrypts. One visit request whose envelope the keyring cannot open (rows written under a
 * retired key) threw PiiDecryptError, rolled back the whole transaction, was retried 5 times and then
 * dead-lettered - every 10 minutes, for months - and no overstay alert for that tenant was ever raised,
 * including for visitors whose rows were fine.
 *
 * Now the envelope is read raw and decrypted per row: an undecryptable row still raises the overstay alert (placeholder
 * name, pass + visit ids), is counted in pii_decrypt_skipped_total and logged once.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import type { Queue, Handler } from "@civitasone/queue";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { getPiiDecryptSkippedCount, resetFailureMetrics } from "@civitasone/observability";
import { db } from "../src/shared/db.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { registerCheckInConsumers } from "../src/modules/check-in/consumer.js";
import { COMMANDS, EVENTS } from "../src/topics.js";
import { digitalPasses } from "../src/modules/digital-pass/schema.js";
import { visitRequests } from "../src/modules/visit-request/schema.js";
import { locations } from "../src/modules/location/schema.js";

// Realistic tenant: a state secretariat with two visitors still inside past the pass window.
const TENANT = randomUUID();
const ACTOR = randomUUID();
const LOCATION = randomUUID();
const HOST = randomUUID();
const HOURS = { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null };

const goodVisit = randomUUID();
const badVisit = randomUUID();

async function seedVisit(id: string, name: string) {
  await db.transaction(async (tx) => {
    await tx.insert(visitRequests).values({
      id, tenantId: TENANT, locationId: LOCATION, hostEmployeeId: HOST, visitorName: name,
      visitorPhone: "+919876543210", createdBy: ACTOR, updatedBy: ACTOR,
    });
    await tx.insert(digitalPasses).values({
      id: randomUUID(), tenantId: TENANT, visitRequestId: id, locationId: LOCATION,
      passNumber: "P" + Math.floor(Math.random() * 1e9), passType: "single", status: "checked_in", qrJwt: "x",
      validFrom: new Date(Date.now() - 8 * 3_600_000), validUntil: new Date(Date.now() - 3 * 3_600_000),
      createdBy: ACTOR, updatedBy: ACTOR,
    });
  });
}

beforeAll(async () => {
  resetFailureMetrics();
  await runWithTenant(TENANT, async () => {
    await db.transaction((tx) => tx.insert(locations).values({ id: LOCATION, tenantId: TENANT, name: "Mantralaya Gate 2", businessHours: HOURS, createdBy: ACTOR, updatedBy: ACTOR }));
    await seedVisit(goodVisit, "Suresh Kumar Iyer");
    await seedVisit(badVisit, "Meenakshi Sundaram");
    // Same envelope shape the service writes ("enc:v2:<keyid>:" + base64(iv|tag|ct)), but sealed under a key
    // this process does not hold: GCM authentication fails => PiiDecryptError.
    const foreign = "enc:v2:k1:" + randomBytes(12 + 16 + 24).toString("base64");
    await db.transaction((tx) => tx.execute(sql`update visitor.visit_requests set visitor_name = ${foreign} where id = ${badVisit}`));
  });
});

afterAll(async () => {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
    await tx.delete(digitalPasses).where(eq(digitalPasses.tenantId, TENANT));
    await tx.delete(visitRequests).where(eq(visitRequests.tenantId, TENANT));
    await tx.delete(locations).where(eq(locations.tenantId, TENANT));
  }));
});

describe("overstayDetect with one undecryptable visit request", () => {
  it("does not dead-letter, and still alerts for BOTH visitors (placeholder name for the undecryptable one)", async () => {
    const q = new MemoryQueue({ maxAttempts: 5 });
    let deliveries = 0;
    const raw = q.subscribe.bind(q);
    (q as Queue).subscribe = ((t: string, h: Handler) =>
      raw(t, withTenantConsumer((async (m: unknown) => { deliveries += 1; await (h as (x: unknown) => Promise<void>)(m); }) as Handler) as Handler)) as Queue["subscribe"];
    registerCheckInConsumers(q);
    await q.start();
    await q.publish(COMMANDS.overstayDetect, {
      messageId: randomUUID(), type: COMMANDS.overstayDetect, tenantId: TENANT, actorId: ACTOR,
      correlationId: `corr-${randomUUID()}`, schemaVersion: "1.0", payload: { locationId: LOCATION },
    });
    await q.drain();
    await q.stop();

    expect(q.dlq).toHaveLength(0);
    expect(deliveries).toBe(1);

    const alerts = await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(outboxMessages).where(and(eq(outboxMessages.tenantId, TENANT), eq(outboxMessages.topic, EVENTS.overstayAlerted)))));
    expect(alerts).toHaveLength(2);
    const byVisit = new Map(alerts.map((a) => [(a.payload as { visitRequestId: string }).visitRequestId, a.payload as Record<string, unknown>]));
    expect(byVisit.get(goodVisit)).toMatchObject({ visitorName: "Suresh Kumar Iyer" });
    expect(byVisit.get(badVisit)).toMatchObject({ visitorName: "Visitor name unavailable", visitRequestId: badVisit });
    expect(typeof byVisit.get(badVisit)!.passId).toBe("string");
    expect(JSON.stringify(alerts)).not.toContain("Meenakshi");
    expect(JSON.stringify(alerts)).not.toContain("enc:v2:");
    expect(getPiiDecryptSkippedCount("visitor-service", "visit_request")).toBe(1);
  });
});
