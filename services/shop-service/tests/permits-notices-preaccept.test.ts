/**
 * Shop Service — Permits: notices route pre-accept validation.
 *
 * BUG PROVEN HERE: POST /v1/shop/permits/notices was the only write route in
 * this service that did NOT do a synchronous existence check before returning
 * 202 (every sibling route — suspend/cancel/restore/renewals/etc. — checks
 * repo.findById first). shop.permit_actions.permit_id has no FK constraint
 * (migrations/0001_initial.sql), so a bogus permitId silently produced an
 * orphaned notice action + a noticeIssued event for a permit that never
 * existed, with the 202 caller never told anything was wrong. Fixed in
 * src/modules/permits/routes.ts by adding the same repo.findById + 404
 * pattern used everywhere else in this file.
 *
 * Also smoke-tests the rest of the permits module's auth/RBAC and the
 * issueNotice consumer's happy path.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { MemoryQueue } from "@civitasone/queue";
import { eq } from "drizzle-orm";
import { db, sqlClient } from "../src/shared/db.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { permits, permitActions } from "../src/modules/permits/schema.js";
import { registerPermitConsumers } from "../src/modules/permits/consumer.js";
import { COMMANDS, EVENTS } from "../src/topics.js";
import { buildApp } from "../src/app.js";

const SECRET = process.env.JWT_SECRET as string;
const TENANT = "8d4edc9a-0e0a-4f83-8c6b-1bfdee59fc89";
const OFFICER_ACTOR = "1261b39f-4cc8-47ad-bdd1-57b0d0f8af0f";
const OTHER_ACTOR = "78b29b3d-607d-4c27-8a45-1986e8880ebe";

function token(sub: string, roles: string[]): string {
  return signToken({ sub, tid: TENANT, roles, sid: "sess-notices" }, SECRET, 3600);
}
const officerBearer = () => ({ authorization: `Bearer ${token(OFFICER_ACTOR, ["shop_admin"])}`, "x-tenant-id": TENANT });
const userBearer = () => ({ authorization: `Bearer ${token(OTHER_ACTOR, ["shop_user"])}`, "x-tenant-id": TENANT });

function asTenant<T>(fn: (tx: typeof db) => Promise<T>): Promise<T> {
  return runWithTenant(TENANT, () =>
    db.transaction(fn as Parameters<typeof db.transaction>[0]),
  ) as Promise<T>;
}

const EXISTING_PERMIT_ID = "ec3f9d33-64ef-4b6b-8ed9-205cf00e7b7a";

async function seedPermit(): Promise<void> {
  await asTenant((tx) =>
    tx.insert(permits).values({
      id: EXISTING_PERMIT_ID,
      tenantId: TENANT,
      applicationId: randomUUID(),
      permitNumber: "PERM/SHOP/TEST/2026/000001",
      establishmentName: "Test Establishment",
      permitStatus: "active",
      issuedAt: new Date(),
      validFrom: new Date(),
      validUntil: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      verificationCode: `TEST-${randomUUID()}`,
      createdBy: OFFICER_ACTOR,
      updatedBy: OFFICER_ACTOR,
    }),
  );
}

async function wipe(): Promise<void> {
  await asTenant(async (tx) => {
    await tx.delete(permitActions).where(eq(permitActions.tenantId, TENANT));
    await tx.delete(permits).where(eq(permits.tenantId, TENANT));
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
  });
}

afterAll(async () => {
  await wipe();
  await sqlClient.end();
});

describe("POST /v1/shop/permits/notices — authentication + RBAC", () => {
  it("401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/shop/permits/notices",
      payload: { permitId: EXISTING_PERMIT_ID, noticeDetails: { reason: "test" } },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 for shop_user (not an officer role)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/shop/permits/notices",
      headers: userBearer(),
      payload: { permitId: EXISTING_PERMIT_ID, noticeDetails: { reason: "test" } },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

describe("POST /v1/shop/permits/notices — pre-accept validation (bug fix)", () => {
  it("404 PERMIT_NOT_FOUND for a permitId that does not exist — request is rejected, not silently accepted", async () => {
    const app = await buildApp();
    const bogusPermitId = randomUUID();
    const res = await app.inject({
      method: "POST", url: "/v1/shop/permits/notices",
      headers: officerBearer(),
      payload: { permitId: bogusPermitId, noticeDetails: { reason: "fire safety" } },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("PERMIT_NOT_FOUND");

    // Regression guard for the actual defect: without the fix this returned
    // 202 and (once consumed) would have inserted an orphaned permit_actions
    // row referencing a permit that never existed. Confirm no such row exists.
    const orphans = await asTenant((tx) =>
      tx.select().from(permitActions).where(eq(permitActions.permitId, bogusPermitId)),
    );
    expect(orphans).toHaveLength(0);
  });

  it("202 accepted for a permitId that exists", async () => {
    await wipe();
    await seedPermit();
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/shop/permits/notices",
      headers: officerBearer(),
      payload: { permitId: EXISTING_PERMIT_ID, noticeDetails: { reason: "fire safety" } },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe("accepted");
  });
});

describe("shop.permit.issue_notice consumer — happy path (integration)", () => {
  it("applies the notice: inserts a permit_actions row + emits noticeIssued, for an existing permit", async () => {
    await wipe();
    await seedPermit();

    const q = new MemoryQueue();
    registerPermitConsumers(q);
    await q.start();

    const noticeId = randomUUID();
    const messageId = randomUUID();
    await q.publish(COMMANDS.issueNotice, {
      messageId,
      type: COMMANDS.issueNotice,
      tenantId: TENANT, actorId: OFFICER_ACTOR, correlationId: "corr-notice-1", schemaVersion: "1.0",
      payload: { id: noticeId, permitId: EXISTING_PERMIT_ID, noticeDetails: { reason: "fire safety" } },
    });
    await new Promise<void>((r) => setTimeout(r, 500));
    await q.stop();

    const rows = await asTenant((tx) =>
      tx.select().from(permitActions).where(eq(permitActions.id, noticeId)),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.permitId).toBe(EXISTING_PERMIT_ID);
    expect(rows[0]?.actionType).toBe("notice");

    const outbox = await asTenant((tx) =>
      tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT)),
    );
    expect(outbox.map((r) => r.eventType)).toContain(EVENTS.noticeIssued);
  });
});
