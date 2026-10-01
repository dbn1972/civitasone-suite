/**
 * Location Service — Route-Level RBAC Tests.
 *
 * Tests authentication (401) and authorization (403) for cadastral parcel endpoints.
 * Allowed roles: super_admin, location_admin, revenue_officer, survey_officer
 * Blocked role: employee
 */
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { sqlClient } from "../src/shared/db.js";
import { buildApp } from "../src/app.js";

const SECRET = process.env.JWT_SECRET as string;
const TENANT = "aabb0001-bbbb-4000-8000-000000ab0001";
const ACTOR = "aabbaaaa-bbbb-4000-8000-000000ab000a";

function token(roles: string[]): string {
  return signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-loc" }, SECRET, 3600);
}

const blockedBearer = () => ({ authorization: `Bearer ${token(["employee"])}` });

afterAll(async () => { await sqlClient.end(); });

// ═══ POST /v1/locations/cadastral/parcels — write endpoint ═══

describe("POST /v1/locations/cadastral/parcels — auth", () => {
  it("401 without token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/locations/cadastral/parcels", payload: {} });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 for employee role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/locations/cadastral/parcels",
      headers: blockedBearer(),
      payload: { surveyNumber: "SN-001", district: "Test District", area: 1000 },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══ GAP-HR-LOCATIONS-06 — GET /v1/locations read-role widening ═══
//
// apps/web's /hr layout (hr/layout.tsx HR_ROLES) admits hr_officer, manager
// and employee to /hr/locations, which fetches this route unconditionally;
// before this gap's fix, only LOCATION_ROLES (location_user/location_admin/
// super_admin/admin/hr_admin) could read it, so those three roles got a
// 403 the web page rendered as a generic "couldn't load" error. Mutation
// stays on the original, narrower role list -- only the read path widened.
describe("GET /v1/locations — read-role widening (GAP-HR-LOCATIONS-06)", () => {
  it("200 for hr_officer (previously 403)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/locations",
      headers: { authorization: `Bearer ${token(["hr_officer"])}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
  });

  it("200 for manager (previously 403)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/locations",
      headers: { authorization: `Bearer ${token(["manager"])}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
  });

  it("200 for employee (previously 403)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/locations",
      headers: { authorization: `Bearer ${token(["employee"])}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
  });

  it("POST /v1/locations still 403 for hr_officer -- read widening must not widen write", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/locations",
      headers: { authorization: `Bearer ${token(["hr_officer"])}` },
      payload: { name: "Should Be Rejected" },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("POST /v1/locations still 202 for location_user -- original write role untouched", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/locations",
      headers: { authorization: `Bearer ${token(["location_user"])}` },
      payload: { name: "Test Office" },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
  });
});
