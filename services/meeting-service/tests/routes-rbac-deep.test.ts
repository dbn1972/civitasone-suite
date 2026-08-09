/**
 * Meeting Service — Route-Level RBAC Tests.
 *
 * Tests authentication (401) and authorization (403) for meeting list endpoints.
 * Allowed roles: tenant_admin, super_admin
 * Blocked role: employee
 */
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { sqlClient } from "../src/shared/db.js";
import { buildApp } from "../src/app.js";

const SECRET = process.env.JWT_SECRET as string;
const TENANT = "aa990001-9999-4000-8000-000000a90001";
const ACTOR = "aa99aaaa-9999-4000-8000-000000a9000a";

function token(roles: string[]): string {
  return signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-mtg" }, SECRET, 3600);
}

const blockedBearer = () => ({ authorization: `Bearer ${token(["employee"])}` });

afterAll(async () => { await sqlClient.end(); });

// ═══ GET /v1/meetings — read endpoint ═══

describe("GET /v1/meetings — auth", () => {
  it("401 without token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/meetings" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 for employee role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/meetings",
      headers: blockedBearer(),
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});
