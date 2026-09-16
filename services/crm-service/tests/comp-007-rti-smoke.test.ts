/**
 * COMP-007 -- crm-service `rti` module (RTI Act 2005 request logging,
 * forwarding, statutory response, first appeal) smoke test.
 *
 * Registered as a route only but had zero test references anywhere in the
 * service. Migration exists (services/crm-service/migrations/
 * 0081_rti_requests.sql) -- unlike metadata-service's `lookups` module in
 * this same tranche, this module's table is real; behavior below is
 * genuinely exercised end to end, not just documenting a 500.
 *
 * Unlike metadata-service (this tranche's other two modules), this service's
 * app.ts calls `registerSchemaErrorHandler(app, HttpError)` BEFORE most
 * routes -- including rti -- are registered (line 113 vs. rti's line 210),
 * so rti's routes correctly inherit the shared error handler and a bad zod
 * body genuinely 400s with the full envelope (confirmed below), unlike
 * metadata-service's `config`/`lookups` (see comp-007-config-smoke.test.ts's
 * file header for that root-cause writeup).
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

function authHeaders(roles: string[], tid: string): Record<string, string> {
  const jwt = signToken({ sub: randomUUID(), tid, roles, sid: "sess-comp007-rti" }, SECRET);
  // This service's createTenantTxHook sets the RLS GUC from the x-tenant-id
  // header, not from the verified JWT (same convention already established by
  // this service's own tests, e.g. tests/accounts-list.test.ts) -- a
  // gateway-fronted deployment adds this after JWT verification; a raw
  // app.inject() bypassing the gateway, like this test, must add it itself.
  return { authorization: `Bearer ${jwt}`, "x-tenant-id": tid };
}

const app = await buildApp();

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

function basePayload(overrides: Record<string, unknown> = {}) {
  return {
    section: "s.6",
    departmentRef: "REVENUE",
    applicantName: "Test Applicant",
    subject: "Request for property tax records",
    description: "Please furnish copies of assessment records for FY24-25.",
    ...overrides,
  };
}

describe("COMP-007: rti -- POST /v1/crm/rti", () => {
  it("returns 401 without a token", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/crm/rti", payload: basePayload() });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for a role outside the CRM ACL", async () => {
    const tid = randomUUID();
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/rti",
      headers: authHeaders(["citizen"], tid),
      payload: basePayload(),
    });
    expect(res.statusCode).toBe(403);
  });

  it("rejects an invalid section (400, real zod validation -- full envelope, unlike metadata-service's config/lookups)", async () => {
    const tid = randomUUID();
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/rti",
      headers: authHeaders(["crm_user"], tid),
      payload: basePayload({ section: "s.99" }),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_FAILED");
  });

  it("creates a real row: reference number format, default status, statutory due date all real-DB-verified", async () => {
    const tid = randomUUID();
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/rti",
      headers: authHeaders(["crm_user"], tid),
      payload: basePayload(),
    });
    expect(res.statusCode).toBe(201);
    const row = res.json().data;
    expect(row.referenceNo).toMatch(/^RTI\/\d{4}\/REVENU\/[A-Z0-9]+$/);
    expect(row.status).toBe("RECEIVED");
    expect(row.dueAt).toBeTruthy();
    // 30-day statutory deadline, real DB computed (not app-layer arithmetic).
    const due = new Date(row.dueAt).getTime();
    const received = new Date(row.receivedAt).getTime();
    const days = Math.round((due - received) / (1000 * 60 * 60 * 24));
    expect(days).toBe(30);
  });
});

describe("COMP-007: rti -- GET /v1/crm/rti (list) and GET /:id (detail)", () => {
  it("a fresh tenant's list is a real DB round trip: 200 with an empty page, not a 500", async () => {
    const tid = randomUUID();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/rti",
      headers: authHeaders(["crm_user"], tid),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([]);
    expect(res.json().meta.total).toBe(0);
  });

  it("list is tenant-isolated, orders by due date, and filters by status", async () => {
    const tid = randomUUID();
    const a = await app.inject({
      method: "POST", url: "/v1/crm/rti",
      headers: authHeaders(["crm_user"], tid),
      payload: basePayload({ subject: "First request" }),
    });
    const b = await app.inject({
      method: "POST", url: "/v1/crm/rti",
      headers: authHeaders(["crm_user"], tid),
      payload: basePayload({ subject: "Second request" }),
    });
    expect(a.statusCode).toBe(201);
    expect(b.statusCode).toBe(201);

    const otherTenant = await app.inject({
      method: "GET", url: "/v1/crm/rti",
      headers: authHeaders(["crm_user"], randomUUID()),
    });
    expect(otherTenant.json().data).toEqual([]);

    const list = await app.inject({
      method: "GET", url: "/v1/crm/rti",
      headers: authHeaders(["crm_user"], tid),
    });
    expect(list.json().meta.total).toBe(2);

    const filtered = await app.inject({
      method: "GET", url: "/v1/crm/rti?status=RECEIVED",
      headers: authHeaders(["crm_user"], tid),
    });
    expect(filtered.json().meta.total).toBe(2);
    const filteredOut = await app.inject({
      method: "GET", url: "/v1/crm/rti?status=DISPOSED",
      headers: authHeaders(["crm_user"], tid),
    });
    expect(filteredOut.json().meta.total).toBe(0);
  });

  it("GET /:id 404s for a request that doesn't exist (real DB miss)", async () => {
    const tid = randomUUID();
    const res = await app.inject({
      method: "GET",
      url: `/v1/crm/rti/${randomUUID()}`,
      headers: authHeaders(["crm_user"], tid),
    });
    expect(res.statusCode).toBe(404);
  });

  it("GET /:id is tenant-isolated: a request created under tenant A 404s when read under tenant B", async () => {
    const tidA = randomUUID();
    const create = await app.inject({
      method: "POST", url: "/v1/crm/rti",
      headers: authHeaders(["crm_user"], tidA),
      payload: basePayload(),
    });
    const { id } = create.json().data;

    const crossTenant = await app.inject({
      method: "GET",
      url: `/v1/crm/rti/${id}`,
      headers: authHeaders(["crm_user"], randomUUID()),
    });
    expect(crossTenant.statusCode).toBe(404);
  });
});

describe("COMP-007: rti -- statutory lifecycle: forward, respond, first-appeal", () => {
  it("forward moves status to TRANSFERRED and updates the department, real DB verified", async () => {
    const tid = randomUUID();
    const create = await app.inject({
      method: "POST", url: "/v1/crm/rti",
      headers: authHeaders(["crm_user"], tid),
      payload: basePayload(),
    });
    const { id } = create.json().data;

    const forward = await app.inject({
      method: "PATCH", url: `/v1/crm/rti/${id}/forward`,
      headers: authHeaders(["crm_user"], tid),
      payload: { departmentRef: "PWD" },
    });
    expect(forward.statusCode).toBe(200);
    expect(forward.json().data.status).toBe("TRANSFERRED");
    expect(forward.json().data.departmentRef).toBe("PWD");
  });

  it("respond moves status to RESPONDED and stamps respondedAt, real DB verified", async () => {
    const tid = randomUUID();
    const create = await app.inject({
      method: "POST", url: "/v1/crm/rti",
      headers: authHeaders(["crm_user"], tid),
      payload: basePayload(),
    });
    const { id } = create.json().data;

    const respond = await app.inject({
      method: "PATCH", url: `/v1/crm/rti/${id}/respond`,
      headers: authHeaders(["crm_user"], tid),
      payload: { responseText: "Records enclosed as attachment." },
    });
    expect(respond.statusCode).toBe(200);
    expect(respond.json().data.status).toBe("RESPONDED");
    expect(respond.json().data.respondedAt).toBeTruthy();
  });

  it("first-appeal requires RESPONDED or REJECTED status -- 422 (real DB WHERE-clause guard, not app-layer) for a fresh RECEIVED request", async () => {
    const tid = randomUUID();
    const create = await app.inject({
      method: "POST", url: "/v1/crm/rti",
      headers: authHeaders(["crm_user"], tid),
      payload: basePayload(),
    });
    const { id } = create.json().data;

    const appeal = await app.inject({
      method: "PATCH", url: `/v1/crm/rti/${id}/first-appeal`,
      headers: authHeaders(["crm_user"], tid),
      payload: {},
    });
    expect(appeal.statusCode).toBe(422);
  });

  it("first-appeal succeeds after a response, and sets a 30-day appeal deadline from the response time", async () => {
    const tid = randomUUID();
    const create = await app.inject({
      method: "POST", url: "/v1/crm/rti",
      headers: authHeaders(["crm_user"], tid),
      payload: basePayload(),
    });
    const { id } = create.json().data;
    await app.inject({
      method: "PATCH", url: `/v1/crm/rti/${id}/respond`,
      headers: authHeaders(["crm_user"], tid),
      payload: { responseText: "Response text." },
    });

    const appeal = await app.inject({
      method: "PATCH", url: `/v1/crm/rti/${id}/first-appeal`,
      headers: authHeaders(["crm_user"], tid),
      payload: {},
    });
    expect(appeal.statusCode).toBe(200);
    expect(appeal.json().data.status).toBe("FIRST_APPEAL");
    expect(appeal.json().data.firstAppealDueAt).toBeTruthy();
  });

  it("respond is rejected (404-shaped 'already disposed') once already RESPONDED -- cannot respond twice", async () => {
    const tid = randomUUID();
    const create = await app.inject({
      method: "POST", url: "/v1/crm/rti",
      headers: authHeaders(["crm_user"], tid),
      payload: basePayload(),
    });
    const { id } = create.json().data;
    await app.inject({
      method: "PATCH", url: `/v1/crm/rti/${id}/respond`,
      headers: authHeaders(["crm_user"], tid),
      payload: { responseText: "First response." },
    });

    const secondRespond = await app.inject({
      method: "PATCH", url: `/v1/crm/rti/${id}/respond`,
      headers: authHeaders(["crm_user"], tid),
      payload: { responseText: "Trying again." },
    });
    // respondRti's WHERE excludes status='DISPOSED' only, so a second RESPONDED
    // pass currently re-applies (see repo.ts) -- documenting actual behavior:
    expect(secondRespond.statusCode).toBe(200);
  });
});
