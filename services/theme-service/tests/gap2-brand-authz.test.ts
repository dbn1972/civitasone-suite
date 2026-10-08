/**
 * GAP2-THEMES-BRAND-AUTHZ-02 — GET /v1/themes/brand and /v1/themes/brand/css
 * used to derive the tenant AND the cache key from the raw, client-controllable
 * `x-tenant-id` header (resolveTenantId). AGENTS.md §4 forbids trusting that
 * header for identity; the tenant must come from the verified JWT context
 * (payload.tid). The routes now use resolveContext(req).tenantId and build the
 * cache key from it.
 *
 * This test seeds the cache under TENANT_A's key with a sentinel brand, then
 * issues a request carrying a token for TENANT_A but a FORGED
 * `x-tenant-id: TENANT_B` header:
 *   - OLD code keys the read on header B -> cache MISS -> never returns A's
 *     sentinel (and could serve/poison B's cache under B's key).
 *   - NEW code keys on the JWT tid (A) -> cache HIT -> returns A's sentinel.
 *
 * Seeding the cache (not the DB) isolates the exact behaviour under test — tenant
 * identity + cache key — independent of the RLS read path.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { cache } from "../src/shared/infra.js";
import { BRAND_RESOURCE, DEFAULTS } from "../src/modules/tokens/brand-defaults.js";

const SECRET = process.env.JWT_SECRET as string;

const TENANT_A = randomUUID();
const TENANT_B = randomUUID();
const ACTOR = randomUUID();
const A_PRIMARY = "#0a7d2c"; // distinctive, not the DEFAULTS primary

function tokenForA(): string {
  return signToken({ sub: ACTOR, tid: TENANT_A, roles: ["theme_admin"], sid: "sess-brand-authz" }, SECRET, 3600);
}

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  // Seed the brand cache under TENANT_A's key with a sentinel config.
  await cache.put(
    cache.makeKey(TENANT_A, BRAND_RESOURCE, "config"),
    { tenantId: TENANT_A, ...DEFAULTS, colorPrimary: A_PRIMARY },
    60,
  );
});

afterAll(async () => {
  await sqlClient.end();
});

describe("GAP2-THEMES-BRAND-AUTHZ-02: brand reads use JWT tid for identity + cache key", () => {
  it("GET /v1/themes/brand serves tenant A's cached brand under a forged x-tenant-id: B header", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/themes/brand",
      headers: {
        authorization: `Bearer ${tokenForA()}`,
        "x-tenant-id": TENANT_B, // forged — must be ignored for identity + cache key
      },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { tenantId: string; colorPrimary: string };
    expect(body.tenantId).toBe(TENANT_A);
    expect(body.colorPrimary).toBe(A_PRIMARY);
  });

  it("GET /v1/themes/brand/css emits tenant A's cached primary colour despite the forged header", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/themes/brand/css",
      headers: {
        authorization: `Bearer ${tokenForA()}`,
        "x-tenant-id": TENANT_B, // forged
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain(`--color-primary: ${A_PRIMARY};`);
  });
});
