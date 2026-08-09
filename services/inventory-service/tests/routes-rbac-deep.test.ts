/**
 * Inventory Service — Route RBAC Tests.
 * Source: modules/items/routes.ts, modules/batches/routes.ts
 */
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { sqlClient } from "../src/shared/db.js";
import { buildApp } from "../src/app.js";

const SECRET = process.env.JWT_SECRET as string;
const TENANT = "ff110001-1111-4000-8000-000000inv001";
const ACTOR = "ff11aaaa-1111-4000-8000-000000inv00a";

function token(roles: string[]) { return signToken({ sub: ACTOR, tid: TENANT, roles, sid: "s" }, SECRET, 3600); }
const invUser = () => ({ authorization: `Bearer ${token(["inventory_user"])}` });
const unrelated = () => ({ authorization: `Bearer ${token(["employee"])}` });

afterAll(async () => { await sqlClient.end(); });

describe("POST /v1/inventory/items — RBAC", () => {
  it("401 without token", async () => {
    const app = await buildApp(); const r = await app.inject({ method: "POST", url: "/v1/inventory/items", payload: {} }); await app.close(); expect(r.statusCode).toBe(401);
  });
  it("403 for employee", async () => {
    const app = await buildApp(); const r = await app.inject({ method: "POST", url: "/v1/inventory/items", headers: unrelated(), payload: { name: "X" } }); await app.close(); expect(r.statusCode).toBe(403);
  });
  it("400 for missing name with valid role", async () => {
    const app = await buildApp(); const r = await app.inject({ method: "POST", url: "/v1/inventory/items", headers: invUser(), payload: {} }); await app.close(); expect(r.statusCode).toBe(400);
  });
  it("202 for valid create", async () => {
    const app = await buildApp(); const r = await app.inject({ method: "POST", url: "/v1/inventory/items", headers: invUser(), payload: { name: "Test Item" } }); await app.close(); expect(r.statusCode).toBe(202);
  });
});

describe("GET /v1/inventory/items — RBAC", () => {
  it("401 without token", async () => {
    const app = await buildApp(); const r = await app.inject({ method: "GET", url: "/v1/inventory/items" }); await app.close(); expect(r.statusCode).toBe(401);
  });
  it("403 for employee on list", async () => {
    const app = await buildApp(); const r = await app.inject({ method: "GET", url: "/v1/inventory/items", headers: unrelated() }); await app.close(); expect(r.statusCode).toBe(403);
  });
});
