/**
 * fp-assets-01: finance exposes the accounts it posts depreciation / disposals to, so asset-service never keeps its own
 * copy (it must refuse the accumulated-depreciation account as a capitalisation / lease head).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { signToken } from "@civitasone/auth";
import { systemHeads, ACCUM_DEP, FIXED_ASSET } from "../src/modules/gl/system-heads.js";

const TEST_SERVICE_SECRET = process.env.INTERNAL_SERVICE_SECRET ?? "test_internal_secret_for_civitasone"; // gitleaks:allow
const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-0000000fb001";
let app: FastifyInstance;

beforeAll(async () => {
  process.env.INTERNAL_SERVICE_SECRET = TEST_SERVICE_SECRET;
  const { buildApp } = await import("../src/app.js");
  app = await buildApp();
  await app.ready();
});
afterAll(async () => { await app.close(); });

describe("GET /v1/finance/accounts/system-heads", () => {
  it("returns the codes the GL consumer actually posts to", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/finance/accounts/system-heads",
      headers: { "x-internal": "1", "x-tenant-id": TENANT, "x-service-secret": TEST_SERVICE_SECRET },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual(systemHeads());
    expect(JSON.parse(res.body).accumulatedDepreciationCode).toBe(ACCUM_DEP);
    expect(JSON.parse(res.body).fixedAssetCode).toBe(FIXED_ASSET);
  });

  it("is not reachable without credentials, with a wrong service secret, or by a role that cannot read accounts", async () => {
    expect((await app.inject({ method: "GET", url: "/v1/finance/accounts/system-heads" })).statusCode).toBe(401);
    const wrong = await app.inject({
      method: "GET", url: "/v1/finance/accounts/system-heads",
      headers: { "x-internal": "1", "x-tenant-id": TENANT, "x-service-secret": `${TEST_SERVICE_SECRET}_wrong` },
    });
    expect(wrong.statusCode).toBe(401);
    const citizen = signToken({ sub: "cccccccc-3333-4000-8000-0000000fb001", tid: TENANT, roles: ["citizen"], sid: "s" } as never, SECRET, 3600);
    const denied = await app.inject({ method: "GET", url: "/v1/finance/accounts/system-heads", headers: { authorization: `Bearer ${citizen}` } });
    expect(denied.statusCode).toBe(403);
  });
});
