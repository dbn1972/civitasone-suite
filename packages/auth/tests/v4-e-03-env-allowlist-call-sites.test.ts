/**
 * V4-E-03: the tenant-header fallback, the HS256 dev-token fallback and the
 * INTERNAL_SERVICE_SECRET boot assertion were keyed on
 * `NODE_ENV !== "production"` (a deny-list). Staging / UAT / unset / typo'd
 * NODE_ENV therefore ran with the dev posture. They must now be an explicit
 * allow-list (development | test) that fails closed on everything else.
 */
import { describe, it, expect, afterEach } from "vitest";
import Fastify from "fastify";
import { authPlugin, assertInternalServiceSecret } from "../src/plugin.js";
import { resolveServiceContext, AuthContextError } from "../src/context.js";
import { signToken, toRequestContext } from "../src/index.js";

const ORIGINAL_ENV = { ...process.env };
const JWT_SECRET = "v4_e03_unit_test_signing_material_0001";
const TENANT_FROM_HEADER = "99999999-aaaa-4000-8000-000000000e03";
const NOT_ALLOWED = ["production", "staging", "uat", "productoin", ""];

function setEnv(nodeEnv: string): void {
  process.env = { ...ORIGINAL_ENV, JWT_SECRET };
  if (nodeEnv === "") delete process.env.NODE_ENV;
  else process.env.NODE_ENV = nodeEnv;
}
afterEach(() => { process.env = { ...ORIGINAL_ENV }; });

const payloadNoTid = { sub: "u-1", roles: ["officer"], sid: "s-1" };
const hs256 = () => signToken({ ...payloadNoTid, tid: "11111111-aaaa-4000-8000-000000000e03" } as never, JWT_SECRET);

describe("V4-E-03 x-tenant-id header fallback (toRequestContext)", () => {
  it.each(NOT_ALLOWED)("ignores the x-tenant-id header when NODE_ENV=%j", (env) => {
    setEnv(env);
    const ctx = toRequestContext(payloadNoTid as never, "c-1", TENANT_FROM_HEADER);
    expect(ctx.tenantId).toBe("");
  });
  it.each(["development", "test"])("still honours it when NODE_ENV=%s", (env) => {
    setEnv(env);
    expect(toRequestContext(payloadNoTid as never, "c-1", TENANT_FROM_HEADER).tenantId).toBe(TENANT_FROM_HEADER);
  });
});

describe("V4-E-03 HS256 fallback in resolveServiceContext", () => {
  const req = () => ({ headers: { authorization: `Bearer ${hs256()}` }, id: "r-1" }) as never;
  it.each(NOT_ALLOWED)("refuses an HS256 token when NODE_ENV=%j", (env) => {
    setEnv(env);
    expect(() => resolveServiceContext(req())).toThrow(AuthContextError);
  });
  it("accepts it when NODE_ENV=test", () => {
    setEnv("test");
    expect(resolveServiceContext(req()).tenantId).toBeTruthy();
  });
});

describe("V4-E-03 INTERNAL_SERVICE_SECRET boot assertion", () => {
  it.each(NOT_ALLOWED)("fails closed on an empty secret when NODE_ENV=%j", (env) => {
    setEnv(env);
    delete process.env.INTERNAL_SERVICE_SECRET;
    expect(() => assertInternalServiceSecret()).toThrow(/INTERNAL_SERVICE_SECRET/);
  });
  it.each(["development", "test"])("is skipped when NODE_ENV=%s", (env) => {
    setEnv(env);
    delete process.env.INTERNAL_SERVICE_SECRET;
    expect(() => assertInternalServiceSecret()).not.toThrow();
  });
});

describe("V4-E-03 authPlugin HS256 fallback", () => {
  async function probe(env: string): Promise<number> {
    setEnv(env);
    process.env.INTERNAL_SERVICE_SECRET = "v4-e03-internal-material";
    const app = Fastify();
    await app.register(authPlugin);
    app.get("/v1/probe", async (r) => ({ t: r.ctx.tenantId }));
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/v1/probe", headers: { authorization: `Bearer ${hs256()}` } });
    await app.close();
    return res.statusCode;
  }
  it.each(["production", "staging", "uat", ""])("rejects a shared-secret HS256 token when NODE_ENV=%j", async (env) => {
    expect(await probe(env)).toBe(401);
  });
  it("accepts it when NODE_ENV=test", async () => {
    expect(await probe("test")).toBe(200);
  });
});
