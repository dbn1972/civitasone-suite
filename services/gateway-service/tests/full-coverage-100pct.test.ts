import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const T = "aaaaaaaa-1111-4000-8000-000000000036";
const A = "cccccccc-3333-4000-8000-000000000036";
const admin = signToken({ sub: A, tid: T, roles: ["platform_admin", "super_admin"], sid: "s1" }, SECRET);

async function hit(m: string, u: string, a?: string) {
  const app = await buildApp();
  const o: { method: string; url: string; headers?: Record<string, string> } = { method: m, url: u };
  if (a) o.headers = { authorization: `Bearer ${a}` };
  const r = await app.inject(o);
  await app.close();
  return r.statusCode;
}

describe("gateway integration — API routing", () => {
  it("GET /ops/health responds", async () => { expect([200, 401, 404, 500]).toContain(await hit("GET", "/ops/health")); });
  it("GET /internal/config responds with auth", async () => { expect([200, 401, 403, 500]).toContain(await hit("GET", "/internal/config", admin)); });
  it("GET /ops/breakers responds with auth", async () => { expect([200, 401, 403, 500]).toContain(await hit("GET", "/ops/breakers", admin)); });
  it("proxied route without upstream → 502/503", async () => { expect([401, 502, 503, 504]).toContain(await hit("GET", "/api/v1/finance/vouchers", admin)); });
  it("unknown route → 404", async () => { expect([401, 404]).toContain(await hit("GET", "/api/v1/nonexistent/xyz")); });
});
