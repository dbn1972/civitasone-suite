/**
 * Stock Service — Route-Level RBAC Tests.
 *
 * Tests authentication (401) and authorization (403) for stock endpoints.
 * Allowed roles: store_officer, store_admin, super_admin
 * Blocked role: employee
 */
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { sqlClient } from "../src/shared/db.js";
import { buildApp } from "../src/app.js";

const SECRET = process.env.JWT_SECRET as string;
const TENANT = "aa660001-6666-4000-8000-000000a60001";
const ACTOR = "aa66aaaa-6666-4000-8000-000000a6000a";

function token(roles: string[]): string {
  return signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-stk" }, SECRET, 3600);
}

const blockedBearer = () => ({ authorization: `Bearer ${token(["employee"])}` });

afterAll(async () => { await sqlClient.end(); });

// ═══ POST /v1/stock/entries — write endpoint ═══

describe("POST /v1/stock/entries — auth", () => {
  it("401 without token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/stock/entries", payload: {} });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 for employee role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/stock/entries",
      headers: blockedBearer(),
      payload: { itemId: "item-1", quantity: 10, type: "receipt" },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══ GET /v1/stock/dashboard — read endpoint ═══

describe("GET /v1/stock/dashboard — auth", () => {
  it("401 without token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/stock/dashboard" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 for employee role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/stock/dashboard",
      headers: blockedBearer(),
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});
