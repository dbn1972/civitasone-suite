/**
 * Contract Service — Route-Level RBAC + Validation Tests.
 *
 * Source: modules/contracts/routes.ts
 */
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { sqlClient } from "../src/shared/db.js";
import { buildApp } from "../src/app.js";

const SECRET = process.env.JWT_SECRET as string;
const TENANT = "ee550001-1111-4000-8000-000000ct0001";
const ACTOR = "ee55aaaa-1111-4000-8000-000000ct000a";
const CONTRACT_ID = "ee551111-1111-4000-8000-000000000001";

function token(roles: string[], tid = TENANT): string {
  return signToken({ sub: ACTOR, tid, roles, sid: "sess-ct" }, SECRET, 3600);
}
const adminBearer = () => ({ authorization: `Bearer ${token(["procurement_admin"])}` });
const unrelated = () => ({ authorization: `Bearer ${token(["employee"])}` });

afterAll(async () => { await sqlClient.end(); });

describe("POST /v1/contract/contracts — RBAC", () => {
  it("401 without token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/contract/contracts", payload: {} });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 for unrelated role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/contract/contracts",
      headers: unrelated(), payload: { title: "Test" },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("400 for missing fields with admin", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/contract/contracts",
      headers: adminBearer(), payload: {},
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});

describe("POST /v1/contract/contracts/:id/approve — RBAC", () => {
  it("401 without token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: `/v1/contract/contracts/${CONTRACT_ID}/approve`, payload: {} });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 for employee", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: `/v1/contract/contracts/${CONTRACT_ID}/approve`,
      headers: unrelated(), payload: {},
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

describe("POST /v1/contract/contracts/:id/terminate — RBAC", () => {
  it("401 without token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: `/v1/contract/contracts/${CONTRACT_ID}/terminate`, payload: {} });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 for unrelated", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: `/v1/contract/contracts/${CONTRACT_ID}/terminate`,
      headers: unrelated(), payload: { reason: "Breach" },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/contract/contracts — RBAC", () => {
  it("401 without token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/contract/contracts" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
});
