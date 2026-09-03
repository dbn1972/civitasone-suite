/**
 * Coverage tests for dmn/routes.ts (22% → target: 80%+).
 * Tests CRUD + execution routes for DMN decision tables.
 *
 * F3 CQRS: create/update/delete are async (202 Accepted) — the actual write
 * happens in registerDmnConsumers, which this file registers against the
 * shared `queue` singleton so app.inject() writes are actually applied in
 * tests (mirrors tests/comments-routes.test.ts).
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient, db } from "../src/shared/db.js";
import { sql } from "drizzle-orm";
import { queue } from "../src/shared/infra.js";
import { registerDmnConsumers } from "../src/modules/dmn/consumer.js";

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000099";
const ACTOR = randomUUID();

function token(roles: string[] = ["workflow_admin"]): string {
  return signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-dmn" }, SECRET, 3600);
}

function authHeader(roles?: string[]) {
  return { authorization: `Bearer ${token(roles)}` };
}

registerDmnConsumers(queue);
await queue.start();

async function waitFor<T>(fn: () => Promise<T | null | undefined>, ms = 3000): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("waitFor timeout");
}

let app: FastifyInstance;

async function getTable(tableId: string, roles: string[] = ["workflow_user"]) {
  return app.inject({ method: "GET", url: `/v1/workflow/dmn/tables/${tableId}`, headers: authHeader(roles) });
}

/** Create a table via the async route and wait until the consumer has applied it. */
async function createAndWait(payload: Record<string, unknown>): Promise<{ id: string; data: Record<string, unknown> }> {
  const createRes = await app.inject({
    method: "POST",
    url: "/v1/workflow/dmn/tables",
    headers: authHeader(),
    payload,
  });
  expect(createRes.statusCode).toBe(202);
  const id = createRes.json().id as string;
  const data = await waitFor(async () => {
    const g = await getTable(id);
    return g.statusCode === 200 ? (g.json().data as Record<string, unknown>) : null;
  });
  return { id, data };
}

beforeAll(async () => { app = await buildApp(); });
afterAll(async () => {
  // Clean up test DMN tables
  await db.execute(sql`DELETE FROM workflow.dmn_tables WHERE tenant_id = ${TENANT}`).catch(() => undefined);
  await app.close();
  await sqlClient.end();
});

describe("POST /v1/workflow/dmn/tables — create", () => {
  it("creates a decision table and returns 202, applied async by the consumer", async () => {
    const { data } = await createAndWait({
      name: "Risk Assessment",
      description: "Evaluates risk level based on amount",
      hitPolicy: "FIRST",
      inputs: [{ key: "amount", label: "Amount", type: "number" }],
      outputs: [{ key: "risk", label: "Risk Level", type: "string" }],
      rules: [
        { inputs: { amount: "> 10000" }, outputs: { risk: "high" } },
        { inputs: { amount: "> 5000" }, outputs: { risk: "medium" } },
        { inputs: { amount: "" }, outputs: { risk: "low" } },
      ],
    });

    expect(data.name).toBe("Risk Assessment");
    expect(data.hitPolicy).toBe("FIRST");
    expect(data.status).toBe("draft");
    expect(data.version).toBe(1);
    expect((data.rules as unknown[]).length).toBe(3);
  });

  it("creates a table with default hit policy FIRST when omitted", async () => {
    const { data } = await createAndWait({ name: "Simple Table" });
    expect(data.hitPolicy).toBe("FIRST");
  });

  it("returns 400 for invalid body (missing name)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/workflow/dmn/tables",
      headers: authHeader(),
      payload: { hitPolicy: "UNIQUE" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_FAILED");
  });

  it("returns 403 for read-only role", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/workflow/dmn/tables",
      headers: authHeader(["workflow_user"]),
      payload: { name: "Forbidden Table" },
    });

    expect(res.statusCode).toBe(403);
  });

  it("returns 401 without token", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/workflow/dmn/tables",
      payload: { name: "No Auth" },
    });

    expect(res.statusCode).toBe(401);
  });
});

