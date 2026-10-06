/**
 * DPDP consent evidence — persisted in the tamper-evident audit chain with a
 * SERVER-stamped recordedAt (the client-supplied time is never trusted).
 *
 * Sources: grievance/consumer.ts, application/consumer.ts (draft_save),
 * documents/consumer.ts (digilocker_fetch).
 */
import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { citizenGrievances } from "../src/modules/grievance/schema.js";
import { applicationDrafts } from "../src/modules/application/schema.js";
import { documentSubmissions } from "../src/modules/documents/schema.js";
import { registerGrievanceConsumers } from "../src/modules/grievance/consumer.js";
import { registerApplicationConsumers } from "../src/modules/application/consumer.js";
import { registerDocumentsConsumers } from "../src/modules/documents/consumer.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "cc001111-1111-4000-8000-0000000c0201";
const ACTOR = "cc00aaaa-1111-4000-8000-0000000c020a";
const ids = new Set<string>();

async function cleanup(): Promise<void> {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(citizenGrievances).where(eq(citizenGrievances.tenantId, TENANT));
    await tx.delete(applicationDrafts).where(eq(applicationDrafts.tenantId, TENANT));
    await tx.delete(documentSubmissions).where(eq(documentSubmissions.tenantId, TENANT));
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
  }));
  if (ids.size > 0) {
    await db.delete(processed).where(inArray(processed.messageId, [...ids]));
    ids.clear();
  }
}

async function deliver(register: (q: MemoryQueue) => void, topic: string, messageId: string, payload: unknown): Promise<void> {
  ids.add(messageId);
  const q = new MemoryQueue();
  register(q);
  await q.start();
  await q.publish(topic, {
    messageId, type: topic, tenantId: TENANT, actorId: ACTOR,
    correlationId: `corr-${messageId}`, schemaVersion: "1.0", payload,
  });
  await q.drain();
  await q.stop();
}

async function auditNewValue(action: string): Promise<Record<string, any>> {
  const rows = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
    tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT))));
  const hit = rows
    .filter((r) => r.eventType === "audit.event.record")
    .map((r) => r.payload as Record<string, any>)
    .find((p) => p.action === action);
  expect(hit, `audit event ${action} emitted`).toBeDefined();
  return hit!.newValue as Record<string, any>;
}

const STALE = "2001-01-01T00:00:00.000Z";

beforeEach(cleanup);
afterAll(async () => { await cleanup(); await sqlClient.end(); });

describe("DPDP consent evidence is persisted with a server-stamped time", () => {
  it("grievance register: dpdpConsent + complainantName in audit newValue", async () => {
    const before = Date.now();
    await deliver((q) => registerGrievanceConsumers(q), COMMANDS.grievanceRegister,
      "cc003333-1111-4000-8000-000000000e01", {
        id: "cc002222-1111-4000-8000-000000000e01", tenantId: TENANT, citizenId: ACTOR,
        category: "Water Supply", subject: "Consent evidence", description: "Consent evidence persistence check.",
        dpdpConsent: { given: true, purpose: "grievance_redressal", recordedAt: STALE },
        complainantName: "Test Complainant",
      });
    const nv = await auditNewValue("register");
    expect(nv.dpdpConsent.given).toBe(true);
    expect(nv.dpdpConsent.recordedAt).not.toBe(STALE);
    expect(Date.parse(nv.dpdpConsent.recordedAt)).toBeGreaterThanOrEqual(before - 1000);
    expect(nv.complainantName).toBe("Test Complainant");
  });

  it("assisted intake draft_save: assistedConsent in audit newValue", async () => {
    await deliver((q) => registerApplicationConsumers(q), COMMANDS.draftSave,
      "cc003333-1111-4000-8000-000000000e02", {
        id: "cc002222-1111-4000-8000-000000000e02", tenantId: TENANT, citizenId: ACTOR,
        serviceId: "cc002222-1111-4000-8000-000000000e22", channel: "assisted", assistedBy: ACTOR,
        formData: {}, documentTypes: [], assistedConsent: true,
      });
    const nv = await auditNewValue("draft_save");
    expect(nv.assistedConsent).toBe(true);
    expect(nv.assistedBy).toBe(ACTOR);
    expect(nv.channel).toBe("assisted");
  });

  it("digilocker fetch: digilockerConsent with server recordedAt", async () => {
    const before = Date.now();
    await deliver((q) => registerDocumentsConsumers(q), COMMANDS.documentDigilockerFetch,
      "cc003333-1111-4000-8000-000000000e03", {
        id: "cc002222-1111-4000-8000-000000000e03", tenantId: TENANT, applicationId: null, citizenId: ACTOR,
        serviceId: null, docType: "aadhaar", digilockerRef: null, providerStatus: "not_configured",
        configured: false, verificationStatus: "pending", status: "received", authenticity: "self_attested",
        consent: true,
      });
    const nv = await auditNewValue("digilocker_fetch");
    expect(nv.digilockerConsent.given).toBe(true);
    expect(Date.parse(nv.digilockerConsent.recordedAt)).toBeGreaterThanOrEqual(before - 1000);
  });
});
