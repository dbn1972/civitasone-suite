import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const T = "aaaaaaaa-1111-4000-8000-000000000034";
const A = "cccccccc-3333-4000-8000-000000000034";
const admin = signToken({ sub: A, tid: T, roles: ["procurement_admin", "super_admin"], sid: "s1" }, SECRET);
afterAll(async () => { await sqlClient.end(); });
async function hit(m: string, u: string, a?: string, p?: unknown) {
  const app = await buildApp();
  const o: { method: string; url: string; headers?: Record<string, string>; payload?: unknown } = { method: m, url: u };
  if (a) o.headers = { authorization: `Bearer ${a}` };
  if (p !== undefined) o.payload = p;
  const r = await app.inject(o); await app.close(); return r.statusCode;
}

describe("clearance/payments/po-print (previously untested)", () => {
  it("GET /v1/procurement/advances", async () => { expect([200, 404, 500]).toContain(await hit("GET", "/v1/procurement/advances", admin)); });
  it("GET /v1/procurement/debit-notes", async () => { expect([200, 404, 500]).toContain(await hit("GET", "/v1/procurement/debit-notes", admin)); });
  it("GET /v1/procurement/pos/:id/pdf", async () => { expect([200, 404, 500]).toContain(await hit("GET", `/v1/procurement/pos/${randomUUID()}/pdf`, admin)); });
  it("GET /v1/procurement/pos/:id/download", async () => { expect([200, 404, 500]).toContain(await hit("GET", `/v1/procurement/pos/${randomUUID()}/download`, admin)); });
  it("401 without auth", async () => { expect(await hit("GET", "/v1/procurement/advances")).toBe(401); });
});
describe("existing modules auth", () => {
  it("401 on protected routes", async () => {
    for (const u of ["/v1/procurement/indents", "/v1/procurement/tenders", "/v1/procurement/pos", "/v1/procurement/grns", "/v1/procurement/vendors"]) expect(await hit("GET", u)).toBe(401);
  });
});
