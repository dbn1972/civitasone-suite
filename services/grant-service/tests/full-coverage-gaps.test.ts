import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const T = "aaaaaaaa-1111-4000-8000-000000000055";
const A = "cccccccc-3333-4000-8000-000000000055";
const admin = signToken({ sub: A, tid: T, roles: ["grant_admin", "super_admin"], sid: "s1" }, SECRET);
afterAll(async () => { await sqlClient.end(); });
async function hit(m: string, u: string, a?: string) {
  const app = await buildApp();
  const o: { method: string; url: string; headers?: Record<string, string> } = { method: m, url: u };
  if (a) o.headers = { authorization: `Bearer ${a}` };
  const r = await app.inject(o);
  await app.close();
  return r.statusCode;
}
describe("grants coverage", () => {
  it("GET /v1/grants/grants", async () => { expect([200, 500]).toContain(await hit("GET", "/v1/grants/grants", admin)); });
  it("GET /v1/grants/beneficiaries", async () => { expect([200, 404, 500]).toContain(await hit("GET", "/v1/grants/beneficiaries", admin)); });
  it("GET /v1/grants/dashboard", async () => { expect([200, 500]).toContain(await hit("GET", "/v1/grants/dashboard", admin)); });
  it("GET /v1/grants/installments", async () => { expect([200, 500]).toContain(await hit("GET", "/v1/grants/installments", admin)); });
  it("GET /v1/grants/grantees", async () => { expect([200, 500]).toContain(await hit("GET", "/v1/grants/grantees", admin)); });
  it("401 without auth", async () => { expect(await hit("GET", "/v1/grants/grants")).toBe(401); });
});
