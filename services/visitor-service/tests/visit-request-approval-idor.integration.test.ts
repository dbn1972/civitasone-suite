/**
 * HIGH (FIXED) — cross-host IDOR (CWE-639) on visit-request
 * approve/reject/cancel.
 *
 * ORIGINAL BUG: modules/visit-request/routes.ts's approve/reject/
 * DELETE(cancel) handlers called `requireRole(ctx, APPROVAL_ROLES |
 * WRITE_ROLES)` and then `repo.getVisitRequestById(ctx.tenantId, id)` purely
 * to 404 on a missing row — at no point was `ctx.actorId` ever compared
 * against the row's `hostEmployeeId` (or any other ownership/relationship
 * field). `APPROVAL_ROLES` and `WRITE_ROLES` both include the generic,
 * broadly-held "employee" role (routes.ts's own docstring: "any
 * authenticated employee/host can create and see requests" — that comment
 * justifies shared CREATE/LIST visibility, not unscoped approve/reject/
 * cancel). The practical effect: any "employee"-role actor in the tenant
 * could approve, reject, or cancel ANY other employee's hosted visit
 * request — mirroring the same IDOR class the security cluster found in the
 * `identity` module (verify-identity, PR #700).
 *
 * FIXED: routes.ts now calls `assertOwnsRequest(ctx, row)` right after the
 * existing 404 check in all three handlers. A caller holding only the base
 * "employee" role must be the row's own `hostEmployeeId` or gets 403; the
 * elevated tiers (ELEVATED_APPROVAL_ROLES — protocol_officer/security_admin/
 * tenant_admin/super_admin, the same set already trusted with granting VIP
 * status) retain unscoped, tenant-wide authority, matching their existing
 * READ_ROLES-wide visibility.
 *
 * Driven against the live app + DB: a real visit_request row hosted by HOST,
 * a real JWT for a completely unrelated ATTACKER (role: employee only), plus
 * positive controls proving the fix doesn't over-block the host's own
 * actions or an elevated role's tenant-wide oversight.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { sqlClient, db } from "../src/shared/db.js";
import { buildApp } from "../src/app.js";
import { visitRequests } from "../src/modules/visit-request/schema.js";
import { locations } from "../src/modules/location/schema.js";

const SECRET = process.env.JWT_SECRET as string;
const TENANT = randomUUID();
const HOST = randomUUID();
// Has zero relationship to any of the visit requests below — not the host,
// not an admin/security role, just a plain "employee".
const ATTACKER = randomUUID();

const LOCATION = randomUUID();
const APPROVE_TARGET = randomUUID();
const REJECT_TARGET = randomUUID();
const CANCEL_TARGET = randomUUID();
// Positive-control targets (FIXED): prove the fix is scoped correctly —
// it must not block the request's own host, nor an elevated role acting on
// someone else's request as part of normal tenant-wide oversight.
const HOST_APPROVE_TARGET = randomUUID();
const ADMIN_REJECT_TARGET = randomUUID();
// An elevated-role actor with zero relationship to ADMIN_REJECT_TARGET
// either — proves the elevated-role exemption is role-based, not identity-based.
const ADMIN = randomUUID();

const BUSINESS_HOURS = { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null };

function attackerAuth(): Record<string, string> {
  return { authorization: `Bearer ${signToken({ sub: ATTACKER, tid: TENANT, roles: ["employee"], sid: "sess-attacker" }, SECRET, 3600)}` };
}

function hostAuth(): Record<string, string> {
  return { authorization: `Bearer ${signToken({ sub: HOST, tid: TENANT, roles: ["employee"], sid: "sess-host" }, SECRET, 3600)}` };
}

function adminAuth(): Record<string, string> {
  return { authorization: `Bearer ${signToken({ sub: ADMIN, tid: TENANT, roles: ["security_admin"], sid: "sess-admin" }, SECRET, 3600)}` };
}

async function seedRow(id: string): Promise<void> {
  await runWithTenant(TENANT, () =>
    db.transaction((tx) =>
      tx.insert(visitRequests).values({
        id, tenantId: TENANT, locationId: LOCATION, hostEmployeeId: HOST,
        status: "pending_approval", visitorName: "Stranger's Visitor", visitorPhone: "+911111111111",
        createdBy: HOST, updatedBy: HOST,
      }),
    ),
  );
}

beforeAll(async () => {
  await runWithTenant(TENANT, () =>
    db.transaction((tx) =>
      tx.insert(locations).values({
        id: LOCATION, tenantId: TENANT, name: "IDOR Test Location", businessHours: BUSINESS_HOURS,
        createdBy: HOST, updatedBy: HOST,
      }),
    ),
  );
  await seedRow(APPROVE_TARGET);
  await seedRow(REJECT_TARGET);
  await seedRow(CANCEL_TARGET);
  await seedRow(HOST_APPROVE_TARGET);
  await seedRow(ADMIN_REJECT_TARGET);
});

afterAll(async () => {
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.delete(visitRequests).where(eq(visitRequests.id, APPROVE_TARGET));
      await tx.delete(visitRequests).where(eq(visitRequests.id, REJECT_TARGET));
      await tx.delete(visitRequests).where(eq(visitRequests.id, CANCEL_TARGET));
      await tx.delete(visitRequests).where(eq(visitRequests.id, HOST_APPROVE_TARGET));
      await tx.delete(visitRequests).where(eq(visitRequests.id, ADMIN_REJECT_TARGET));
      await tx.delete(locations).where(eq(locations.id, LOCATION));
    }),
  );
  await sqlClient.end();
});

describe("cross-host approve/reject/cancel (FIXED)", () => {
  it("403s an approve from an actor who is not the visit request's host", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: `/v1/visitor/visit-requests/${APPROVE_TARGET}/approve`, headers: attackerAuth(),
    });
    await app.close();

    expect(res.statusCode).toBe(403);
    expect((res.json() as { code?: string }).code).toBe("FORBIDDEN");
  });

  it("403s a reject from an actor who is not the visit request's host", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: `/v1/visitor/visit-requests/${REJECT_TARGET}/reject`, headers: attackerAuth(),
      payload: { reason: "I don't like this visitor" },
    });
    await app.close();

    expect(res.statusCode).toBe(403);
    expect((res.json() as { code?: string }).code).toBe("FORBIDDEN");
  });

  it("403s a cancel from an actor who is not the visit request's host", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "DELETE", url: `/v1/visitor/visit-requests/${CANCEL_TARGET}`, headers: attackerAuth(),
    });
    await app.close();

    expect(res.statusCode).toBe(403);
    expect((res.json() as { code?: string }).code).toBe("FORBIDDEN");
  });
});

describe("what SHOULD happen (FIXED)", () => {
  it("an actor who is not the visit request's host cannot approve it", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: `/v1/visitor/visit-requests/${APPROVE_TARGET}/approve`, headers: attackerAuth(),
    });
    await app.close();

    expect(res.statusCode).toBe(403);
  });

  it("an actor who is not the visit request's host cannot reject it", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: `/v1/visitor/visit-requests/${REJECT_TARGET}/reject`, headers: attackerAuth(),
      payload: { reason: "I don't like this visitor" },
    });
    await app.close();

    expect(res.statusCode).toBe(403);
  });

  it("an actor who is not the visit request's host cannot cancel it", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "DELETE", url: `/v1/visitor/visit-requests/${CANCEL_TARGET}`, headers: attackerAuth(),
    });
    await app.close();

    expect(res.statusCode).toBe(403);
  });
});

describe("positive controls (FIXED — the fix is scoped correctly)", () => {
  it("the request's own host (role: employee) CAN still approve their own request", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: `/v1/visitor/visit-requests/${HOST_APPROVE_TARGET}/approve`, headers: hostAuth(),
    });
    await app.close();

    expect(res.statusCode).toBe(202);
  });

  it("an elevated role (security_admin) with no relationship to the request CAN still reject it — tenant-wide oversight is unaffected", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: `/v1/visitor/visit-requests/${ADMIN_REJECT_TARGET}/reject`, headers: adminAuth(),
      payload: { reason: "admin override" },
    });
    await app.close();

    expect(res.statusCode).toBe(202);
  });
});
