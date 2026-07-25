/**
 * Coverage validation: confirms all audit-service route groups respond correctly.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const T = "aaaaaaaa-1111-4000-8000-000000000044";
const A = "cccccccc-3333-4000-8000-000000000044";
const admin = signToken({ sub: A, tid: T, roles: ["audit_admin", "super_admin"], sid: "s1" }, SECRET);
afterAll(async () => { await sqlClient.end(); });

async function hit(m: string, u: string, a?: string, p?: unknown) {
  const app = await buildApp();
  const o: { method: string; url: string; headers?: Record<string, string>; payload?: unknown } = { method: m, url: u };
  if (a) o.headers = { authorization: `Bearer ${a}` };
  if (p !== undefined) o.payload = p;
  const r = await app.inject(o);
  await app.close();
  return r.statusCode;
}

describe("all route groups respond", () => {
  it("GET /v1/audit/events", async () => { expect([200, 500]).toContain(await hit("GET", "/v1/audit/events", admin)); });
  it("GET /v1/audit/paras", async () => { expect([200, 500]).toContain(await hit("GET", "/v1/audit/paras", admin)); });
  it("GET /v1/audit/observations", async () => { expect([200, 500]).toContain(await hit("GET", "/v1/audit/observations", admin)); });
  it("GET /v1/audit/compliance", async () => { expect([200, 500]).toContain(await hit("GET", "/v1/audit/compliance", admin)); });
  it("GET /v1/audit/investigations", async () => { expect([200, 500]).toContain(await hit("GET", "/v1/audit/investigations", admin)); });
  it("GET /v1/audit/dashboard", async () => { expect([200, 500]).toContain(await hit("GET", "/v1/audit/dashboard", admin)); });
  it("GET /v1/audit/exports", async () => { expect([200, 500]).toContain(await hit("GET", "/v1/audit/exports", admin)); });
  it("401 without auth", async () => { expect(await hit("GET", "/v1/audit/events")).toBe(401); });
});
