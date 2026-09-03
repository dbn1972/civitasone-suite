/**
 * Shop Service — smoke suite.
 *
 * shop-service had ZERO test files before this change. This suite is not
 * exhaustive coverage (out of scope for this pass) — it proves the primary
 * route + F3 CQRS consumer wiring across all four modules (registrations,
 * approvals, permits, lifecycle) actually works end to end against a real
 * Postgres, using the same MemoryQueue + createTestDb-style conventions as
 * sibling services (see docs/TEST-INFRA.md).
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { MemoryQueue } from "@civitasone/queue";
import { eq } from "drizzle-orm";
import { db, sqlClient } from "../src/shared/db.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { applications } from "../src/modules/registrations/schema.js";
import { scrutinyRecords } from "../src/modules/approvals/schema.js";
import { permits } from "../src/modules/permits/schema.js";
import { renewals } from "../src/modules/lifecycle/schema.js";
import { registerRegistrationConsumers } from "../src/modules/registrations/consumer.js";
import { registerApprovalConsumers } from "../src/modules/approvals/consumer.js";
import { registerLifecycleConsumers } from "../src/modules/lifecycle/consumer.js";
import { COMMANDS, EVENTS } from "../src/topics.js";
import { buildApp } from "../src/app.js";

const SECRET = process.env.JWT_SECRET as string;
const TENANT = "969292f7-976f-41bf-bd08-4df9c6b9e1ea";
const APPLICANT = "a5d5f833-2b9f-4adb-b65f-b0a314971e6b";
const OFFICER = "92fb0b38-b7ef-49ff-938d-ced86de126f8";

function token(sub: string, roles: string[]): string {
  return signToken({ sub, tid: TENANT, roles, sid: "sess-smoke" }, SECRET, 3600);
}
const applicantBearer = () => ({ authorization: `Bearer ${token(APPLICANT, ["shop_user"])}`, "x-tenant-id": TENANT });

function asTenant<T>(fn: (tx: typeof db) => Promise<T>): Promise<T> {
  return runWithTenant(TENANT, () =>
    db.transaction(fn as Parameters<typeof db.transaction>[0]),
  ) as Promise<T>;
}

async function wipe(): Promise<void> {
  await asTenant(async (tx) => {
    await tx.delete(renewals).where(eq(renewals.tenantId, TENANT));
    await tx.delete(scrutinyRecords).where(eq(scrutinyRecords.tenantId, TENANT));
    await tx.delete(permits).where(eq(permits.tenantId, TENANT));
    await tx.delete(applications).where(eq(applications.tenantId, TENANT));
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
  });
}

afterAll(async () => {
  await wipe();
  await sqlClient.end();
});

const validCreateBody = {
  establishmentName: "Smoke Test Store",
  establishmentType: "shop",
  ownerName: "A. Owner",
  ownerType: "individual",
  premisesAddress: { line1: "1 Main Rd", city: "Testville", pin: "560001" },
  activityCategory: "retail",
};

describe("POST /v1/shop/applications — auth + CQRS wiring (integration)", () => {
  it("401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/shop/applications", payload: validCreateBody });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("202 accepted for shop_user, and the createApplication consumer writes a draft row", async () => {
    await wipe();
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/shop/applications",
      headers: applicantBearer(), payload: validCreateBody,
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    const appId = res.json().id as string;
    expect(appId).toBeTruthy();

    // The route only publishes the command (F3 async pattern) — drive it
    // through the actual consumer to prove the write side of the pipe.
    const q = new MemoryQueue();
    registerRegistrationConsumers(q);
    await q.start();
    await q.publish(COMMANDS.createApplication, {
      messageId: randomUUID(),
      type: COMMANDS.createApplication,
      tenantId: TENANT, actorId: APPLICANT, correlationId: "corr-app-1", schemaVersion: "1.0",
      payload: { id: appId, tenantId: TENANT, ...validCreateBody },
    });
    await new Promise<void>((r) => setTimeout(r, 500));
    await q.stop();

    const rows = await asTenant((tx) => tx.select().from(applications).where(eq(applications.id, appId)));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("draft");
    expect(rows[0]?.establishmentName).toBe(validCreateBody.establishmentName);
  });
});

describe("shop.scrutiny.initiate consumer — application status transition (integration)", () => {
  const APP_ID = "e45e2541-4e5c-47a8-b2b0-5810abccf7a7";

  it("submitted application → scrutiny record inserted + application moves to under_scrutiny", async () => {
    await wipe();
    await asTenant((tx) =>
      tx.insert(applications).values({
        id: APP_ID, tenantId: TENANT, applicationNumber: "SHOP/TEST/2026/000001",
        status: "submitted", applicantId: APPLICANT,
        establishmentName: validCreateBody.establishmentName,
        establishmentType: validCreateBody.establishmentType,
        ownerName: validCreateBody.ownerName, ownerType: validCreateBody.ownerType,
        premisesAddress: validCreateBody.premisesAddress,
        activityCategory: validCreateBody.activityCategory,
        createdBy: APPLICANT, updatedBy: APPLICANT,
      }),
    );

    const q = new MemoryQueue();
    registerApprovalConsumers(q);
    await q.start();
    const scrutinyId = randomUUID();
    await q.publish(COMMANDS.initiateScrutiny, {
      messageId: randomUUID(),
      type: COMMANDS.initiateScrutiny,
      tenantId: TENANT, actorId: OFFICER, correlationId: "corr-scr-1", schemaVersion: "1.0",
      payload: { id: scrutinyId, tenantId: TENANT, applicationId: APP_ID, scrutinyType: "document_check", officerId: OFFICER },
    });
    await new Promise<void>((r) => setTimeout(r, 500));
    await q.stop();

    const scrutiny = await asTenant((tx) => tx.select().from(scrutinyRecords).where(eq(scrutinyRecords.id, scrutinyId)));
    expect(scrutiny).toHaveLength(1);
    expect(scrutiny[0]?.status).toBe("pending");

    const app = await asTenant((tx) => tx.select().from(applications).where(eq(applications.id, APP_ID)));
    expect(app[0]?.status).toBe("under_scrutiny");

    const outbox = await asTenant((tx) => tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT)));
    expect(outbox.map((r) => r.eventType)).toContain(EVENTS.scrutinyInitiated);
  });
});

describe("shop.renewal.request consumer — renewal against an active permit (integration)", () => {
  const PERMIT_ID = "2ecbc794-a6f1-4908-a66e-98b70e56eec5";

  it("active permit → renewal row inserted with previousValidUntil carried from the permit", async () => {
    await wipe();
    const validUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await asTenant((tx) =>
      tx.insert(permits).values({
        id: PERMIT_ID, tenantId: TENANT, applicationId: randomUUID(),
        permitNumber: "PERM/SHOP/TEST/2026/000002",
        establishmentName: validCreateBody.establishmentName,
        permitStatus: "active", issuedAt: new Date(), validFrom: new Date(), validUntil,
        verificationCode: `TEST-${randomUUID()}`,
        createdBy: OFFICER, updatedBy: OFFICER,
      }),
    );

    const q = new MemoryQueue();
    registerLifecycleConsumers(q);
    await q.start();
    const renewalId = randomUUID();
    await q.publish(COMMANDS.requestRenewal, {
      messageId: randomUUID(),
      type: COMMANDS.requestRenewal,
      tenantId: TENANT, actorId: APPLICANT, correlationId: "corr-ren-1", schemaVersion: "1.0",
      payload: { id: renewalId, tenantId: TENANT, permitId: PERMIT_ID, renewalType: "renewal" },
    });
    await new Promise<void>((r) => setTimeout(r, 500));
    await q.stop();

    const rows = await asTenant((tx) => tx.select().from(renewals).where(eq(renewals.id, renewalId)));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.permitId).toBe(PERMIT_ID);
    expect(rows[0]?.status).toBe("submitted");
    expect(rows[0]?.previousValidUntil?.toISOString()).toBe(validUntil.toISOString());
  });
});
