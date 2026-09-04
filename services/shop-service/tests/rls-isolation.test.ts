/**
 * Cross-Tenant RLS Isolation — shop-service
 *
 * Tenant A creates an application (and, downstream, a permit + renewal) in
 * each module; Tenant B's list/get for that same resource must never return
 * Tenant A's data. Mirrors parks-service/tests/rls-isolation.test.ts and
 * finance-service/tests/rls-isolation.test.ts, the established pattern in
 * this repo for this exact class of test — including registering consumers
 * directly on the app's own shared `infra.queue` (QUEUE_DRIVER=memory) so a
 * route's real publishCommand() is actually delivered in-process, and using
 * that MemoryQueue's own drain() test aid instead of a fixed sleep.
 *
 * IMPORTANT — this test alone does not prove the RLS policies in
 * migrations/0001_initial.sql have "teeth": a test that only ever runs
 * against a correctly-configured FORCE RLS table will pass whether or not
 * the policy actually does anything, if every code path already filters by
 * tenantId in its WHERE clause too (this service's repos do). The teeth
 * were proven manually as part of this hardening pass's verification, not
 * by this file (mirrors how PR #999's RLS/GUC fix was verified, and how
 * parks-service/tests/rls-isolation.test.ts documents the same proof):
 *
 *   1. Applied migrations to a fresh isolated Postgres container.
 *   2. Ran `ALTER TABLE shop.permits NO FORCE ROW LEVEL SECURITY;` directly
 *      (sabotage: simulates a superuser/BYPASSRLS connection, or a policy
 *      that silently stopped being enforced).
 *   3. Connected as a NON-superuser role (shop_svc, NOSUPERUSER NOBYPASSRLS
 *      — matches the real service role, and is the owner of shop.permits)
 *      and confirmed a query scoped to Tenant A's app.tenant_id GUC still
 *      returned Tenant B's row when it explicitly asked for it: NO FORCE
 *      ROW LEVEL SECURITY still lets an OWNER role bypass RLS entirely — a
 *      real leak, reproduced.
 *   4. Ran `ALTER TABLE shop.permits FORCE ROW LEVEL SECURITY;` to restore,
 *      and re-ran the same query: 0 rows, leak closed.
 *
 * This test suite is the regression guard for the CORRECT (FORCE RLS)
 * state; the sabotage above is what proves it would have caught the
 * incorrect one, without permanently weakening a shared migration to do it.
 *
 * Note: GET /v1/shop/permits/verify is EXCLUDED here on purpose — it is
 * deliberately public/cross-tenant by design (see migrations/
 * 0003_permits_public_directory.sql and tests/permits-verify-directory.test.ts).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { eq } from "drizzle-orm";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { applications } from "../src/modules/registrations/schema.js";
import { permits } from "../src/modules/permits/schema.js";
import { renewals } from "../src/modules/lifecycle/schema.js";
import { registerRegistrationConsumers } from "../src/modules/registrations/consumer.js";
import { registerPermitConsumers } from "../src/modules/permits/consumer.js";
import { registerLifecycleConsumers } from "../src/modules/lifecycle/consumer.js";
import { buildApp } from "../src/app.js";

const SECRET = process.env.JWT_SECRET as string;
const TENANT_A = "aaaaaaaa-1000-4000-8000-000000000001";
const TENANT_B = "bbbbbbbb-2000-4000-8000-000000000002";
const ACTOR_A = "aaaaaaaa-1000-4000-8000-0000000000a1";
const ACTOR_B = "bbbbbbbb-2000-4000-8000-0000000000b1";

function token(tid: string, sub: string, roles: string[]): string {
  return signToken({ sub, tid, roles, sid: "sess-rls" }, SECRET, 3600);
}
const bearer = (tid: string, actor: string) => ({
  authorization: `Bearer ${token(tid, actor, ["shop_admin"])}`,
  "x-tenant-id": tid,
});

function asTenant<T>(tenantId: string, fn: (tx: typeof db) => Promise<T>): Promise<T> {
  return runWithTenant(tenantId, () =>
    db.transaction(fn as Parameters<typeof db.transaction>[0]),
  ) as Promise<T>;
}

async function wipe(): Promise<void> {
  for (const tid of [TENANT_A, TENANT_B]) {
    await asTenant(tid, async (tx) => {
      await tx.delete(renewals).where(eq(renewals.tenantId, tid));
      await tx.delete(permits).where(eq(permits.tenantId, tid));
      await tx.delete(applications).where(eq(applications.tenantId, tid));
      await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, tid));
    });
  }
}

let app: FastifyInstance;

beforeAll(async () => {
  // Register on the app's OWN shared `infra.queue` (not a fresh, disconnected
  // MemoryQueue) — routes' commands.ts publishes via shared/publish.ts's
  // `queue` singleton, which IS this same instance under QUEUE_DRIVER=memory.
  // A separately-constructed MemoryQueue would never receive an
  // app.inject()-triggered publish at all.
  registerRegistrationConsumers(queue);
  registerPermitConsumers(queue);
  registerLifecycleConsumers(queue);
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
  await wipe();
  await sqlClient.end();
});

async function drain(): Promise<void> {
  const q = queue as { drain?: () => Promise<void> };
  if (typeof q.drain === "function") await q.drain();
  else await new Promise<void>((r) => setTimeout(r, 500));
}

const applicationBody = {
  establishmentName: "RLS Isolation Store",
  establishmentType: "shop",
  ownerName: "A. Owner",
  ownerType: "individual",
  premisesAddress: { line1: "1 Main Rd", city: "Testville", pin: "560001" },
  activityCategory: "retail",
};

describe("shop-service — Cross-Tenant RLS Isolation", () => {
  it("Tenant B never sees Tenant A's application, in list or by-id", async () => {
    await wipe();

    const createRes = await app.inject({
      method: "POST", url: "/v1/shop/applications",
      headers: bearer(TENANT_A, ACTOR_A), payload: applicationBody,
    });
    expect(createRes.statusCode).toBe(202);
    const { id } = createRes.json();
    await drain();

    // Sanity check the write actually landed for Tenant A — otherwise the
    // absence assertions below for Tenant B would pass trivially even if
    // nothing had been created at all.
    const ownRes = await app.inject({
      method: "GET", url: `/v1/shop/applications/${id}`, headers: bearer(TENANT_A, ACTOR_A),
    });
    expect(ownRes.statusCode).toBe(200);
    expect(ownRes.json().data.status).toBe("draft");

    const listRes = await app.inject({
      method: "GET", url: "/v1/shop/applications", headers: bearer(TENANT_B, ACTOR_B),
    });
    expect(listRes.statusCode).toBe(200);
    expect((listRes.json().data as Array<{ id: string }>).some((a) => a.id === id)).toBe(false);

    const getRes = await app.inject({
      method: "GET", url: `/v1/shop/applications/${id}`, headers: bearer(TENANT_B, ACTOR_B),
    });
    expect(getRes.statusCode).toBe(404);
  });

  it("Tenant B cannot submit Tenant A's application (404, not a leak of the transition)", async () => {
    await wipe();

    const createRes = await app.inject({
      method: "POST", url: "/v1/shop/applications",
      headers: bearer(TENANT_A, ACTOR_A), payload: applicationBody,
    });
    const { id } = createRes.json();
    await drain();

    const submitRes = await app.inject({
      method: "POST", url: `/v1/shop/applications/${id}/submit`, headers: bearer(TENANT_B, ACTOR_B),
    });
    expect(submitRes.statusCode).toBe(404);

    const stillOwned = await app.inject({
      method: "GET", url: `/v1/shop/applications/${id}`, headers: bearer(TENANT_A, ACTOR_A),
    });
    expect(stillOwned.statusCode).toBe(200);
    expect(stillOwned.json().data.status).toBe("draft");
  });

  it("Tenant B never sees Tenant A's permit, in list or by-id, and cannot suspend it", async () => {
    await wipe();

    const appRes = await app.inject({
      method: "POST", url: "/v1/shop/applications",
      headers: bearer(TENANT_A, ACTOR_A), payload: applicationBody,
    });
    const { id: applicationId } = appRes.json();
    await drain();
    await app.inject({
      method: "POST", url: `/v1/shop/applications/${applicationId}/submit`, headers: bearer(TENANT_A, ACTOR_A),
    });
    await drain();
    await asTenant(TENANT_A, (tx) =>
      tx.update(applications).set({ status: "approved" }).where(eq(applications.id, applicationId)),
    );

    const issueRes = await app.inject({
      method: "POST", url: "/v1/shop/permits",
      headers: bearer(TENANT_A, ACTOR_A),
      payload: { applicationId, establishmentName: "RLS Permit Co" },
    });
    expect(issueRes.statusCode).toBe(202);
    const { id: permitId } = issueRes.json();
    await drain();

    const listRes = await app.inject({
      method: "GET", url: "/v1/shop/permits", headers: bearer(TENANT_B, ACTOR_B),
    });
    expect((listRes.json().data as Array<{ id: string }>).some((p) => p.id === permitId)).toBe(false);

    const getRes = await app.inject({
      method: "GET", url: `/v1/shop/permits/${permitId}`, headers: bearer(TENANT_B, ACTOR_B),
    });
    expect(getRes.statusCode).toBe(404);

    const suspendRes = await app.inject({
      method: "POST", url: `/v1/shop/permits/${permitId}/suspend`,
      headers: bearer(TENANT_B, ACTOR_B), payload: { reason: "cross-tenant attempt" },
    });
    expect(suspendRes.statusCode).toBe(404);

    const stillActive = await app.inject({
      method: "GET", url: `/v1/shop/permits/${permitId}`, headers: bearer(TENANT_A, ACTOR_A),
    });
    expect(stillActive.statusCode).toBe(200);
    expect(stillActive.json().data.permitStatus).toBe("active");
  });

  it("Tenant B never sees Tenant A's renewal, and cannot request one against Tenant A's permit", async () => {
    await wipe();
    const permitId = randomUUID();
    await asTenant(TENANT_A, (tx) =>
      tx.insert(permits).values({
        id: permitId, tenantId: TENANT_A, applicationId: randomUUID(),
        permitNumber: `PERM/SHOP/TEST/2026/${Math.floor(Math.random() * 900000 + 100000)}`,
        establishmentName: "RLS Renewal Co", permitStatus: "active",
        issuedAt: new Date(), validFrom: new Date(), validUntil: new Date(Date.now() + 30 * 24 * 3600 * 1000),
        verificationCode: `TEST-${randomUUID()}`, createdBy: ACTOR_A, updatedBy: ACTOR_A,
      }),
    );

    // Tenant B trying to request a renewal against Tenant A's permit must
    // 404 — lifecycle/routes.ts's POST /v1/shop/renewals checks
    // permitRepo.findById (tenant-scoped) before accepting.
    const crossRes = await app.inject({
      method: "POST", url: "/v1/shop/renewals",
      headers: bearer(TENANT_B, ACTOR_B), payload: { permitId, renewalType: "renewal" },
    });
    expect(crossRes.statusCode).toBe(404);

    const renewRes = await app.inject({
      method: "POST", url: "/v1/shop/renewals",
      headers: bearer(TENANT_A, ACTOR_A), payload: { permitId, renewalType: "renewal" },
    });
    expect(renewRes.statusCode).toBe(202);
    const { id: renewalId } = renewRes.json();
    await drain();

    const ownRes = await app.inject({
      method: "GET", url: `/v1/shop/renewals/${renewalId}`, headers: bearer(TENANT_A, ACTOR_A),
    });
    expect(ownRes.statusCode).toBe(200);
    expect(ownRes.json().data.permitId).toBe(permitId);

    const getRes = await app.inject({
      method: "GET", url: `/v1/shop/renewals/${renewalId}`, headers: bearer(TENANT_B, ACTOR_B),
    });
    expect(getRes.statusCode).toBe(404);

    const listRes = await app.inject({
      method: "GET", url: "/v1/shop/renewals", headers: bearer(TENANT_B, ACTOR_B),
    });
    expect((listRes.json().data as Array<{ id: string }>).some((r) => r.id === renewalId)).toBe(false);
  });

  it("request without a token returns 401 (not RLS-scoped emptiness)", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/shop/applications" });
    expect(res.statusCode).toBe(401);
  });
});
