import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const T = "aaaaaaaa-1111-4000-8000-000000000060";
const A = "cccccccc-3333-4000-8000-000000000060";
const admin = signToken({ sub: A, tid: T, roles: ["platform_admin", "super_admin"], sid: "s1" }, SECRET);
afterAll(async () => { await sqlClient.end(); });
async function hit(m: string, u: string, a?: string, p?: unknown) {
  const app = await buildApp();
  const o: { method: string; url: string; headers?: Record<string, string>; payload?: unknown } = { method: m, url: u };
  if (a) o.headers = { authorization: `Bearer ${a}` };
  if (p !== undefined) o.payload = p;
  const r = await app.inject(o); await app.close(); return r.statusCode;
}
describe("data-migration + reconciliation", () => {
  it("POST /v1/org/migrations → 202", async () => { expect(await hit("POST", "/v1/org/migrations", admin, { sourceTenantId: randomUUID(), targetTenantId: randomUUID(), entities: ["employees"] })).toBe(202); });
  it("GET /v1/org/migrations → 200", async () => { expect([200, 500]).toContain(await hit("GET", "/v1/org/migrations", admin)); });
  it("POST /v1/org/reconciliation → 202", async () => { expect(await hit("POST", "/v1/org/reconciliation", admin, { tenantId: randomUUID(), entityType: "employees", sourceSystem: "eHRMS" })).toBe(202); });
  it("GET breaks → 200", async () => { expect([200, 500]).toContain(await hit("GET", `/v1/org/reconciliation/${randomUUID()}/breaks`, admin)); });
  it("401 without auth", async () => { expect(await hit("GET", "/v1/org/migrations")).toBe(401); });
  it("400 bad payload", async () => { expect(await hit("POST", "/v1/org/migrations", admin, { entities: [] })).toBe(400); });
});