describe("GET /v1/workflow/dmn/tables — list", () => {
  it("returns paginated list (200)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/workflow/dmn/tables",
      headers: authHeader(["workflow_user"]),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.meta).toBeDefined();
    expect(typeof body.meta.page).toBe("number");
    expect(typeof body.meta.pageSize).toBe("number");
    expect(typeof body.meta.total).toBe("number");
  });

  it("respects pagination params", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/workflow/dmn/tables?page=1&pageSize=5",
      headers: authHeader(["workflow_user"]),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().meta.pageSize).toBe(5);
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/workflow/dmn/tables",
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for unauthorized role", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/workflow/dmn/tables",
      headers: authHeader(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/workflow/dmn/tables/:id — single", () => {
  it("returns a single table by id (200)", async () => {
    const { id } = await createAndWait({ name: "Get Single Test", hitPolicy: "UNIQUE" });

    const res = await getTable(id);

    expect(res.statusCode).toBe(200);
    expect(res.json().data.id).toBe(id);
    expect(res.json().data.name).toBe("Get Single Test");
  });

  it("returns 404 for non-existent table", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/workflow/dmn/tables/${randomUUID()}`,
      headers: authHeader(["workflow_user"]),
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 400 for invalid uuid", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/workflow/dmn/tables/not-a-uuid",
      headers: authHeader(["workflow_user"]),
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("PATCH /v1/workflow/dmn/tables/:id — update", () => {
  it("updates a table with optimistic locking (202), applied async by the consumer", async () => {
    const { id } = await createAndWait({ name: "Update Me", hitPolicy: "FIRST" });

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/workflow/dmn/tables/${id}`,
      headers: authHeader(),
      payload: {
        name: "Updated Name",
        hitPolicy: "COLLECT",
        version: 1,
      },
    });
    expect(res.statusCode).toBe(202);

    const updated = await waitFor(async () => {
      const g = await getTable(id);
      const data = g.json().data as Record<string, unknown> | undefined;
      return data?.version === 2 ? data : null;
    });
    expect(updated.name).toBe("Updated Name");
    expect(updated.hitPolicy).toBe("COLLECT");
    expect(updated.version).toBe(2);
  });

  it("returns 409 on version conflict", async () => {
    // The row must exist (consumer-applied) before the route's synchronous
    // version check can distinguish 409 (stale version) from 404 (no row).
    const { id } = await createAndWait({ name: "Conflict Test" });

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/workflow/dmn/tables/${id}`,
      headers: authHeader(),
      payload: { name: "Stale", version: 99 },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("VERSION_CONFLICT");
  });

  it("returns 404 for non-existent table", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/workflow/dmn/tables/${randomUUID()}`,
      headers: authHeader(),
      payload: { name: "Ghost", version: 1 },
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 400 for missing version", async () => {
    // Body validation (version required) happens before any DB lookup, so the
    // create doesn't need to land first — just a syntactically valid id.
    const createRes = await app.inject({
      method: "POST",
      url: "/v1/workflow/dmn/tables",
      headers: authHeader(),
      payload: { name: "No Version" },
    });
    expect(createRes.statusCode).toBe(202);
    const tableId = createRes.json().id;

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/workflow/dmn/tables/${tableId}`,
      headers: authHeader(),
      payload: { name: "Should Fail" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 403 for non-admin role", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/workflow/dmn/tables/${randomUUID()}`,
      headers: authHeader(["workflow_user"]),
      payload: { name: "Forbidden", version: 1 },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("DELETE /v1/workflow/dmn/tables/:id — soft-delete", () => {
  it("soft-deletes a table (202), applied async by the consumer", async () => {
    const { id } = await createAndWait({ name: "Delete Me" });

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/workflow/dmn/tables/${id}`,
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(202);

    // Verify GET eventually returns 404 (soft-deleted, once consumer applies it)
    const getRes = await waitFor(async () => {
      const g = await getTable(id);
      return g.statusCode === 404 ? g : null;
    });
    expect(getRes.statusCode).toBe(404);
  });

  it("returns 404 for non-existent table", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/workflow/dmn/tables/${randomUUID()}`,
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 403 for non-admin role", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/workflow/dmn/tables/${randomUUID()}`,
      headers: authHeader(["workflow_user"]),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("POST /v1/workflow/dmn/tables/:id/execute — evaluate", () => {
  it("evaluates a FIRST hit-policy table and returns outputs (200)", async () => {
    const { id } = await createAndWait({
      name: "Exec Test",
      hitPolicy: "FIRST",
      inputs: [{ key: "score", label: "Score", type: "number" }],
      outputs: [{ key: "grade", label: "Grade", type: "string" }],
      rules: [
        { inputs: { score: ">= 90" }, outputs: { grade: "A" } },
        { inputs: { score: ">= 70" }, outputs: { grade: "B" } },
        { inputs: { score: "" }, outputs: { grade: "C" } },
      ],
    });

    const res = await app.inject({
      method: "POST",
      url: `/v1/workflow/dmn/tables/${id}/execute`,
      headers: authHeader(["workflow_user"]),
      payload: { input: { score: 85 } },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.matched).toBe(true);
    expect(res.json().data.outputs.grade).toBe("B");
  });

  it("returns 404 for non-existent table", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/workflow/dmn/tables/${randomUUID()}/execute`,
      headers: authHeader(["workflow_user"]),
      payload: { input: { x: 1 } },
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 400 for invalid body (missing input)", async () => {
    // Body validation happens before the row lookup, so the create doesn't
    // need to land first.
    const createRes = await app.inject({
      method: "POST",
      url: "/v1/workflow/dmn/tables",
      headers: authHeader(),
      payload: { name: "Validate Exec" },
    });
    expect(createRes.statusCode).toBe(202);
    const tableId = createRes.json().id;

    const res = await app.inject({
      method: "POST",
      url: `/v1/workflow/dmn/tables/${tableId}/execute`,
      headers: authHeader(["workflow_user"]),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 403 for unauthorized role", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/workflow/dmn/tables/${randomUUID()}/execute`,
      headers: authHeader(["citizen"]),
      payload: { input: { x: 1 } },
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns 404 for soft-deleted table", async () => {
    const { id } = await createAndWait({ name: "Deleted Exec" });

    // Soft-delete and wait for it to apply
    const delRes = await app.inject({
      method: "DELETE",
      url: `/v1/workflow/dmn/tables/${id}`,
      headers: authHeader(),
    });
    expect(delRes.statusCode).toBe(202);
    await waitFor(async () => {
      const g = await getTable(id);
      return g.statusCode === 404 ? g : null;
    });

    const res = await app.inject({
      method: "POST",
      url: `/v1/workflow/dmn/tables/${id}/execute`,
      headers: authHeader(["workflow_user"]),
      payload: { input: {} },
    });
    expect(res.statusCode).toBe(404);
  });
});
