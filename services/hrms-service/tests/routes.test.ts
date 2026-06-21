/**
 * hrms-service HTTP route tests (inject)
 *
 * Covers new routes added after the initial test suite:
 *   - GET /v1/hrms/attendance/regularisations
 *   - GET /v1/hrms/appraisals
 *   - GET /v1/hrms/org-chart
 *   - GET /v1/hrms/leave-requests
 *
 * Uses HS256 test JWTs (JWT_ALGORITHM=HS256 set in vitest.config.ts).
 */
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000011";

function makeToken(roles: string[] = ["hr_admin"]) {
  return signToken({ sub: "user-hrms-001", tid: TENANT, roles, sid: "sess-001" }, SECRET);
}

afterAll(async () => { await sqlClient.end(); });

// ── GET /v1/hrms/attendance/regularisations ───────────────────────────

describe("GET /v1/hrms/attendance/regularisations — shape", () => {
  it("returns 200 with array shape", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/hrms/attendance/regularisations",
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });

  it("returns 200 for manager role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/hrms/attendance/regularisations",
      headers: { authorization: `Bearer ${makeToken(["manager"])}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
  });

  it("returns 403 for wrong role (citizen)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/hrms/attendance/regularisations",
      headers: { authorization: `Bearer ${makeToken(["citizen"])}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ── GET /v1/hrms/appraisals ───────────────────────────────────────────

describe("GET /v1/hrms/appraisals — shape", () => {
  it("returns 200 with array shape", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/hrms/appraisals",
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });

  it("returns 403 for wrong role (citizen)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/hrms/appraisals",
      headers: { authorization: `Bearer ${makeToken(["citizen"])}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ── GET /v1/hrms/org-chart ────────────────────────────────────────────

describe("GET /v1/hrms/org-chart — shape", () => {
  it("returns 200 with array shape", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/hrms/org-chart",
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });

  it("returns 403 for wrong role (employee)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/hrms/org-chart",
      headers: { authorization: `Bearer ${makeToken(["employee"])}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ── GET /v1/hrms/leave-requests ───────────────────────────────────────

describe("GET /v1/hrms/leave-requests — shape", () => {
  it("returns 200 with array shape", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/hrms/leave-requests",
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    // LeaveRequestDetailListSchema = z.array(...) so response is an array
    expect(Array.isArray(res.json())).toBe(true);
  });

  it("returns 200 for employee role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/hrms/leave-requests",
      headers: { authorization: `Bearer ${makeToken(["employee"])}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
  });
});

// ── Unauthenticated requests ──────────────────────────────────────────

describe("unauthenticated requests", () => {
  it("GET /v1/hrms/attendance/regularisations without token → 401", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/hrms/attendance/regularisations" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("GET /v1/hrms/appraisals without token → 401", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/hrms/appraisals" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("GET /v1/hrms/org-chart without token → 401", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/hrms/org-chart" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("GET /v1/hrms/leave-requests without token → 401", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/hrms/leave-requests" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
});
