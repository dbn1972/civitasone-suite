/**
 * Project Service — Route-Level RBAC Tests.
 *
 * Tests authentication (401) and authorization (403) for project endpoints.
 * Allowed roles: project_manager, project_officer, super_admin
 * Blocked role: employee
 */
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { sqlClient } from "../src/shared/db.js";
import { buildApp } from "../src/app.js";

const SECRET = process.env.JWT_SECRET as string;
const TENANT = "aa110001-1111-4000-8000-000000a10001";
const ACTOR = "aa11aaaa-1111-4000-8000-000000a1000a";

function token(roles: string[]): string {
  return signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-proj" }, SECRET, 3600);
}

const blockedBearer = () => ({ authorization: `Bearer ${token(["employee"])}` });

afterAll(async () => { await sqlClient.end(); });

// ═══ POST /v1/projects — write endpoint ═══

describe("POST /v1/projects — auth", () => {
  it("401 without token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/projects", payload: {} });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 for employee role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/projects",
      headers: blockedBearer(),
      payload: { name: "Test Project", code: "TP-001" },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══ GET /v1/projects — read endpoint ═══

describe("GET /v1/projects — auth", () => {
  it("401 without token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/projects" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 for employee role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/projects",
      headers: blockedBearer(),
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});
