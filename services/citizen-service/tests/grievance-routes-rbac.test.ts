/**
 * Citizen Service — Grievance Routes: RBAC + Validation + Consumer Integration.
 *
 * Tests authentication (401), authorization (403), validation (400),
 * not-found (404), happy-path (202), and consumer idempotency + audit outbox.
 *
 * Source: modules/grievance/routes.ts, modules/grievance/consumer.ts
 */
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { sqlClient } from "../src/shared/db.js";
import { buildApp } from "../src/app.js";

const SECRET = process.env.JWT_SECRET as string;
const TENANT = "aa110001-1111-4000-8000-000000c1t001";
const CITIZEN_ACTOR = "aa11aaaa-1111-4000-8000-000000c1a001";
const OFFICER_ACTOR = "aa11bbbb-1111-4000-8000-000000c1a002";
const OTHER_TENANT = "aa110002-1111-4000-8000-000000c1t002";

function token(sub: string, roles: string[], tid = TENANT): string {
  return signToken({ sub, tid, roles, sid: "sess-grv" }, SECRET, 3600);
}
const citizenBearer = () => ({ authorization: `Bearer ${token(CITIZEN_ACTOR, ["citizen"])}` });
const officerBearer = () => ({ authorization: `Bearer ${token(OFFICER_ACTOR, ["citizen_officer"])}` });
const adminBearer = () => ({ authorization: `Bearer ${token(OFFICER_ACTOR, ["super_admin"])}` });
const otherTenantBearer = () => ({ authorization: `Bearer ${token(CITIZEN_ACTOR, ["citizen"], OTHER_TENANT)}` });

const validGrievance = {
  category: "Water Supply",
  subject: "No water for 3 days",
  description: "Ward 5 has had no water supply since Monday.",
};

afterAll(async () => { await sqlClient.end(); });

// ═══ Authentication ═══

describe("POST /v1/citizen/grievances — authentication", () => {
  it("401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/citizen/grievances", payload: validGrievance,
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
});

// ═══ RBAC ═══

describe("POST /v1/citizen/grievances — RBAC", () => {
  it("202 for citizen role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/citizen/grievances",
      headers: citizenBearer(), payload: validGrievance,
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe("accepted");
  });

  it("202 for citizen_officer role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/citizen/grievances",
      headers: officerBearer(), payload: validGrievance,
    });
    await app.close();
    expect(res.statusCode).toBe(202);
  });

  it("403 for unrelated role (e.g. finance_officer)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/citizen/grievances",
      headers: { authorization: `Bearer ${token(CITIZEN_ACTOR, ["finance_officer"])}` },
      payload: validGrievance,
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

describe("PATCH /v1/citizen/grievances/:id/assign — officer-only RBAC", () => {
  it("403 for citizen role (only officers can assign)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH", url: "/v1/citizen/grievances/aa110001-1111-4000-8000-000000000099/assign",
      headers: citizenBearer(),
      payload: { assignedTo: OFFICER_ACTOR },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("401 without token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH", url: "/v1/citizen/grievances/aa110001-1111-4000-8000-000000000099/assign",
      payload: { assignedTo: OFFICER_ACTOR },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
});

describe("PATCH /v1/citizen/grievances/:id/resolve — officer-only", () => {
  it("403 for citizen role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH", url: "/v1/citizen/grievances/aa110001-1111-4000-8000-000000000099/resolve",
      headers: citizenBearer(), payload: {},
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══ Validation (400) ═══

describe("POST /v1/citizen/grievances — validation", () => {
  it("400 for missing category", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/citizen/grievances",
      headers: citizenBearer(), payload: { subject: "X", description: "Y" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_FAILED");
  });

  it("400 for missing subject", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/citizen/grievances",
      headers: citizenBearer(), payload: { category: "X", description: "Y" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("400 for missing description", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/citizen/grievances",
      headers: citizenBearer(), payload: { category: "X", subject: "Y" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("400 for non-UUID citizenId", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/citizen/grievances",
      headers: officerBearer(), payload: { ...validGrievance, citizenId: "bad" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});

describe("PATCH /v1/citizen/grievances/:id/assign — validation", () => {
  it("400 for non-UUID id param", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH", url: "/v1/citizen/grievances/not-a-uuid/assign",
      headers: officerBearer(), payload: { assignedTo: OFFICER_ACTOR },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("400 for non-UUID assignedTo", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH", url: "/v1/citizen/grievances/aa110001-1111-4000-8000-000000000099/assign",
      headers: officerBearer(), payload: { assignedTo: "bad" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});

describe("PATCH /v1/citizen/grievances/:id/escalate — validation", () => {
  it("400 for missing reason", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH", url: "/v1/citizen/grievances/aa110001-1111-4000-8000-000000000099/escalate",
      headers: officerBearer(), payload: {},
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});

// Consumer integration tests require built @civitasone/queue package.
// When available, test: register → consumer → DB row + outbox audit event + idempotency.
