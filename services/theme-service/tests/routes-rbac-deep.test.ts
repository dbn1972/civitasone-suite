/**
 * Theme Service — Route-Level RBAC Tests.
 *
 * Tests authentication (401) and authorization (403) for branding endpoints.
 * Allowed roles: theme_admin, super_admin
 * Blocked role: employee
 */
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { sqlClient } from "../src/shared/db.js";
import { buildApp } from "../src/app.js";

const SECRET = process.env.JWT_SECRET as string;
const TENANT = "aa550001-5555-4000-8000-000000a50001";
const ACTOR = "aa55aaaa-5555-4000-8000-000000a5000a";

function token(roles: string[]): string {
  return signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-thm" }, SECRET, 3600);
}

const blockedBearer = () => ({ authorization: `Bearer ${token(["employee"])}` });

afterAll(async () => { await sqlClient.end(); });

// ═══ PUT /v1/themes/branding — write endpoint ═══

describe("PUT /v1/themes/branding — auth", () => {
  it("401 without token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "PUT", url: "/v1/themes/branding", payload: {} });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 for employee role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PUT", url: "/v1/themes/branding",
      headers: blockedBearer(),
      payload: { primaryColor: "#000000", logoUrl: "https://example.com/logo.png" },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══ GET /v1/themes/branding — read endpoint ═══

describe("GET /v1/themes/branding — auth", () => {
  it("401 without token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/themes/branding" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 for employee role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/themes/branding",
      headers: blockedBearer(),
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});
