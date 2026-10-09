/**
 * GAP2-TENANT-WIRING-01 — tenant-service used to register these read routes
 * WITHOUT the leading `tenant/` segment (/v1/org/hierarchy, /v1/settings, ...).
 * The web sub-page loaders call /api/v1/tenant/<x>, which the gateway forwards
 * verbatim as /v1/tenant/<x> — a permanent 404 against the old service. We now
 * register `/v1/tenant/<x>` aliases alongside the canonical paths; this test
 * asserts the alias resolves to the SAME handler/status as the canonical route.
 *
 * These assertions FAIL on the old code: the alias paths return a Fastify 404
 * (route not found) there, which differs from the canonical path's response.
 */
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { sqlClient } from "../src/shared/db.js";
import { buildApp } from "../src/app.js";

const SECRET = process.env.JWT_SECRET as string;
const TENANT = "aa550002-5555-4000-8000-000000a50002";
const ACTOR = "aa55bbbb-5555-4000-8000-000000a5000b";

function token(roles: string[]): string {
  return signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-wiring01" }, SECRET, 3600);
}

afterAll(async () => {
  await sqlClient.end();
});

// Each list alias and its canonical sibling. tenant_admin passes the role gate;
// the throwaway tenant has no rows, so a list route returns 200 { data: [] }.
const LIST_ALIASES: Array<{ canonical: string; alias: string }> = [
  { canonical: "/v1/settings", alias: "/v1/tenant/settings" },
  { canonical: "/v1/org/hierarchy", alias: "/v1/tenant/org/hierarchy" },
  { canonical: "/v1/code-lists", alias: "/v1/tenant/code-lists" },
  { canonical: "/v1/positions", alias: "/v1/tenant/positions" },
  { canonical: "/v1/consent/requests", alias: "/v1/tenant/consent/requests" },
  { canonical: "/v1/data-governance/domains", alias: "/v1/tenant/data-governance/domains" },
  { canonical: "/v1/org/migrations", alias: "/v1/tenant/org/migrations" },
];

describe("GAP2-TENANT-WIRING-01: /v1/tenant/* read aliases", () => {
  it("401 without a token on an alias path (route exists, auth enforced)", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/tenant/settings" });
    await app.close();
    // The old service had no such route -> this still 404s there, not 401.
    expect(res.statusCode).toBe(401);
  });

  for (const { canonical, alias } of LIST_ALIASES) {
    it(`${alias} returns the same status as ${canonical} for an admin`, async () => {
      const app = await buildApp();
      // platform_admin satisfies every list route's gate (tenant_admin does
      // NOT cover data-migration, so use the superset role here).
      const auth = { authorization: `Bearer ${token(["platform_admin"])}` };
      const canonRes = await app.inject({ method: "GET", url: canonical, headers: auth });
      const aliasRes = await app.inject({ method: "GET", url: alias, headers: auth });
      await app.close();
      expect(canonRes.statusCode).toBe(200);
      expect(aliasRes.statusCode).toBe(canonRes.statusCode);
      // Both yield the module list envelope; the alias is not a Fastify 404.
      expect(aliasRes.statusCode).not.toBe(404);
    });
  }

  it("/v1/tenant/current resolves to the current-tenant read handler (not a Fastify 404)", async () => {
    const app = await buildApp();
    const auth = { authorization: `Bearer ${token(["platform_admin"])}` };
    const canonRes = await app.inject({ method: "GET", url: "/v1/tenants/current", headers: auth });
    const aliasRes = await app.inject({ method: "GET", url: "/v1/tenant/current", headers: auth });
    await app.close();
    // No tenant row in this throwaway tenant -> both return the handler's 404
    // NOT_FOUND envelope. The point: the alias behaves identically to the
    // canonical path, which proves it reaches the same handler.
    expect(aliasRes.statusCode).toBe(canonRes.statusCode);
    expect(JSON.parse(aliasRes.body).code).toBe(JSON.parse(canonRes.body).code);
  });
});
