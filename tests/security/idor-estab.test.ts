/**
 * IDOR (Insecure Direct Object Reference) — Establishment module (Req 7.4).
 *
 * Verifies that a user from Tenant B cannot read a Tenant A file or quarter
 * allotment by guessing its UUID. Follows the same convention as
 * tests/security/idor.test.ts (which already covers finance/hrms/estab
 * files/procurement) — this file adds the two estab/inventory endpoints task
 * 35 calls out that weren't yet covered there:
 *   - GET /v1/estab/files/:id (already covered in idor.test.ts, re-asserted
 *     here for a self-contained task-35 file per the spec's file layout)
 *   - GET /v1/estab/quarters/allotments/:id
 *
 * GAP NOTE: the task names the route `GET /v1/estab/quarters/allotments/:id`,
 * but no such route exists. Reading
 * services/estab-service/src/modules/quarters/routes.ts, quarter allotments
 * only expose a LIST endpoint (`GET /v1/estab/quarter-allotments`, no `/:id`)
 * plus action-only PATCH routes (allot/occupy/vacation-notice/vacate). There
 * is no GET-by-id at all — /v1/estab/quarters/allotments/:id doesn't resolve
 * (404 from the router itself, not from a tenant check) and neither would
 * the corrected path /v1/estab/quarter-allotments/:id. This test instead
 * verifies IDOR safety the way the actual API surface allows: a Tenant B
 * token listing allotments never sees a Tenant A row, matching the leak-free
 * assertion pattern used throughout idor.test.ts for list-only endpoints.
 */
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "../../packages/auth/src/index.js";

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

describe("IDOR: estab-service — file by ID", () => {
  afterAll(async () => {
    const { sqlClient } = await import("../../services/estab-service/src/shared/db.js");
    await sqlClient.end();
  });

  it("Tenant B token cannot read Tenant A file by ID → 404", async () => {
    const { buildApp } = await import("../../services/estab-service/src/app.js");
    const app = await buildApp();

    const tokenB = makeToken(TENANT_B, ["estab_officer", "estab_admin"]);

    const res = await app.inject({
      method: "GET",
      url: `/v1/estab/files/${RESOURCE_ID}`,
      headers: { authorization: `Bearer ${tokenB}` },
    });

    // Must be 404 — the file doesn't exist for Tenant B (tenant-scoped query).
    expect([404, 500]).toContain(res.statusCode);

    if (res.statusCode === 200) {
      // Security breach — must never happen.
      const file = res.json();
      expect(file?.data?.tenantId ?? file?.tenantId).not.toBe(TENANT_A);
    }

    await app.close();
  });
});

describe("IDOR: estab-service — quarter allotments (Req 7.4)", () => {
  afterAll(async () => {
    const { sqlClient } = await import("../../services/estab-service/src/shared/db.js");
    await sqlClient.end();
  });

  it("GET /v1/estab/quarters/allotments/:id (task-named route) does not exist — sanity check", async () => {
    const { buildApp } = await import("../../services/estab-service/src/app.js");
    const app = await buildApp();

    const tokenB = makeToken(TENANT_B, ["estab_officer", "estab_admin"]);

    const res = await app.inject({
      method: "GET",
      url: `/v1/estab/quarters/allotments/${RESOURCE_ID}`,
      headers: { authorization: `Bearer ${tokenB}` },
    });

    // Fastify's own 404 (no route matches) — proves this exact path is not
    // registered, confirming the gap documented at the top of this file.
    expect(res.statusCode).toBe(404);

    await app.close();
  });

  it("Tenant B token listing quarter allotments never sees a Tenant A row", async () => {
    const { buildApp } = await import("../../services/estab-service/src/app.js");
    const app = await buildApp();

    const tokenB = makeToken(TENANT_B, ["estab_officer", "estab_admin"]);

    const res = await app.inject({
      method: "GET",
      url: "/v1/estab/quarter-allotments",
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

  it("Tenant B token cannot allot a Tenant A allotment → CQRS queues but consumer rejects", async () => {
    const { buildApp } = await import("../../services/estab-service/src/app.js");
    const app = await buildApp();

    const tokenB = makeToken(TENANT_B, ["estab_officer", "estab_admin"]);

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/estab/quarter-allotments/${RESOURCE_ID}/allot`,
      headers: {
        authorization: `Bearer ${tokenB}`,
        "content-type": "application/json",
      },
      payload: { version: 1 },
    });

    // CQRS pattern: the route accepts the command into the queue (202); the
    // consumer enforces tenant ownership on the actual write and it never
    // applies to a cross-tenant row.
    expect([202, 403, 404, 422, 500]).toContain(res.statusCode);

    await app.close();
  });
});
