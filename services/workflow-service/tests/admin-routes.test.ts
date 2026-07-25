/**
 * Coverage tests for admin/routes.ts (14.41% → target: 100%).
 * Tests DLQ list/requeue, audit export, and role-member CRUD.
 */
import { describe, it, expect, afterAll, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { sqlAsTenant, asTenant } from "./helpers/engine-harness.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-bbb000000001";
const ACTOR = "aaaaaaaa-4444-4000-8000-bbb000000001";

function adminToken() {
  return signToken({ sub: ACTOR, tid: TENANT, roles: ["workflow_admin"], sid: "sess-001" }, SECRET);
}
function userToken() {
  return signToken({ sub: "bbbbbbbb-4444-4000-8000-bbb000000002", tid: TENANT, roles: ["workflow_user"], sid: "sess-001" }, SECRET);
}

afterEach(async () => {
  await sqlAsTenant(TENANT, sql`DELETE FROM workflow.dead_letters WHERE tenant_id = ${TENANT}`).catch(() => undefined);
  await sqlAsTenant(TENANT, sql`DELETE FROM workflow.role_members WHERE tenant_id = ${TENANT}`).catch(() => undefined);
});
afterAll(async () => { await sqlClient.end(); });

describe("GET /v1/workflow/dlq", () => {
  it("returns empty list for a fresh tenant", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/workflow/dlq",
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([]);
  });

  it("returns 403 for non-admin", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/workflow/dlq",
      headers: { authorization: `Bearer ${userToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("filters by status param", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/workflow/dlq?status=dead&limit=10&offset=0",
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().data)).toBe(true);
  });
});

describe("POST /v1/workflow/dlq/:id/requeue", () => {
  it("requeues a dead-lettered message", async () => {
    const dlId = randomUUID();
    const msgId = randomUUID();
    // Insert a dead letter directly
    await sqlAsTenant(TENANT, sql`
      INSERT INTO workflow.dead_letters (id, tenant_id, topic, message_id, envelope, error, attempt_count, status)
      VALUES (${dlId}, ${TENANT}, 'workflow.task.complete', ${msgId},
              ${JSON.stringify({ type: "workflow.task.complete", tenantId: TENANT, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0", payload: {} })}::jsonb,
              'test error', 3, 'dead')
    `);

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/workflow/dlq/${dlId}/requeue`,
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe("requeued");
  });

  it("returns 404 for non-existent dead letter", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/workflow/dlq/${randomUUID()}/requeue`,
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("returns 409 if already requeued", async () => {
    const dlId = randomUUID();
    await sqlAsTenant(TENANT, sql`
      INSERT INTO workflow.dead_letters (id, tenant_id, topic, message_id, envelope, error, attempt_count, status, requeued_at)
      VALUES (${dlId}, ${TENANT}, 'workflow.task.complete', ${randomUUID()},
              ${JSON.stringify({ type: "workflow.task.complete", payload: {} })}::jsonb,
              'err', 3, 'requeued', NOW())
    `);

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/workflow/dlq/${dlId}/requeue`,
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(409);
  });
});

describe("GET /v1/workflow/audit/export", () => {
  it("returns empty data for date range with no history", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/workflow/audit/export?from=2020-01-01T00:00:00Z&to=2020-12-31T23:59:59Z&limit=100",
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([]);
    expect(res.json().nextCursor).toBeNull();
  });

  it("returns 403 for non-admin", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/workflow/audit/export?from=2020-01-01T00:00:00Z&to=2020-12-31T23:59:59Z",
      headers: { authorization: `Bearer ${userToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("returns 400 for missing required params", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/workflow/audit/export",
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});

describe("PUT /v1/workflow/role-members", () => {
  it("creates a role-member entry", async () => {
    const app = await buildApp();
    const userId = randomUUID();
    const res = await app.inject({
      method: "PUT",
      url: "/v1/workflow/role-members",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { roleRef: "reviewer", userId },
    });
    await app.close();
    expect(res.statusCode).toBe(201);
    expect(res.json().data.roleRef).toBe("reviewer");
    expect(res.json().data.userId).toBe(userId);
  });

  it("upserts an existing role-member (idempotent)", async () => {
    const app = await buildApp();
    const userId = randomUUID();
    const reportsTo = randomUUID();
    // Create
    await app.inject({
      method: "PUT",
      url: "/v1/workflow/role-members",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { roleRef: "reviewer", userId },
    });
    // Upsert with reportsTo
    const res = await app.inject({
      method: "PUT",
      url: "/v1/workflow/role-members",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { roleRef: "reviewer", userId, reportsTo, active: true },
    });
    await app.close();
    expect(res.statusCode).toBe(201);
  });

  it("returns 403 for non-admin", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PUT",
      url: "/v1/workflow/role-members",
      headers: { authorization: `Bearer ${userToken()}` },
      payload: { roleRef: "reviewer", userId: randomUUID() },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/workflow/role-members", () => {
  it("lists role members for tenant", async () => {
    const app = await buildApp();
    const userId = randomUUID();
    await app.inject({
      method: "PUT",
      url: "/v1/workflow/role-members",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { roleRef: "approver", userId },
    });
    const res = await app.inject({
      method: "GET",
      url: "/v1/workflow/role-members",
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data.length).toBeGreaterThanOrEqual(1);
  });

  it("filters by roleRef query param", async () => {
    const app = await buildApp();
    const userId = randomUUID();
    await app.inject({
      method: "PUT",
      url: "/v1/workflow/role-members",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { roleRef: "unique_role_test", userId },
    });
    const res = await app.inject({
      method: "GET",
      url: "/v1/workflow/role-members?roleRef=unique_role_test",
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.length).toBe(1);
    expect(data[0].roleRef).toBe("unique_role_test");
  });
});
