/**
 * UAT W6 P7: POST/DELETE /v1/locations/sample-data (developer "try it" seeding)
 * were reachable in UAT. They are now dev-only: ENABLE_SAMPLE_DATA_ROUTES=true opts
 * in, NODE_ENV=production always refuses, and a disabled route answers 404.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import * as repo from "../src/modules/locations/repo.js";
import { isSampleDataRoutesEnabled } from "../src/modules/locations/routes.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "11111111-aaaa-4000-8000-0000000007b6";
const auth = {
  authorization: `Bearer ${signToken({ sub: "00000000-aaaa-4000-8000-0000000007b6", tid: TENANT, roles: ["location_admin"] }, SECRET, 3600)}`,
  "x-tenant-id": TENANT,
};

let app: FastifyInstance;
beforeAll(async () => { app = await buildApp(); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
afterAll(async () => { await app.close(); });

describe("isSampleDataRoutesEnabled", () => {
  it("is off by default", () => {
    expect(isSampleDataRoutesEnabled({ NODE_ENV: "test" })).toBe(false);
  });
  it("is on only with ENABLE_SAMPLE_DATA_ROUTES=true outside production", () => {
    expect(isSampleDataRoutesEnabled({ NODE_ENV: "development", ENABLE_SAMPLE_DATA_ROUTES: "true" })).toBe(true);
    expect(isSampleDataRoutesEnabled({ NODE_ENV: "development", ENABLE_SAMPLE_DATA_ROUTES: "1" })).toBe(false);
  });
  // Route-level production behaviour is covered by this predicate: under NODE_ENV=production
  // the HS256 test tokens are refused before any handler runs, so it cannot be injected here.
  it("is always off in production, whatever the flag says", () => {
    expect(isSampleDataRoutesEnabled({ NODE_ENV: "production", ENABLE_SAMPLE_DATA_ROUTES: "true" })).toBe(false);
  });
});

describe("sample-data routes are 404 when the dev flag is off", () => {
  for (const method of ["POST", "DELETE"] as const) {
    it(`${method} /v1/locations/sample-data → 404 and the repo is never touched (flag unset)`, async () => {
      vi.stubEnv("ENABLE_SAMPLE_DATA_ROUTES", "");
      const seed = vi.spyOn(repo, "seedSamples");
      const clear = vi.spyOn(repo, "clearSamples");
      const res = await app.inject({ method, url: "/v1/locations/sample-data", headers: auth });
      expect(res.statusCode).toBe(404);
      expect(seed).not.toHaveBeenCalled();
      expect(clear).not.toHaveBeenCalled();
    });
  }

  it("DELETE /v1/locations/sample-data → 200 when the flag is on (dev)", async () => {
    vi.stubEnv("ENABLE_SAMPLE_DATA_ROUTES", "true");
    const clear = vi.spyOn(repo, "clearSamples").mockResolvedValue(0 as never);
    const res = await app.inject({ method: "DELETE", url: "/v1/locations/sample-data", headers: auth });
    expect(res.statusCode).toBe(200);
    expect(clear).toHaveBeenCalledWith(TENANT);
  });
});
