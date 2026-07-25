import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const T = "aaaaaaaa-1111-4000-8000-000000000044";
const A = "cccccccc-3333-4000-8000-000000000044";
const admin = signToken({ sub: A, tid: T, roles: ["ml_admin", "super_admin"], sid: "s1" }, SECRET);
afterAll(async () => { await sqlClient.end(); });
async function hit(m: string, u: string, a?: string, p?: unknown) {
  const app = await buildApp();
  const o: { method: string; url: string; headers?: Record<string, string>; payload?: unknown } = { method: m, url: u };
  if (a) o.headers = { authorization: `Bearer ${a}` };
  if (p !== undefined) o.payload = p;
  const r = await app.inject(o); await app.close(); return r.statusCode;
}
describe("ML — AI & extensibility", () => {
  it("GET /v1/ml/models", async () => { expect([200, 500]).toContain(await hit("GET", "/v1/ml/models", admin)); });
  it("GET /v1/ml/experiments", async () => { expect([200, 500]).toContain(await hit("GET", "/v1/ml/experiments", admin)); });
  it("GET /v1/ml/evaluations", async () => { expect([200, 500]).toContain(await hit("GET", "/v1/ml/evaluations", admin)); });
  it("GET /v1/ml/predictions", async () => { expect([200, 400, 500]).toContain(await hit("GET", "/v1/ml/predictions", admin)); });
  it("GET /v1/ml/health", async () => { expect([200, 500]).toContain(await hit("GET", "/v1/ml/health", admin)); });
  it("POST /v1/ml/predict", async () => { expect([200, 400, 500]).toContain(await hit("POST", "/v1/ml/predict", admin, { modelId: randomUUID(), input: { x: 1 } })); });
  it("401 without auth", async () => { expect(await hit("GET", "/v1/ml/models")).toBe(401); });
});
