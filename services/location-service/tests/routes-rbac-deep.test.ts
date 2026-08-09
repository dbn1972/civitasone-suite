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
