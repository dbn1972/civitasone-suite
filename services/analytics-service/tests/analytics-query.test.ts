/**
 * Analytics query routes integration tests.
 *
 * Covers:
 *  - POST /v1/analytics/query — happy path with joins + calculated fields
 *  - POST /v1/analytics/query — 400 on invalid calculated field expression
 *  - POST /v1/analytics/query — 400 on unregistered column in calc field
 *  - POST /v1/analytics/query — 400 on invalid join key
 *  - POST /v1/analytics/query — row cap enforcement (1000)
 *  - GET /v1/analytics/drill-through/:reportId/:cellId — happy path
 *  - GET /v1/analytics/drill-through/:reportId/:cellId — 404 non-existent report
 *  - GET /v1/analytics/drill-through/:reportId/:cellId — 409 report not completed
 *  - GET /v1/analytics/drill-through/:reportId/:cellId — row cap enforcement (200)
 *  - 401 unauthenticated, 403 unauthorized role
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { eq, sql } from "drizzle-orm";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { factEvents } from "../src/modules/facts/schema.js";
import { queryRuns } from "../src/modules/queries/schema.js";
import type { FastifyInstance } from "fastify";

// Mock queue and cache to avoid real SQS/Redis
vi.mock("../src/shared/infra.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/shared/infra.js")>();
  return {
    ...original,
    queue: {
      publish: vi.fn().mockResolvedValue(undefined),
      subscribe: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    },
    cache: {
      getOrLoad: vi.fn(async (_key: string, loader: () => Promise<unknown>) => loader()),
      listOrLoad: vi.fn(async (_t: string, _r: string, _k: string, loader: () => Promise<unknown>) => loader()),
      makeKey: (_t: string, _r: string, _id: string) => `${_t}:${_r}:${_id}`,
      invalidateResource: vi.fn().mockResolvedValue(undefined),
    },
  };
});

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-3333-4000-8000-000000000001";
const ACTOR = "bbbbbbbb-3333-4000-8000-000000000001";

function makeToken(roles: string[] = ["analytics_user"]) {
  return signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-test" }, SECRET);
}

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  // Set tenant context and seed test data
  await db.execute(sql`SELECT set_config('app.tenant_id', ${TENANT}, false)`);

  // Seed fact_events for testing — event_type must be one of the CHECK constraint values
  const validEventTypes = ["payment.released", "release.processed", "po.approved"] as const;
  const events = Array.from({ length: 5 }, (_, i) => ({
    id: randomUUID(),
    tenantId: TENANT,
    source: i % 2 === 0 ? "finance" : "hrms",
    eventType: validEventTypes[i % 3],
    category: "general",
    status: i < 3 ? "completed" : "pending",
    amount: BigInt((i + 1) * 1000),
    occurredAt: new Date(`2026-07-0${i + 1}T10:00:00Z`),
    dedupeKey: `test-aq-${randomUUID()}`,
    createdBy: ACTOR,
    updatedBy: ACTOR,
  }));
  await db.insert(factEvents).values(events);
});

afterAll(async () => {
  await db.execute(sql`SELECT set_config('app.tenant_id', ${TENANT}, false)`);
  await db.delete(factEvents).where(eq(factEvents.tenantId, TENANT));
  await db.delete(queryRuns).where(eq(queryRuns.tenantId, TENANT));
  await app.close();
  await sqlClient.end();
});

// ─── POST /v1/analytics/query ────────────────────────────────────────────────

describe("POST /v1/analytics/query", () => {
  it("returns 200 with aggregated results — basic query", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/analytics/query",
      headers: { authorization: `Bearer ${makeToken(["analytics_user"])}` },
      payload: {
        metrics: ["event_count"],
        dimensions: ["source"],
        filters: [],
        limit: 100,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toBeDefined();
    expect(body.data.rows).toBeInstanceOf(Array);
    expect(body.data.rowCount).toBeGreaterThan(0);
    expect(body.data.metrics).toEqual(["event_count"]);
    expect(body.data.dimensions).toEqual(["source"]);
  });

  it("returns 200 with calculated fields", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/analytics/query",
      headers: { authorization: `Bearer ${makeToken(["analytics_admin"])}` },
      payload: {
        metrics: ["amount_sum", "event_count"],
        dimensions: ["source"],
        calculatedFields: [
          {
            alias: "avg_amount",
            expression: {
              op: "divide",
              left: { type: "column", key: "amount_sum" },
              right: { type: "column", key: "event_count" },
            },
          },
        ],
        limit: 100,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.calculatedFields).toEqual(["avg_amount"]);
    // Each row should have the avg_amount calculated field
    for (const row of body.data.rows) {
      expect(row).toHaveProperty("avg_amount");
      expect(typeof row.avg_amount === "number" || row.avg_amount === null).toBe(true);
    }
  });

  it("returns 200 with join conditions", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/analytics/query",
      headers: { authorization: `Bearer ${makeToken(["tenant_admin"])}` },
      payload: {
        metrics: ["event_count"],
        dimensions: ["source", "status"],
        joins: [{ leftKey: "source", rightKey: "source", type: "inner" }],
        limit: 100,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.rows).toBeInstanceOf(Array);
    expect(body.data.rowCount).toBeLessThanOrEqual(1000);
  });

  it("returns 400 for unregistered column in calculated field", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/analytics/query",
      headers: { authorization: `Bearer ${makeToken(["analytics_user"])}` },
      payload: {
        metrics: ["event_count"],
        dimensions: [],
        calculatedFields: [
          {
            alias: "bad_calc",
            expression: {
              op: "add",
              left: { type: "column", key: "nonexistent_column" },
              right: { type: "literal", value: 1 },
            },
          },
        ],
        limit: 100,
      },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.code).toBe("UNREGISTERED_IDENTIFIER");
  });

  it("returns 400 for invalid join key", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/analytics/query",
      headers: { authorization: `Bearer ${makeToken(["analytics_user"])}` },
      payload: {
        metrics: ["event_count"],
        dimensions: ["source"],
        joins: [{ leftKey: "invalid_key", rightKey: "source", type: "inner" }],
        limit: 100,
      },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.code).toBe("UNREGISTERED_LEFT_KEY");
  });

  it("returns 400 for invalid operator in expression", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/analytics/query",
      headers: { authorization: `Bearer ${makeToken(["analytics_user"])}` },
      payload: {
        metrics: ["event_count"],
        dimensions: [],
        calculatedFields: [
          {
            alias: "bad_op",
            expression: {
              op: "eval",
              left: { type: "literal", value: 1 },
              right: { type: "literal", value: 2 },
            },
          },
        ],
        limit: 100,
      },
    });

    // Should fail at zod validation (invalid op enum)
    expect(res.statusCode).toBe(400);
  });

  it("enforces row cap of 1000", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/analytics/query",
      headers: { authorization: `Bearer ${makeToken(["analytics_user"])}` },
      payload: {
        metrics: ["event_count"],
        dimensions: ["source"],
        limit: 1000,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.rowCount).toBeLessThanOrEqual(1000);
  });

  it("returns 400 when limit exceeds 1000", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/analytics/query",
      headers: { authorization: `Bearer ${makeToken(["analytics_user"])}` },
      payload: {
        metrics: ["event_count"],
        dimensions: [],
        limit: 2000,
      },
    });

    expect(res.statusCode).toBe(400);
  });
});

// ─── GET /v1/analytics/drill-through/:reportId/:cellId ───────────────────────

describe("GET /v1/analytics/drill-through/:reportId/:cellId", () => {
  let completedRunId: string;
  let runningRunId: string;

  beforeAll(async () => {
    completedRunId = randomUUID();
    runningRunId = randomUUID();

    await db.execute(sql`SELECT set_config('app.tenant_id', ${TENANT}, false)`);

    await db.insert(queryRuns).values([
      {
        id: completedRunId,
        tenantId: TENANT,
        queryName: "test-drill-report",
        status: "completed",
        kind: "adhoc",
        spec: { metric: "event_count", dimensions: ["source"], filters: [] },
        result: { rows: [{ source: "finance", value: 3 }] },
        resultRows: 1,
        createdBy: ACTOR,
        updatedBy: ACTOR,
      },
      {
        id: runningRunId,
        tenantId: TENANT,
        queryName: "test-running-report",
        status: "running",
        kind: "adhoc",
        spec: {},
        result: null,
        resultRows: 0,
        createdBy: ACTOR,
        updatedBy: ACTOR,
      },
    ]);
  });

  it("returns 200 with detail rows for completed report", async () => {
    const cellId = "source=finance";
    const res = await app.inject({
      method: "GET",
      url: `/v1/analytics/drill-through/${completedRunId}/${cellId}`,
      headers: { authorization: `Bearer ${makeToken(["analytics_user"])}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toBeDefined();
    expect(body.data.rows).toBeInstanceOf(Array);
    expect(body.data.rowCount).toBeLessThanOrEqual(200);
    expect(body.data.reportId).toBe(completedRunId);
    expect(body.data.cellId).toBe(cellId);
    // Verify all detail rows are from the "finance" source
    for (const row of body.data.rows) {
      expect(row.source).toBe("finance");
    }
  });

  it("returns 200 with multi-dimension cell filter", async () => {
    const cellId = "source=finance,status=completed";
    const res = await app.inject({
      method: "GET",
      url: `/v1/analytics/drill-through/${completedRunId}/${cellId}`,
      headers: { authorization: `Bearer ${makeToken(["analytics_admin"])}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    for (const row of body.data.rows) {
      expect(row.source).toBe("finance");
      expect(row.status).toBe("completed");
    }
  });

  it("returns 404 when report does not exist", async () => {
    const nonExistentId = randomUUID();
    const res = await app.inject({
      method: "GET",
      url: `/v1/analytics/drill-through/${nonExistentId}/source=finance`,
      headers: { authorization: `Bearer ${makeToken(["super_admin"])}` },
    });

    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.code).toBe("REPORT_NOT_FOUND");
  });

  it("returns 409 when report is not completed", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/analytics/drill-through/${runningRunId}/source=finance`,
      headers: { authorization: `Bearer ${makeToken(["analytics_user"])}` },
    });

    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.code).toBe("REPORT_NOT_READY");
  });

  it("returns 400 for invalid reportId (not uuid)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/analytics/drill-through/not-a-uuid/source=finance",
      headers: { authorization: `Bearer ${makeToken(["analytics_user"])}` },
    });

    expect(res.statusCode).toBe(400);
  });

  it("enforces row cap of 200", async () => {
    const cellId = "source=finance";
    const res = await app.inject({
      method: "GET",
      url: `/v1/analytics/drill-through/${completedRunId}/${cellId}?limit=500`,
      headers: { authorization: `Bearer ${makeToken(["analytics_user"])}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.rowCount).toBeLessThanOrEqual(200);
  });
});

// ─── Role-Based Access Control ───────────────────────────────────────────────

describe("analytics query RBAC", () => {
  it("returns 401 without authorization header", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/analytics/query",
      payload: { metrics: ["event_count"], dimensions: [], limit: 10 },
    });

    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for unauthorized role (employee)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/analytics/query",
      headers: { authorization: `Bearer ${makeToken(["employee"])}` },
      payload: { metrics: ["event_count"], dimensions: [], limit: 10 },
    });

    expect(res.statusCode).toBe(403);
  });

  it("returns 403 for drill-through with unauthorized role (citizen)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/analytics/drill-through/${randomUUID()}/source=finance`,
      headers: { authorization: `Bearer ${makeToken(["citizen"])}` },
    });

    expect(res.statusCode).toBe(403);
  });

  it("allows analytics_user role for query", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/analytics/query",
      headers: { authorization: `Bearer ${makeToken(["analytics_user"])}` },
      payload: { metrics: ["event_count"], dimensions: [], limit: 10 },
    });

    expect(res.statusCode).toBe(200);
  });

  it("allows super_admin role for query", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/analytics/query",
      headers: { authorization: `Bearer ${makeToken(["super_admin"])}` },
      payload: { metrics: ["event_count"], dimensions: [], limit: 10 },
    });

    expect(res.statusCode).toBe(200);
  });

  it("allows tenant_admin role for drill-through", async () => {
    // Will get 404 since the report doesn't exist for this test, but auth passes
    const res = await app.inject({
      method: "GET",
      url: `/v1/analytics/drill-through/${randomUUID()}/source=x`,
      headers: { authorization: `Bearer ${makeToken(["tenant_admin"])}` },
    });

    // Should be 404 (not 403), proving auth passed
    expect(res.statusCode).toBe(404);
  });
});
