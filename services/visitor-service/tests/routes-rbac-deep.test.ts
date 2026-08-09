/**
 * Visitor Service — Route-Level RBAC Tests.
 *
 * Tests authentication (401) and authorization (403) for visitor analytics endpoints.
 * Allowed roles: security_admin, protocol_officer, tenant_admin, super_admin
 * Blocked role: employee
 */
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { sqlClient } from "../src/shared/db.js";
import { buildApp } from "../src/app.js";

const SECRET = process.env.JWT_SECRET as string;
const TENANT = "aa880001-8888-4000-8000-000000a80001";
const ACTOR = "aa88aaaa-8888-4000-8000-000000a8000a";

function token(roles: string[]): string {
  return signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-vis" }, SECRET, 3600);
}

const blockedBearer = () => ({ authorization: `Bearer ${token(["employee"])}` });

afterAll(async () => { await sqlClient.end(); });

// ═══ GET /v1/visitor/analytics/daily — read endpoint ═══

describe("GET /v1/visitor/analytics/daily — auth", () => {
  it("401 without token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/visitor/analytics/daily" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 for employee role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/visitor/analytics/daily",
      headers: blockedBearer(),
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});
