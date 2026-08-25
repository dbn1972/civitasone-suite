/**
 * HIGH — cross-host IDOR (CWE-639) on visit-request approve/reject/cancel.
 *
 * modules/visit-request/routes.ts's approve/reject/DELETE(cancel) handlers
 * call `requireRole(ctx, APPROVAL_ROLES | WRITE_ROLES)` and then
 * `repo.getVisitRequestById(ctx.tenantId, id)` purely to 404 on a missing
 * row — at no point is `ctx.actorId` ever compared against the row's
 * `hostEmployeeId` (or any other ownership/relationship field). The
 * consumer (modules/visit-request/consumer.ts) doesn't check it either —
 * `visitRequestApprove`/`Reject`/`Cancel` all load the row by
 * `(id, tenantId)` alone.
 *
 * `APPROVAL_ROLES` and `WRITE_ROLES` both include the generic, broadly-held
 * "employee" role (routes.ts's own docstring: "any authenticated
 * employee/host can create and see requests" — that comment justifies
 * shared CREATE/LIST visibility, not unscoped approve/reject/cancel). The
 * practical effect: any "employee"-role actor in the tenant can approve,
 * reject, or cancel ANY other employee's hosted visit request — mirroring
 * the same IDOR class the security cluster found in the `identity` module
 * (verify-identity, PR #700).
 *
 * Driven against the live app + DB: a real visit_request row hosted by HOST,
 * a real JWT for a completely unrelated ATTACKER (role: employee only).
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

const BUSINESS_HOURS = { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null };

function attackerAuth(): Record<string, string> {
  return { authorization: `Bearer ${signToken({ sub: ATTACKER, tid: TENANT, roles: ["employee"], sid: "sess-attacker" }, SECRET, 3600)}` };
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
});

afterAll(async () => {
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.delete(visitRequests).where(eq(visitRequests.id, APPROVE_TARGET));
      await tx.delete(visitRequests).where(eq(visitRequests.id, REJECT_TARGET));
      await tx.delete(visitRequests).where(eq(visitRequests.id, CANCEL_TARGET));
      await tx.delete(locations).where(eq(locations.id, LOCATION));
    }),
  );
  await sqlClient.end();
});

describe("cross-host approve/reject/cancel (today's actual behavior)", () => {
  it("202-accepts an approve from an actor who is not the visit request's host", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: `/v1/visitor/visit-requests/${APPROVE_TARGET}/approve`, headers: attackerAuth(),
    });
    await app.close();

    expect(res.statusCode).toBe(202);
  });

  it("202-accepts a reject from an actor who is not the visit request's host", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: `/v1/visitor/visit-requests/${REJECT_TARGET}/reject`, headers: attackerAuth(),
      payload: { reason: "I don't like this visitor" },
    });
    await app.close();

    expect(res.statusCode).toBe(202);
  });

  it("202-accepts a cancel from an actor who is not the visit request's host", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "DELETE", url: `/v1/visitor/visit-requests/${CANCEL_TARGET}`, headers: attackerAuth(),
    });
    await app.close();

    expect(res.statusCode).toBe(202);
  });
});

describe("what SHOULD happen (fails today)", () => {
  it.fails("an actor who is not the visit request's host cannot approve it", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: `/v1/visitor/visit-requests/${APPROVE_TARGET}/approve`, headers: attackerAuth(),
    });
    await app.close();

    expect(res.statusCode).toBe(403);
  });

  it.fails("an actor who is not the visit request's host cannot reject it", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: `/v1/visitor/visit-requests/${REJECT_TARGET}/reject`, headers: attackerAuth(),
      payload: { reason: "I don't like this visitor" },
    });
    await app.close();

    expect(res.statusCode).toBe(403);
  });

  it.fails("an actor who is not the visit request's host cannot cancel it", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "DELETE", url: `/v1/visitor/visit-requests/${CANCEL_TARGET}`, headers: attackerAuth(),
    });
    await app.close();

    expect(res.statusCode).toBe(403);
  });
});
