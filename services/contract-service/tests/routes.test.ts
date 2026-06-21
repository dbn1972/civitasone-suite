/**
 * contract-service HTTP route tests (inject)
 *
 * Confirms list + detail routes return 200 + correct shape.
 */
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-5555-4000-8000-000000000099";

function makeToken(roles: string[] = ["audit_officer"]) {
  return signToken({ sub: "user-con-001", tid: TENANT, roles, sid: "sess-con-001" }, SECRET);
}

afterAll(async () => { await sqlClient.end(); });

describe("GET /v1/contract/contracts — shape", () => {
  it("returns 200 with data + pagination shape", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/contract/contracts",
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.pagination).toBeDefined();
  });

  it("tenant isolation: different tenant sees empty list", async () => {
    const app = await buildApp();
    const otherTenant = "dddddddd-6666-4000-8000-000000000099";
    const token = signToken({ sub: "u2", tid: otherTenant, roles: ["audit_officer"], sid: "s2" }, SECRET);
    const res = await app.inject({
      method: "GET",
      url: "/v1/contract/contracts",
      headers: { authorization: `Bearer ${token}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([]);
  });

  it("returns 403 for wrong role", async () => {
    const app = await buildApp();
    const token = makeToken(["citizen"]);
    const res = await app.inject({
      method: "GET",
      url: "/v1/contract/contracts",
      headers: { authorization: `Bearer ${token}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/contract/contracts/:id — shape", () => {
  it("returns 404 for unknown contract", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/contract/contracts/00000000-0000-4000-8000-000000000000",
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });
});

describe("unauthenticated requests", () => {
  it("GET /v1/contract/contracts without token → 401", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/contract/contracts" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
});
