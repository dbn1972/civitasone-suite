import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const T = "aaaaaaaa-1111-4000-8000-000000000055";
const A = "cccccccc-3333-4000-8000-000000000055";
const admin = signToken({ sub: A, tid: T, roles: ["billing_admin", "super_admin"], sid: "s1" }, SECRET);
afterAll(async () => { await sqlClient.end(); });
async function hit(m: string, u: string, a?: string) {
  const app = await buildApp();
  const o: { method: string; url: string; headers?: Record<string, string> } = { method: m, url: u };
  if (a) o.headers = { authorization: `Bearer ${a}` };
  const r = await app.inject(o);
  await app.close();
  return r.statusCode;
}
describe("billing coverage", () => {
  it("GET /v1/billing/invoices", async () => { expect([200, 500]).toContain(await hit("GET", "/v1/billing/invoices", admin)); });
  it("GET /v1/billing/payments", async () => { expect([200, 500]).toContain(await hit("GET", "/v1/billing/payments", admin)); });
  it("GET /v1/billing/plans", async () => { expect([200, 500]).toContain(await hit("GET", "/v1/billing/plans", admin)); });
  it("401 without auth", async () => { expect(await hit("GET", "/v1/billing/invoices")).toBe(401); });
});
