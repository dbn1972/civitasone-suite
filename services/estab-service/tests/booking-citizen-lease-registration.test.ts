/**
 * GAP2-ESTAB-BOOKING-ORPHAN-01 — the booking + citizen-lease route modules
 * were defined but never registered in app.ts, so every endpoint 404'd. This
 * test enumerates the registered route prefixes and asserts both modules are
 * reachable (a representative GET returns 200/401/403, NOT 404). Fails on the
 * old app.ts.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/app.js";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "7ca10001-0000-4000-8000-0000000000c1";
const ACTOR = "7ca10001-0000-4000-8000-0000000000c2";

function auth(roles: string[]) {
  const token = signToken({ sub: ACTOR, tid: TENANT, roles, sid: "s1" }, SECRET, 3600);
  return { authorization: `Bearer ${token}` };
}

let app: FastifyInstance;
beforeAll(async () => { app = await buildApp(); await app.ready(); });
afterAll(async () => { await app.close(); });

describe("GAP2-ESTAB-BOOKING-ORPHAN-01 — orphan modules are now registered", () => {
  it("the Fastify route tree includes the booking + citizen-lease endpoints", () => {
    const tree = app.printRoutes();
    // printRoutes renders a radix tree that may split long path segments across
    // lines, so assert on stable leaf tokens that only these modules contribute.
    expect(tree).toContain("facilities");
    expect(tree).toContain("properties");
    expect(tree).toContain("leases");
  });

  it("GET /v1/estab/booking/facilities is reachable (200, not 404)", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/estab/booking/facilities",
      headers: auth(["estab_admin"]),
    });
    expect(res.statusCode).not.toBe(404);
    expect([200, 401, 403]).toContain(res.statusCode);
  });

  it("GET /v1/estab/citizen-lease/properties is reachable (200, not 404)", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/estab/citizen-lease/properties",
      headers: auth(["estab_admin"]),
    });
    expect(res.statusCode).not.toBe(404);
    expect([200, 401, 403]).toContain(res.statusCode);
  });

  it("an unknown booking subpath still 404s (routing is specific, not a catch-all)", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/estab/booking/does-not-exist",
      headers: auth(["estab_admin"]),
    });
    expect(res.statusCode).toBe(404);
  });
});
