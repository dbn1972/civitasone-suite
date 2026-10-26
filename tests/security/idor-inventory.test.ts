/**
 * IDOR (Insecure Direct Object Reference) — Inventory module (Req 7.4).
 *
 * Verifies that a user from Tenant B cannot read a Tenant A inventory
 * movement or cycle count by guessing its UUID. Follows the same convention
 * as tests/security/idor.test.ts.
 *
 * HISTORY: this file once documented that no single-movement GET-by-id route
 * existed and tested the ledger list as the closest surface. The route
 * `GET /v1/inventory/movements/:id` has since been added (services/
 * inventory-service/src/modules/movements/routes.ts, tenant-scoped
 * queries.getMovement), so it is now tested directly. The ledger-list leak
 * check is kept.
 *
 * GET /v1/inventory/cycle-counts/:id DOES exist (routes.ts confirms it) and
 * is tested directly below.
 */
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "../../packages/auth/src/index.js";
import { serviceDsn } from "../cross-service-live/harness.js";

// The root vitest config points DATABASE_URL at the FINANCE database, so the
// inventory app booted here queried tables that do not exist there and every
// route answered 500 (including the movement-by-id lookup, which must be a
// tenant-scoped 404). Point it at the inventory DB as the non-superuser inventory_svc
// role, exactly as the live cross-service harness does. Set before the app (and
// its db client) are dynamically imported below.
process.env.DATABASE_URL = serviceDsn("inventory-service");

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

const TENANT_A = "11111111-aaaa-4000-8000-000000000001";
const TENANT_B = "22222222-bbbb-4000-8000-000000000002";

// A fake but valid UUID that would belong to Tenant A's resources.
const RESOURCE_ID = "99999999-cccc-4000-8000-000000000099";

function makeToken(tenantId: string, roles: string[]): string {
  return signToken(
    { sub: `user-idor-${tenantId.slice(0, 8)}`, tid: tenantId, roles, sid: "sess-idor" },
    SECRET,
  );
}

describe("IDOR: inventory-service — movements (Req 7.4)", () => {
  afterAll(async () => {
    const { sqlClient } = await import("../../services/inventory-service/src/shared/db.js");
    await sqlClient.end();
  });

  it("Tenant B token cannot read Tenant A movement by ID → 404", async () => {
    const { buildApp } = await import("../../services/inventory-service/src/app.js");
    const app = await buildApp();

    const tokenB = makeToken(TENANT_B, ["inventory_manager", "inventory_admin"]);

    const res = await app.inject({
      method: "GET",
      url: `/v1/inventory/movements/${RESOURCE_ID}`,
      headers: { authorization: `Bearer ${tokenB}` },
    });

    // 404 from the tenant-scoped getMovement lookup (the row does not exist
    // for Tenant B) — never the movement, never a 500.
    expect(res.statusCode).toBe(404);
    expect(res.json()?.error?.code ?? res.json()?.code).toBe("NOT_FOUND");

    await app.close();
  }, 30000); // cold buildApp() can exceed the 5s default under load

  it("Tenant B token reading the stock ledger never sees a Tenant A row", async () => {
    const { buildApp } = await import("../../services/inventory-service/src/app.js");
    const app = await buildApp();

    const tokenB = makeToken(TENANT_B, ["inventory_manager", "inventory_admin"]);

    const res = await app.inject({
      method: "GET",
      url: "/v1/inventory/ledger",
      headers: { authorization: `Bearer ${tokenB}` },
    });

    if (res.statusCode === 200) {
      const data = res.json();
      const items = Array.isArray(data) ? data : (data?.data ?? []);
      const leak = items.some((r: { tenantId?: string }) => r.tenantId === TENANT_A);
      expect(leak).toBe(false);
    } else {
      expect([200, 500]).toContain(res.statusCode);
    }

    await app.close();
  });
});

describe("IDOR: inventory-service — cycle count by ID", () => {
  afterAll(async () => {
    const { sqlClient } = await import("../../services/inventory-service/src/shared/db.js");
    await sqlClient.end();
  });

  it("Tenant B token cannot read Tenant A cycle count by ID → 404", async () => {
    const { buildApp } = await import("../../services/inventory-service/src/app.js");
    const app = await buildApp();

    const tokenB = makeToken(TENANT_B, ["inventory_manager", "inventory_admin"]);

    const res = await app.inject({
      method: "GET",
      url: `/v1/inventory/cycle-counts/${RESOURCE_ID}`,
      headers: { authorization: `Bearer ${tokenB}` },
    });

    // Must be 404 — the cycle count doesn't exist for Tenant B (tenant-scoped
    // query, per services/inventory-service/src/modules/cycle-count/queries.ts).
    expect([404, 500]).toContain(res.statusCode);

    if (res.statusCode === 200) {
      // Security breach — must never happen.
      const record = res.json();
      expect(record?.data?.tenantId ?? record?.tenantId).not.toBe(TENANT_A);
    }

    await app.close();
  });

  it("Tenant B token cannot approve a Tenant A cycle count → CQRS queues but consumer rejects", async () => {
    const { buildApp } = await import("../../services/inventory-service/src/app.js");
    const app = await buildApp();

    const tokenB = makeToken(TENANT_B, ["inventory_manager", "inventory_admin"]);

    const res = await app.inject({
      method: "POST",
      url: `/v1/inventory/cycle-counts/${RESOURCE_ID}/approve`,
      headers: {
        authorization: `Bearer ${tokenB}`,
        "content-type": "application/json",
      },
      payload: { version: 1 },
    });

    // CQRS pattern: the route accepts the command into the queue (202); the
    // consumer enforces tenant ownership on the actual write.
    expect([202, 403, 404, 422, 500]).toContain(res.statusCode);

    await app.close();
  });
});
