/**
 * Telephony Service — Route-Level RBAC Tests.
 *
 * Tests authentication (401) and authorization (403) for telephony agent endpoints.
 * Allowed roles: telephony_user, telephony_supervisor, telephony_admin, super_admin
 * Blocked role: employee
 */
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { sqlClient } from "../src/shared/db.js";
import { buildApp } from "../src/app.js";

const SECRET = process.env.JWT_SECRET as string;
const TENANT = "aa770001-7777-4000-8000-000000a70001";
const ACTOR = "aa77aaaa-7777-4000-8000-000000a7000a";

function token(roles: string[]): string {
  return signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-tel" }, SECRET, 3600);
}

const blockedBearer = () => ({ authorization: `Bearer ${token(["employee"])}` });

afterAll(async () => { await sqlClient.end(); });

// ═══ GET /v1/telephony/agents — read endpoint ═══

describe("GET /v1/telephony/agents — auth", () => {
  it("401 without token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/telephony/agents" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 for employee role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/telephony/agents",
      headers: blockedBearer(),
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});
