/**
 * Export routes integration tests (inject).
 *
 * Covers:
 *  - POST /v1/analytics/exports → 202 happy path
 *  - POST /v1/analytics/exports → 422 when source query unavailable
 *  - GET /v1/analytics/exports/:id → 302 redirect on completed
 *  - GET /v1/analytics/exports/:id → 409 on in-progress/failed
 *  - Role-based access (analytics_viewer, analytics_admin, tenant_admin, super_admin)
 *  - 401 unauthenticated, 403 unauthorized role
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { eq, sql } from "drizzle-orm";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queryRuns } from "../src/modules/queries/schema.js";
import { exportJobs } from "../src/modules/exports/schema.js";
import type { FastifyInstance } from "fastify";

// Mock queue to avoid real SQS/RabbitMQ publish
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
const TENANT = "aaaaaaaa-1111-4000-8000-000000000001";
const ACTOR = "bbbbbbbb-2222-4000-8000-000000000001";

function makeToken(roles: string[] = ["analytics_viewer"]) {
  return signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-test" }, SECRET);
}

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  // Set tenant context for seeding data
  await db.execute(sql`SELECT set_config('app.tenant_id', ${TENANT}, false)`);
});

afterAll(async () => {
  await db.execute(sql`SELECT set_config('app.tenant_id', ${TENANT}, false)`);
  await db.delete(exportJobs).where(eq(exportJobs.tenantId, TENANT));
  await db.delete(queryRuns).where(eq(queryRuns.tenantId, TENANT));
  await app.close();
  await sqlClient.end();
});

async function seedQueryRun(id: string, status: string, result: Record<string, unknown> | null = null) {
  await db.execute(sql`SELECT set_config('app.tenant_id', ${TENANT}, false)`);
  await db.insert(queryRuns).values({
    id,
    tenantId: TENANT,
    queryName: "test-query",
    status,
    kind: "adhoc",
    spec: {},
    result,
    resultRows: 0,
    createdBy: ACTOR,
    updatedBy: ACTOR,
  });
}

async function seedExportJob(
  id: string,
  status: string,
  opts: { downloadUrl?: string; error?: string } = {},
) {
  await db.execute(sql`SELECT set_config('app.tenant_id', ${TENANT}, false)`);
  await db.insert(exportJobs).values({
    id,
    tenantId: TENANT,
    queryRunId: null,
    format: "csv",
    status,
    fileKey: status === "completed" ? `exports/${TENANT}/${id}.csv` : null,
    downloadUrl: opts.downloadUrl ?? null,
    expiresAt: status === "completed" ? new Date(Date.now() + 86400000) : null,
    fileSizeBytes: status === "completed" ? 1024n : null,
    error: opts.error ?? null,
    createdBy: ACTOR,
    updatedBy: ACTOR,
  });
}

describe("POST /v1/analytics/exports", () => {
  it("returns 202 with { data: { id, status: 'pending' } } on valid request", async () => {
    const queryRunId = randomUUID();
    await seedQueryRun(queryRunId, "completed", { rows: [{ x: 1 }] });

    const res = await app.inject({
      method: "POST",
      url: "/v1/analytics/exports",
      headers: { authorization: `Bearer ${makeToken(["analytics_viewer"])}` },
      payload: { queryRunId, format: "csv" },
    });

    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.data).toBeDefined();
    expect(body.data.id).toBeDefined();
    expect(body.data.status).toBe("pending");
  });

  it("returns 422 when source query run does not exist", async () => {
    const nonExistentId = randomUUID();

    const res = await app.inject({
      method: "POST",
      url: "/v1/analytics/exports",
      headers: { authorization: `Bearer ${makeToken(["analytics_admin"])}` },
      payload: { queryRunId: nonExistentId, format: "json" },
    });

    expect(res.statusCode).toBe(422);
    const body = res.json();
    expect(body.code).toBe("SOURCE_QUERY_UNAVAILABLE");
    expect(body.message).toBe("source query unavailable");
  });

  it("returns 422 when source query run is not completed (running)", async () => {
    const queryRunId = randomUUID();
    await seedQueryRun(queryRunId, "running");

    const res = await app.inject({
      method: "POST",
      url: "/v1/analytics/exports",
      headers: { authorization: `Bearer ${makeToken(["tenant_admin"])}` },
      payload: { queryRunId, format: "xlsx" },
    });

    expect(res.statusCode).toBe(422);
    const body = res.json();
    expect(body.code).toBe("SOURCE_QUERY_UNAVAILABLE");
  });

  it("returns 422 when source query run has failed status", async () => {
    const queryRunId = randomUUID();
    await seedQueryRun(queryRunId, "failed");

    const res = await app.inject({
      method: "POST",
      url: "/v1/analytics/exports",
      headers: { authorization: `Bearer ${makeToken(["super_admin"])}` },
      payload: { queryRunId, format: "pdf" },
    });

    expect(res.statusCode).toBe(422);
    const body = res.json();
    expect(body.code).toBe("SOURCE_QUERY_UNAVAILABLE");
  });

  it("returns 400 for invalid format", async () => {
    const queryRunId = randomUUID();

    const res = await app.inject({
      method: "POST",
      url: "/v1/analytics/exports",
      headers: { authorization: `Bearer ${makeToken(["analytics_viewer"])}` },
      payload: { queryRunId, format: "txt" },
    });

    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for invalid queryRunId (not uuid)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/analytics/exports",
      headers: { authorization: `Bearer ${makeToken(["analytics_viewer"])}` },
      payload: { queryRunId: "not-a-uuid", format: "csv" },
    });

    expect(res.statusCode).toBe(400);
  });

  it("accepts all valid formats: csv, json, pdf, xlsx", async () => {
    const queryRunId = randomUUID();
    await seedQueryRun(queryRunId, "completed", { rows: [] });

    for (const format of ["csv", "json", "pdf", "xlsx"]) {
      const res = await app.inject({
        method: "POST",
        url: "/v1/analytics/exports",
        headers: { authorization: `Bearer ${makeToken(["analytics_viewer"])}` },
        payload: { queryRunId, format },
      });
      expect(res.statusCode).toBe(202);
    }
  });
});

describe("GET /v1/analytics/exports/:id", () => {
  it("returns 302 redirect to presigned URL when export is completed", async () => {
    const exportId = randomUUID();
    await seedExportJob(exportId, "completed", {
      downloadUrl: "https://s3.example.com/exports/signed-url",
    });

    const res = await app.inject({
      method: "GET",
      url: `/v1/analytics/exports/${exportId}`,
      headers: { authorization: `Bearer ${makeToken(["analytics_viewer"])}` },
    });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("https://s3.example.com/exports/signed-url");
  });

  it("returns 409 with EXPORT_IN_PROGRESS when status is pending", async () => {
    const exportId = randomUUID();
    // "pending" is the actual first-state value: analytics.export_jobs_status_check
    // (migrations/0010_export_jobs_enhancement.sql) only allows
    // pending|processing|completed|failed. "queued" is leftover pre-migration
    // vocabulary and violates that CHECK constraint outright.
    await seedExportJob(exportId, "pending");

    const res = await app.inject({
      method: "GET",
      url: `/v1/analytics/exports/${exportId}`,
      headers: { authorization: `Bearer ${makeToken(["analytics_admin"])}` },
    });

    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.error.code).toBe("EXPORT_IN_PROGRESS");
  });

  it("returns 409 with EXPORT_IN_PROGRESS when status is processing", async () => {
    const exportId = randomUUID();
    await seedExportJob(exportId, "processing");

    const res = await app.inject({
      method: "GET",
      url: `/v1/analytics/exports/${exportId}`,
      headers: { authorization: `Bearer ${makeToken(["analytics_viewer"])}` },
    });

    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.error.code).toBe("EXPORT_IN_PROGRESS");
  });

  it("returns 409 with EXPORT_FAILED when status is failed", async () => {
    const exportId = randomUUID();
    await seedExportJob(exportId, "failed", { error: "disk quota exceeded" });

    const res = await app.inject({
      method: "GET",
      url: `/v1/analytics/exports/${exportId}`,
      headers: { authorization: `Bearer ${makeToken(["tenant_admin"])}` },
    });

    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.error.code).toBe("EXPORT_FAILED");
    expect(body.error.message).toBe("disk quota exceeded");
  });

  it("returns 404 when export does not exist", async () => {
    const nonExistentId = randomUUID();

    const res = await app.inject({
      method: "GET",
      url: `/v1/analytics/exports/${nonExistentId}`,
      headers: { authorization: `Bearer ${makeToken(["super_admin"])}` },
    });

    expect(res.statusCode).toBe(404);
  });

  it("returns 400 for invalid id (not uuid)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/analytics/exports/not-a-uuid",
      headers: { authorization: `Bearer ${makeToken(["analytics_viewer"])}` },
    });

    expect(res.statusCode).toBe(400);
  });
});

describe("role-based access control", () => {
  it("allows analytics_viewer role", async () => {
    const queryRunId = randomUUID();
    await seedQueryRun(queryRunId, "completed", { rows: [] });

    const res = await app.inject({
      method: "POST",
      url: "/v1/analytics/exports",
      headers: { authorization: `Bearer ${makeToken(["analytics_viewer"])}` },
      payload: { queryRunId, format: "csv" },
    });

    expect(res.statusCode).toBe(202);
  });

  it("allows analytics_admin role", async () => {
    const queryRunId = randomUUID();
    await seedQueryRun(queryRunId, "completed", { rows: [] });

    const res = await app.inject({
      method: "POST",
      url: "/v1/analytics/exports",
      headers: { authorization: `Bearer ${makeToken(["analytics_admin"])}` },
      payload: { queryRunId, format: "csv" },
    });

    expect(res.statusCode).toBe(202);
  });

  it("allows tenant_admin role", async () => {
    const queryRunId = randomUUID();
    await seedQueryRun(queryRunId, "completed", { rows: [] });

    const res = await app.inject({
      method: "POST",
      url: "/v1/analytics/exports",
      headers: { authorization: `Bearer ${makeToken(["tenant_admin"])}` },
      payload: { queryRunId, format: "csv" },
    });

    expect(res.statusCode).toBe(202);
  });

  it("allows super_admin role", async () => {
    const queryRunId = randomUUID();
    await seedQueryRun(queryRunId, "completed", { rows: [] });

    const res = await app.inject({
      method: "POST",
      url: "/v1/analytics/exports",
      headers: { authorization: `Bearer ${makeToken(["super_admin"])}` },
      payload: { queryRunId, format: "csv" },
    });

    expect(res.statusCode).toBe(202);
  });

  it("returns 403 for unauthorized role (citizen)", async () => {
    const queryRunId = randomUUID();

    const res = await app.inject({
      method: "POST",
      url: "/v1/analytics/exports",
      headers: { authorization: `Bearer ${makeToken(["citizen"])}` },
      payload: { queryRunId, format: "csv" },
    });

    expect(res.statusCode).toBe(403);
  });

  it("returns 403 for unauthorized role (employee)", async () => {
    const exportId = randomUUID();

    const res = await app.inject({
      method: "GET",
      url: `/v1/analytics/exports/${exportId}`,
      headers: { authorization: `Bearer ${makeToken(["employee"])}` },
    });

    expect(res.statusCode).toBe(403);
  });

  it("returns 401 without authorization header", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/analytics/exports",
      payload: { queryRunId: randomUUID(), format: "csv" },
    });

    expect(res.statusCode).toBe(401);
  });
});
