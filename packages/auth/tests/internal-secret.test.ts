/**
 * R12 — x-internal service-to-service path hardening.
 *
 * The internal elevation path must:
 *   - reject when no INTERNAL_SERVICE_SECRET is configured
 *   - reject a wrong secret (and a wrong-length secret) — compared in constant time
 *   - grant the service-account context only on an exact match
 *
 * We exercise the real authPlugin on a Fastify instance via inject().
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { authPlugin } from "../src/plugin.js";

const SECRET = "super-secret-internal-value-1234567890";
const TENANT = "00000000-0000-0000-0000-000000000001";
const ORIGINAL_ENV = { ...process.env };

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(authPlugin);
  app.get("/v1/probe", async (req) => ({ tenantId: req.ctx.tenantId, roles: req.ctx.roles, actorType: req.ctx.actorType }));
  await app.ready();
  return app;
}

beforeEach(() => { process.env = { ...ORIGINAL_ENV, NODE_ENV: "test", INTERNAL_SERVICE_SECRET: SECRET }; });
afterEach(() => { process.env = { ...ORIGINAL_ENV }; });

describe("R12: x-internal secret hardening", () => {
  it("grants service-account context on an exact secret match", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/probe",
      headers: { "x-internal": "1", "x-tenant-id": TENANT, "x-service-secret": SECRET },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.tenantId).toBe(TENANT);
    expect(body.actorType).toBe("service_account");
    expect(body.roles).toContain("super_admin");
  });

  it("rejects a wrong secret of equal length", async () => {
    const app = await buildApp();
    const wrong = "x".repeat(SECRET.length);
    const res = await app.inject({
      method: "GET", url: "/v1/probe",
      headers: { "x-internal": "1", "x-tenant-id": TENANT, "x-service-secret": wrong },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("rejects a wrong-length secret", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/probe",
      headers: { "x-internal": "1", "x-tenant-id": TENANT, "x-service-secret": "short" },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("rejects when no secret is provided", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/probe",
      headers: { "x-internal": "1", "x-tenant-id": TENANT },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("rejects the internal path when the server has no secret configured", async () => {
    delete process.env.INTERNAL_SERVICE_SECRET;
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/probe",
      headers: { "x-internal": "1", "x-tenant-id": TENANT, "x-service-secret": "anything" },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
});
