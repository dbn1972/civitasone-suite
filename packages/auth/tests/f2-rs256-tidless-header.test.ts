/**
 * F2 follow-up (PR #2428 review): in NODE_ENV=development, toRequestContext's
 * x-tenant-id fallback used to apply to ANY token without a tid claim, including
 * RS256 Keycloak-verified ones (UAT Keycloak has enabled users without the
 * tenantId attribute). A direct-to-service request with such a real token plus a
 * chosen x-tenant-id then set the ctx tenant -- and so the RLS GUC -- to any
 * tenant. The header fallback now survives only for HS256 shared-secret tokens.
 *
 * verifyJwt is stubbed to stand in for a successful RS256/JWKS verification (no
 * Keycloak in unit tests); everything else in the auth module is real.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import Fastify from "fastify";
import { randomBytes } from "node:crypto";

const rs256Verified = vi.hoisted(() => ({ payload: null as null | Record<string, unknown> }));
vi.mock("../src/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/index.js")>();
  return {
    ...actual,
    verifyJwt: async (token: string) => {
      if (rs256Verified.payload) return rs256Verified.payload;
      return actual.verifyJwt(token);
    },
  };
});

import { authPlugin } from "../src/plugin.js";
import { signToken } from "../src/index.js";

const ORIGINAL_ENV = { ...process.env };
const VICTIM = "bbbbbbbb-0000-4000-8000-0000000000f2";
const OWN = "aaaaaaaa-0000-4000-8000-0000000000f2";
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  rs256Verified.payload = null;
});

async function ctxTenant(headers: Record<string, string>): Promise<{ status: number; tenantId?: string }> {
  const app = Fastify();
  await app.register(authPlugin);
  app.get("/v1/probe", async (r) => ({ tenantId: r.ctx.tenantId }));
  await app.ready();
  const res = await app.inject({ method: "GET", url: "/v1/probe", headers });
  await app.close();
  return { status: res.statusCode, tenantId: res.statusCode === 200 ? res.json().tenantId : undefined };
}

function devEnv(extra: Record<string, string | undefined> = {}): string {
  const secret = randomBytes(24).toString("hex");
  process.env = { ...ORIGINAL_ENV, NODE_ENV: "development", INTERNAL_SERVICE_SECRET: randomBytes(16).toString("hex"), JWT_SECRET: secret };
  delete process.env.JWT_ALGORITHM;
  delete process.env.DEPLOY_ENV;
  for (const [k, v] of Object.entries(extra)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  return secret;
}

describe("F2 follow-up: x-tenant-id never sets the tenant for an RS256-verified token", () => {
  it("development + RS256 token WITHOUT tid + x-tenant-id: ctx gets NO tenant", async () => {
    devEnv();
    rs256Verified.payload = { sub: "kc-user-no-tenant-attr", roles: ["officer"], sid: "s-1" };
    const r = await ctxTenant({ authorization: "Bearer rs256.stub.token", "x-tenant-id": VICTIM });
    expect(r.status).toBe(200);
    expect(r.tenantId).toBe("");
  });

  it("development + RS256 token WITH tid: the signed tid wins over any header", async () => {
    devEnv();
    rs256Verified.payload = { sub: "kc-user", tid: OWN, roles: ["officer"], sid: "s-2" };
    const r = await ctxTenant({ authorization: "Bearer rs256.stub.token", "x-tenant-id": VICTIM });
    expect(r.tenantId).toBe(OWN);
  });

  it("HS256 dev fallback (verifyJwt fails, shared-secret token without tid) still honours the header", async () => {
    const secret = devEnv();
    const tok = signToken({ sub: "dev-user", roles: ["officer"], sid: "s-3" } as never, secret);
    const r = await ctxTenant({ authorization: `Bearer ${tok}`, "x-tenant-id": VICTIM });
    expect(r.status).toBe(200);
    expect(r.tenantId).toBe(VICTIM);
  });

  it("JWT_ALGORITHM=HS256 (verifyJwt in shared-secret mode) still honours the header for a tid-less token", async () => {
    const secret = devEnv({ JWT_ALGORITHM: "HS256" });
    const tok = signToken({ sub: "dev-user", roles: ["officer"], sid: "s-4" } as never, secret);
    const r = await ctxTenant({ authorization: `Bearer ${tok}`, "x-tenant-id": VICTIM });
    expect(r.status).toBe(200);
    expect(r.tenantId).toBe(VICTIM);
  });
});
