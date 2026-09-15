/**
 * COMP-007 -- estab-service `register` module smoke test.
 * Registered in app.ts (aggregate-counts endpoint across 5 establishment
 * tables, real DB reads inside one transaction for GUC/RLS consistency) but
 * had zero test references anywhere in the service.
 */
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000499";

function makeToken(roles: string[] = ["estab_admin"]) {
  return signToken({ sub: "user-comp007-estab", tid: TENANT, roles, sid: "sess-comp007-estab" }, SECRET);
}

afterAll(async () => {
  await sqlClient.end();
});

describe("COMP-007: register -- GET /v1/estab/register", () => {
  it("returns 401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/estab/register" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for a role outside the register ACL", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/estab/register",
      headers: { authorization: `Bearer ${makeToken(["citizen"])}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("returns 200 with real, non-negative counts across all 5 establishment tables", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/estab/register",
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const { data } = res.json();
    for (const key of ["vehicles", "drivers", "quarters", "officeRooms", "files"]) {
      expect(typeof data[key]).toBe("number");
      expect(data[key]).toBeGreaterThanOrEqual(0);
    }
    expect(typeof data.generatedAt).toBe("string");
  });
});
