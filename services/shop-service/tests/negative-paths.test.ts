/**
 * Shop Service — negative-path coverage.
 *
 * Two classes of "this must be REJECTED, not silently accepted" behavior
 * that had no test coverage before this hardening pass:
 *
 *  1. Invalid input: employeeCount / capacityDetails.areaSqft above the new
 *     bounds (registrations/routes.ts's MAX_EMPLOYEE_COUNT / MAX_AREA_SQFT —
 *     see that file's comment for why these bounds exist: unbounded values
 *     previously sailed past Zod and hit shop.applications.employee_count
 *     (a plain `integer`/int4 column) as a raw DB overflow 500 deep inside
 *     the async consumer, well after the 202 had already gone back to the
 *     caller).
 *  2. Wrong state transitions: an application/permit action attempted from
 *     a status that does not allow it must 422 synchronously (not silently
 *     accept a 202 that the consumer then quietly no-ops).
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
import { permits } from "../src/modules/permits/schema.js";
import { registerPermitConsumers } from "../src/modules/permits/consumer.js";
import { COMMANDS } from "../src/topics.js";
import { buildApp } from "../src/app.js";

const SECRET = process.env.JWT_SECRET as string;
const TENANT = "d1e1e1e1-0000-4000-8000-000000000001";
const APPLICANT = "d1e1e1e1-0000-4000-8000-0000000000a1";
const OFFICER = "d1e1e1e1-0000-4000-8000-0000000000f1";

function token(sub: string, roles: string[]): string {
  return signToken({ sub, tid: TENANT, roles, sid: "sess-negative" }, SECRET, 3600);
}
const applicantBearer = () => ({ authorization: `Bearer ${token(APPLICANT, ["shop_user"])}`, "x-tenant-id": TENANT });
const officerBearer = () => ({ authorization: `Bearer ${token(OFFICER, ["shop_admin"])}`, "x-tenant-id": TENANT });

function asTenant<T>(fn: (tx: typeof db) => Promise<T>): Promise<T> {
  return runWithTenant(TENANT, () =>
    db.transaction(fn as Parameters<typeof db.transaction>[0]),
  ) as Promise<T>;
}

async function wipe(): Promise<void> {
  await asTenant(async (tx) => {
    await tx.delete(permits).where(eq(permits.tenantId, TENANT));
    await tx.delete(applications).where(eq(applications.tenantId, TENANT));
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
  });
}

afterAll(async () => {
  await wipe();
  await sqlClient.end();
});

const baseApplicationBody = {
  establishmentName: "Negative Path Store",
  establishmentType: "shop",
  ownerName: "A. Owner",
  ownerType: "individual",
  premisesAddress: { line1: "1 Main Rd", city: "Testville", pin: "560001" },
  activityCategory: "retail",
};

describe("POST /v1/shop/applications — invalid input rejected, not silently accepted", () => {
  it("400 VALIDATION_FAILED when employeeCount exceeds the bound", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/shop/applications",
      headers: applicantBearer(),
      payload: { ...baseApplicationBody, employeeCount: 50_001 },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_FAILED");
    expect(res.json().fieldErrors.some((e: { field: string }) => e.field === "employeeCount")).toBe(true);
  });

  it("400 VALIDATION_FAILED when capacityDetails.areaSqft exceeds the bound", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/shop/applications",
      headers: applicantBearer(),
      payload: { ...baseApplicationBody, capacityDetails: { areaSqft: 10_000_001 } },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_FAILED");
    expect(res.json().fieldErrors.some((e: { field: string }) => e.field === "capacityDetails.areaSqft")).toBe(true);
  });

  it("202 accepted at exactly the bound (off-by-one sanity check)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/shop/applications",
      headers: applicantBearer(),
      payload: { ...baseApplicationBody, employeeCount: 50_000, capacityDetails: { areaSqft: 10_000_000 } },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
  });
});

describe("POST /v1/shop/applications/:id/submit — wrong state transition rejected", () => {
  const APP_ID = randomUUID();

  it("422 INVALID_STATUS submitting an application that is already submitted", async () => {
    await wipe();
    await asTenant((tx) =>
      tx.insert(applications).values({
        id: APP_ID, tenantId: TENANT, applicationNumber: "SHOP/TEST/2026/900001",
        status: "submitted", applicantId: APPLICANT,
        establishmentName: baseApplicationBody.establishmentName,
        establishmentType: baseApplicationBody.establishmentType,
        ownerName: baseApplicationBody.ownerName, ownerType: baseApplicationBody.ownerType,
        premisesAddress: baseApplicationBody.premisesAddress,
        activityCategory: baseApplicationBody.activityCategory,
        createdBy: APPLICANT, updatedBy: APPLICANT,
      }),
    );
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: `/v1/shop/applications/${APP_ID}/submit`,
      headers: applicantBearer(),
    });
    await app.close();
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("INVALID_STATUS");

    // Regression guard: the application must be untouched, still "submitted".
    const [row] = await asTenant((tx) => tx.select().from(applications).where(eq(applications.id, APP_ID)));
    expect(row?.status).toBe("submitted");
  });
});

describe("POST /v1/shop/permits/:id/{suspend,cancel,restore} — wrong state transitions rejected", () => {
  async function seedPermit(status: string): Promise<string> {
    const id = randomUUID();
    await asTenant((tx) =>
      tx.insert(permits).values({
        id, tenantId: TENANT, applicationId: randomUUID(),
        permitNumber: `PERM/SHOP/TEST/2026/${Math.floor(Math.random() * 900000 + 100000)}`,
        establishmentName: baseApplicationBody.establishmentName,
        permitStatus: status, issuedAt: new Date(), validFrom: new Date(),
        validUntil: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        verificationCode: `TEST-${randomUUID()}`,
        createdBy: OFFICER, updatedBy: OFFICER,
        ...(status === "cancelled" ? { cancelledAt: new Date(), cancellationReason: "seed" } : {}),
      }),
    );
    return id;
  }

  it("422 INVALID_STATUS restoring a permit that is active (not suspended)", async () => {
    await wipe();
    const id = await seedPermit("active");
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: `/v1/shop/permits/${id}/restore`,
      headers: officerBearer(), payload: { reason: "test" },
    });
    await app.close();
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("INVALID_STATUS");
  });

  it("422 INVALID_STATUS suspending a permit that is already cancelled (terminal state)", async () => {
    await wipe();
    const id = await seedPermit("cancelled");
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: `/v1/shop/permits/${id}/suspend`,
      headers: officerBearer(), payload: { reason: "test" },
    });
    await app.close();
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("INVALID_STATUS");
  });

  it("422 INVALID_STATUS cancelling a permit that is already cancelled — and the consumer, driven directly, is also a safe no-op", async () => {
    await wipe();
    const id = await seedPermit("cancelled");
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: `/v1/shop/permits/${id}/cancel`,
      headers: officerBearer(), payload: { reason: "test" },
    });
    await app.close();
    expect(res.statusCode).toBe(422);

    // Belt-and-braces: even if a stale/duplicate command reached the consumer
    // directly (bypassing the route's synchronous check — e.g. a redelivery
    // after the permit moved on), the CAS in repo.updatePermitStatus must
    // still refuse to apply it.
    const q = new MemoryQueue();
    registerPermitConsumers(q);
    await q.start();
    await q.publish(COMMANDS.cancelPermit, {
      messageId: randomUUID(), type: COMMANDS.cancelPermit,
      tenantId: TENANT, actorId: OFFICER, correlationId: "corr-neg-cancel", schemaVersion: "1.0",
      payload: { permitId: id, tenantId: TENANT, reason: "stale redelivery" },
    });
    await new Promise<void>((r) => setTimeout(r, 400));
    await q.stop();

    const [row] = await asTenant((tx) => tx.select().from(permits).where(eq(permits.id, id)));
    expect(row?.cancellationReason).toBe("seed"); // unchanged — the stale command did not overwrite it
  });
});
