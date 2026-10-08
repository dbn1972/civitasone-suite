/**
 * GAP2-VISITOR-VISIT-REQUESTS-01 (HIGH, NEW) — the visit-request LIST read
 * was role-gated to READ_ROLES (which includes the broadly-held, low-privilege
 * "employee" role) but was NOT scoped to the caller's own hosted requests, and
 * returned the full decrypted row — including visitorPhone and visitorEmail.
 * A plain "employee" calling GET /v1/visitor/visit-requests directly received
 * every visitor's name + phone + email for every host in the tenant.
 *
 * FIXED (routes.ts + repo.ts):
 *   - callers lacking ELEVATED_APPROVAL_ROLES are forced to their own hosted
 *     requests (filter.hostEmployeeId = ctx.actorId), mirroring assertOwnsRequest;
 *   - the list projection omits raw visitorPhone / visitorEmail (and the
 *     encrypted identityDocRef) — full contact only on the owner/elevated
 *     detail read, which already logs PII access.
 *
 * Driven against the live app + DB: two approved requests, one hosted by E1
 * and one by E2, read as E1 (role: employee only).
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
const E1 = randomUUID();
const E2 = randomUUID();
const ADMIN = randomUUID();
const LOCATION = randomUUID();
const E1_REQUEST = randomUUID();
const E2_REQUEST = randomUUID();

const BUSINESS_HOURS = { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null };

function auth(sub: string, roles: string[]): Record<string, string> {
  return { authorization: `Bearer ${signToken({ sub, tid: TENANT, roles, sid: `sess-${sub.slice(0, 8)}` }, SECRET, 3600)}` };
}

async function seedRow(id: string, host: string, phone: string, email: string): Promise<void> {
  await runWithTenant(TENANT, () =>
    db.transaction((tx) =>
      tx.insert(visitRequests).values({
        id, tenantId: TENANT, locationId: LOCATION, hostEmployeeId: host,
        status: "approved", visitorName: `Visitor of ${host.slice(0, 8)}`,
        visitorPhone: phone, visitorEmail: email,
        createdBy: host, updatedBy: host,
      }),
    ),
  );
}

beforeAll(async () => {
  await runWithTenant(TENANT, () =>
    db.transaction((tx) =>
      tx.insert(locations).values({
        id: LOCATION, tenantId: TENANT, name: "List Scope Test Location", businessHours: BUSINESS_HOURS,
        createdBy: E1, updatedBy: E1,
      }),
    ),
  );
  await seedRow(E1_REQUEST, E1, "+919000000001", "e1visitor@example.test");
  await seedRow(E2_REQUEST, E2, "+919000000002", "e2visitor@example.test");
});

afterAll(async () => {
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.delete(visitRequests).where(eq(visitRequests.id, E1_REQUEST));
      await tx.delete(visitRequests).where(eq(visitRequests.id, E2_REQUEST));
      await tx.delete(locations).where(eq(locations.id, LOCATION));
    }),
  );
  await sqlClient.end();
});

describe("GET /v1/visitor/visit-requests host-scoping + PII omission (FIXED)", () => {
  it("a plain employee sees ONLY their own hosted request, not other hosts'", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: `/v1/visitor/visit-requests?status=approved`, headers: auth(E1, ["employee"]),
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const rows = (res.json() as { data: Array<{ id: string; hostEmployeeId: string }> }).data;
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(E1_REQUEST);
    expect(ids).not.toContain(E2_REQUEST);
    for (const r of rows) expect(r.hostEmployeeId).toBe(E1);
  });

  it("does not return raw visitorPhone / visitorEmail in the list body", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: `/v1/visitor/visit-requests?status=approved`, headers: auth(E1, ["employee"]),
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    // No raw contact PII anywhere in the serialized list body.
    expect(res.body).not.toContain("+919000000001");
    expect(res.body).not.toContain("e1visitor@example.test");
    const rows = (res.json() as { data: Array<Record<string, unknown>> }).data;
    for (const r of rows) {
      expect(r.visitorPhone).toBeUndefined();
      expect(r.visitorEmail).toBeUndefined();
    }
  });

  it("an elevated role (security_admin) still sees every host's request (tenant-wide oversight)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: `/v1/visitor/visit-requests?status=approved`, headers: auth(ADMIN, ["security_admin"]),
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const ids = (res.json() as { data: Array<{ id: string }> }).data.map((r) => r.id);
    expect(ids).toContain(E1_REQUEST);
    expect(ids).toContain(E2_REQUEST);
  });
});
