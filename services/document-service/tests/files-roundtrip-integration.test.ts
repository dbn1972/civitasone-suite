/**
 * COMP-003 real round-trip integration test — real Postgres, no mocks.
 *
 * Before this change, document-service had a fully implemented Fastify app,
 * routes, commands and consumers (src/app.ts, src/modules/files/*), and was
 * already routed by the gateway at both /api/v1/documents and
 * /api/v1/eoffice (gateway-service/src/registry.ts:83-84) and consumed by
 * four real frontend pages (apps/web/src/app/(app)/documents/*) — but NO
 * migrations/ directory existed at all, so `document.files` never existed
 * and every request that reached it failed. See
 * docs/ENTERPRISE-GAP-REPORT-2026-09-07.md, COMP-003.
 *
 * This test drives the ACTUAL HTTP route the frontend's upload form calls
 * (POST /v1/documents/files — apps/web/.../documents/new/page.tsx) and the
 * one its library/inbox pages call to read back (GET .../files/:id), lets
 * the real command -> queue -> consumer path write the row, then verifies
 * the row directly against the database and against a second tenant to
 * prove the RLS policy added in migration 0002 is actually enforced (not
 * just that the app-level WHERE tenant_id=... clause happens to filter it).
 */
import { describe, it, expect, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { files } from "../src/modules/files/schema.js";
import { registerFilesConsumers } from "../src/modules/files/consumer.js";
import * as repo from "../src/modules/files/repo.js";
import { queue } from "../src/shared/infra.js";
import { tenantScoped } from "../src/shared/tenant-queue.js";

// Register against the real queue singleton the app itself publishes
// through (src/shared/infra.js) — same pattern as admin-service's
// tests/admin.test.ts — so app.inject()'s POST and this test's
// queue.drain() operate on the same in-memory queue instance.
registerFilesConsumers(tenantScoped(queue));

const ACTOR = "00000000-aaaa-4000-8000-000000000009";
const TENANT_A = "11111111-aaaa-4000-8000-0000000000a1";
const TENANT_B = "22222222-aaaa-4000-8000-0000000000b2";

const SECRET = process.env.JWT_SECRET as string;
function token(roles: string[], tid: string): string {
  return signToken({ sub: ACTOR, roles, tid } as never, SECRET);
}
// In production the gateway decodes the JWT and injects x-tenant-id before
// forwarding to the internal service (services/gateway-service/src/
// jwt-edge.ts:104: `headers["x-tenant-id"] = payload.tid`) — that header,
// not the JWT itself, is what createTenantTxHook (packages/db/src/
// tenant-tx.ts) reads to set the app.tenant_id RLS GUC for this request's
// db.transaction() calls. A test that talks to the service directly (no
// gateway in front of it) must set both headers to be a faithful
// reproduction of the real request shape.
const bearer = (roles: string[], tid: string) => ({
  authorization: `Bearer ${token(roles, tid)}`,
  "x-tenant-id": tid,
});

afterAll(async () => {
  await runWithTenant(TENANT_A, () =>
    db.transaction((tx) => tx.delete(files).where(eq(files.tenantId, TENANT_A))),
  );
  await sqlClient.end();
});

describe("document-service files — HTTP round trip (COMP-003, real DB)", () => {
  it("POST /v1/documents/files -> consumer write -> GET returns the same file", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();

    const created = await app.inject({
      method: "POST",
      url: "/v1/documents/files",
      headers: bearer(["document_admin"], TENANT_A),
      payload: { name: "Budget Report Q3.pdf", tags: ["finance", "2026"], mimeType: "application/pdf" },
    });
    expect(created.statusCode).toBe(202);
    const { id } = JSON.parse(created.body) as { id: string };

    // Let the consumer actually process the command and write the row.
    await queue.drain();

    const fetched = await app.inject({
      method: "GET",
      url: `/v1/documents/files/${id}`,
      headers: bearer(["document_admin"], TENANT_A),
    });
    expect(fetched.statusCode).toBe(200);
    const file = JSON.parse(fetched.body) as { id: string; name: string; tags: string[]; status: string };
    expect(file.name).toBe("Budget Report Q3.pdf");
    expect(file.tags).toEqual(["finance", "2026"]);
    expect(file.status).toBe("active");

    // Verify directly against the database (bypasses the HTTP layer and its
    // cache) that migration 0001 actually created a real, queryable row.
    const dbRow = await runWithTenant(TENANT_A, () => repo.getById(TENANT_A, id));
    expect(dbRow).not.toBeNull();
    expect(dbRow?.name).toBe("Budget Report Q3.pdf");
    expect(dbRow?.mimeType).toBe("application/pdf");

    // RLS (migration 0002): same tenantId filter, WRONG ambient tenant GUC —
    // FORCE ROW LEVEL SECURITY must block the read even though the WHERE
    // clause nominally matches the row.
    const rlsBlocked = await runWithTenant(TENANT_B, () => repo.getById(TENANT_A, id));
    expect(rlsBlocked).toBeNull();

    // App-level isolation: tenant B's own ctx.tenantId can't see tenant A's file either.
    const crossTenantHttp = await app.inject({
      method: "GET",
      url: `/v1/documents/files/${id}`,
      headers: bearer(["document_admin"], TENANT_B),
    });
    expect(crossTenantHttp.statusCode).toBe(404);

    await app.close();
  });

  it("GET /v1/documents/files lists the uploaded file for its own tenant", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();

    const listed = await app.inject({
      method: "GET",
      url: "/v1/documents/files",
      headers: bearer(["document_admin"], TENANT_A),
    });
    expect(listed.statusCode).toBe(200);
    const body = JSON.parse(listed.body) as { data: Array<{ name: string }> };
    expect(body.data.some((f) => f.name === "Budget Report Q3.pdf")).toBe(true);

    await app.close();
  });
});
