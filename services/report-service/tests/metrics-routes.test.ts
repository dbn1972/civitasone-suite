/**
 * metric definition route tests — /v1/reports/metrics.
 *
 * Runs against the in-memory Fastify app (app.inject) and the real Postgres
 * schema. Because the service is strict CQRS the routes only ever return 202, so
 * the module's own consumers are registered against the in-memory queue and
 * `drain()` is awaited to let the write land before the next read.
 *
 * Covers per endpoint: happy path, 400 validation, 401 unauthenticated,
 * 403 wrong role, 404 missing, 409 version conflict, 409 canonical immutable,
 * 422 invalid status transition.
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerMetricConsumers } from "../src/modules/metrics/consumer.js";
import { metricDefinitions } from "../src/modules/metrics/schema.js";
import { PLATFORM_TENANT_ID } from "../src/modules/metrics/domain.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "cccccccc-3333-4000-8000-0000000000c4";
const ACTOR = "cccccccc-3333-4000-8000-000000000001";
const MISSING_ID = "00000000-0000-4000-8000-0000000000ff";
/** Seeded by migration 0018 — platform-owned canonical definition. */
const CANONICAL_KEY = "crm.retention_90d_rate";

function makeToken(roles: string[] = ["report_admin"]): string {
  return signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-metrics-001" }, SECRET);
}

function auth(roles?: string[]): { authorization: string } {
  return { authorization: `Bearer ${makeToken(roles)}` };
}

let app: FastifyInstance;

/** MemoryQueue test aid — settle every in-flight consumer delivery. */
async function drain(): Promise<void> {
  await (queue as unknown as { drain: () => Promise<void> }).drain();
}

async function purge(): Promise<void> {
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.delete(metricDefinitions).where(eq(metricDefinitions.tenantId, TENANT));
    }),
  );
}

const draftBody = {
  metricKey: "crm.test_cycle_days",
  displayName: "Test cycle time (days)",
  description: "Mean elapsed days for the test cycle.",
  module: "crm",
  unit: "days",
  aggregation: "avg",
  numeratorSource: "crm.test_cycle",
  dimensions: ["region", "channel"],
  period: "monthly",
  higherIsBetter: false,
};

beforeAll(async () => {
  app = await buildApp();
  registerMetricConsumers(queue);
  await queue.start();
  await purge();
});

afterAll(async () => {
  await purge();
  await app.close();
  await sqlClient.end();
});

// ═══ GET /v1/reports/metrics — list ════════════════════════════════════════

describe("GET /v1/reports/metrics", () => {
  it("returns the paginated envelope including the canonical seeds", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/reports/metrics", headers: auth() });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.meta).toEqual({ page: 1, pageSize: 20, total: body.meta.total });
    expect(body.meta.total).toBeGreaterThanOrEqual(14);
    expect(body.data.some((r: { metricKey: string }) => r.metricKey === CANONICAL_KEY)).toBe(true);
  });

  it("filters by governance", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/reports/metrics?governance=canonical&limit=200",
      headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    const rows = res.json().data as { governance: string; tenantId: string }[];
    expect(rows.length).toBeGreaterThanOrEqual(14);
    for (const row of rows) expect(row.governance).toBe("canonical");
  });

  it("filters by module and status", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/reports/metrics?module=service&status=published&limit=50",
      headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    const rows = res.json().data as { module: string; status: string }[];
    expect(rows.length).toBeGreaterThanOrEqual(3);
    for (const row of rows) {
      expect(row.module).toBe("service");
      expect(row.status).toBe("published");
    }
  });

  it("filters by metricKey", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/reports/metrics?metricKey=${CANONICAL_KEY}`,
      headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    const rows = res.json().data as { metricKey: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.metricKey).toBe(CANONICAL_KEY);
  });

  it("returns 400 when limit exceeds 200", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/reports/metrics?limit=201",
      headers: auth(),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_FAILED");
  });

  it("returns 400 for an unknown status filter", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/reports/metrics?status=archived",
      headers: auth(),
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without a token", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/reports/metrics" });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for a role without report access", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/reports/metrics",
      headers: auth(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });
});

// ═══ GET /v1/reports/metrics/by-key/:metricKey ═════════════════════════════

describe("GET /v1/reports/metrics/by-key/:metricKey", () => {
  it("resolves the published canonical definition", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/reports/metrics/by-key/${CANONICAL_KEY}`,
      headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.metricKey).toBe(CANONICAL_KEY);
    expect(data.status).toBe("published");
    expect(data.governance).toBe("canonical");
    expect(data.tenantId).toBe(PLATFORM_TENANT_ID);
    // ratio metric → denominator present, dimensions preserved
    expect(data.aggregation).toBe("ratio");
    expect(data.denominatorSource).toBe("crm.customers_at_window_start");
    expect(data.dimensions).toContain("region");
  });

  it("returns 404 when nothing is published for the key", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/reports/metrics/by-key/crm.no_such_metric",
      headers: auth(),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("NOT_FOUND");
  });

  it("returns 400 for an empty-ish key", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/reports/metrics/by-key/ab",
      headers: auth(),
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without a token", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/reports/metrics/by-key/${CANONICAL_KEY}`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for a role without report access", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/reports/metrics/by-key/${CANONICAL_KEY}`,
      headers: auth(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });
});

// ═══ POST /v1/reports/metrics — create ═════════════════════════════════════

describe("POST /v1/reports/metrics", () => {
  it("returns 401 without a token", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/reports/metrics",
      payload: draftBody,
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for a role without write access", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/reports/metrics",
      headers: auth(["report_user"]),
      payload: draftBody,
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns 400 when displayName is missing", async () => {
    const { displayName: _omitted, ...rest } = draftBody;
    const res = await app.inject({
      method: "POST",
      url: "/v1/reports/metrics",
      headers: auth(),
      payload: rest,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_FAILED");
  });

  it("returns 400 for an unknown aggregation", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/reports/metrics",
      headers: auth(),
      payload: { ...draftBody, aggregation: "median" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for more than 12 dimensions", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/reports/metrics",
      headers: auth(),
      payload: {
        ...draftBody,
        dimensions: Array.from({ length: 13 }, (_, i) => `dim_${i}`),
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 422 when a ratio metric has no denominator", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/reports/metrics",
      headers: auth(),
      payload: { ...draftBody, metricKey: "crm.test_ratio", aggregation: "ratio" },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().message).toContain("denominatorSource");
  });

  it("returns 422 when a non-ratio metric carries a denominator", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/reports/metrics",
      headers: auth(),
      payload: { ...draftBody, denominatorSource: "crm.something_total" },
    });
    expect(res.statusCode).toBe(422);
  });

  it("returns 422 for a source identifier outside the allowlist", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/reports/metrics",
      headers: auth(),
      payload: { ...draftBody, numeratorSource: "crm.leads; DROP TABLE reports.kpis" },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().message).toContain("numeratorSource");
  });

  it("returns 422 for a duplicate dimension", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/reports/metrics",
      headers: auth(),
      payload: { ...draftBody, dimensions: ["region", "region"] },
    });
    expect(res.statusCode).toBe(422);
  });
});

// ═══ Lifecycle: create → patch → publish → version → deprecate ═════════════

describe("metric definition lifecycle", () => {
  let id = "";

  it("accepts the create command and the consumer persists a draft", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/reports/metrics",
      headers: auth(),
      payload: draftBody,
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().data.status).toBe("accepted");
    id = res.json().data.id as string;
    await drain();

    const get = await app.inject({
      method: "GET",
      url: `/v1/reports/metrics/${id}`,
      headers: auth(),
    });
    expect(get.statusCode).toBe(200);
    const data = get.json().data;
    expect(data.metricKey).toBe(draftBody.metricKey);
    expect(data.status).toBe("draft");
    expect(data.governance).toBe("tenant");
    expect(data.versionNumber).toBe(1);
    expect(data.version).toBe(1);
    expect(data.higherIsBetter).toBe(false);
    expect(data.dimensions).toEqual(["region", "channel"]);
    expect(data.denominatorSource).toBeNull();
    expect(data.targetValue).toBeNull();
  });

  it("returns 409 METRIC_KEY_EXISTS on a second plain create for the same key", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/reports/metrics",
      headers: auth(),
      payload: draftBody,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("METRIC_KEY_EXISTS");
  });

  it("updates a draft and bumps the optimistic lock", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/reports/metrics/${id}`,
      headers: auth(),
      payload: { description: "Revised description", targetValue: "12.5", version: 1 },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().data.id).toBe(id);
    await drain();

    const get = await app.inject({
      method: "GET",
      url: `/v1/reports/metrics/${id}`,
      headers: auth(),
    });
    const data = get.json().data;
    expect(data.description).toBe("Revised description");
    expect(Number(data.targetValue)).toBe(12.5);
    expect(data.version).toBe(2);
  });

  it("returns 409 VERSION_CONFLICT for a stale version", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/reports/metrics/${id}`,
      headers: auth(),
      payload: { description: "Stale write", version: 1 },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("VERSION_CONFLICT");
  });

  it("returns 422 INVALID_STATUS_TRANSITION when deprecating a draft", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/reports/metrics/${id}/deprecate`,
      headers: auth(),
      payload: { version: 2 },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("INVALID_STATUS_TRANSITION");
  });

  it("returns 422 when a patch would break the denominator rule", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/reports/metrics/${id}`,
      headers: auth(),
      payload: { aggregation: "ratio", version: 2 },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().message).toContain("denominatorSource");
  });

  it("publishes the draft", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/reports/metrics/${id}/publish`,
      headers: auth(),
      payload: { version: 2 },
    });
    expect(res.statusCode).toBe(202);
    await drain();

    const get = await app.inject({
      method: "GET",
      url: `/v1/reports/metrics/${id}`,
      headers: auth(),
    });
    const data = get.json().data;
    expect(data.status).toBe("published");
    expect(data.publishedAt).not.toBeNull();
    expect(data.version).toBe(3);
  });

  it("resolves the published definition by key", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/reports/metrics/by-key/${draftBody.metricKey}`,
      headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.id).toBe(id);
  });

  it("returns 422 INVALID_STATUS_TRANSITION when publishing twice", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/reports/metrics/${id}/publish`,
      headers: auth(),
      payload: { version: 3 },
    });
    expect(res.statusCode).toBe(422);
  });

  it("returns 409 PUBLISHED_IMMUTABLE when changing the shape of a published definition", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/reports/metrics/${id}`,
      headers: auth(),
      payload: { unit: "hours", version: 3 },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("PUBLISHED_IMMUTABLE");
  });

  it("still accepts a tenant override of targetValue on a published definition", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/reports/metrics/${id}`,
      headers: auth(),
      payload: { targetValue: 9, version: 3 },
    });
    expect(res.statusCode).toBe(202);
    await drain();

    const get = await app.inject({
      method: "GET",
      url: `/v1/reports/metrics/${id}`,
      headers: auth(),
    });
    expect(Number(get.json().data.targetValue)).toBe(9);
    expect(get.json().data.version).toBe(4);
  });

  it("returns 409 VERSION_CONFLICT when publishing with the wrong version", async () => {
    const other = await app.inject({
      method: "POST",
      url: "/v1/reports/metrics",
      headers: auth(),
      payload: { ...draftBody, metricKey: "crm.test_lock_days" },
    });
    const lockId = other.json().data.id as string;
    await drain();

    const res = await app.inject({
      method: "POST",
      url: `/v1/reports/metrics/${lockId}/publish`,
      headers: auth(),
      payload: { version: 7 },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("VERSION_CONFLICT");
  });

  it("creates the next versionNumber as a new draft, leaving the published row alone", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/reports/metrics/${id}/versions`,
      headers: auth(),
    });
    expect(res.statusCode).toBe(202);
    const newId = res.json().data.id as string;
    expect(newId).not.toBe(id);
    await drain();

    const fresh = await app.inject({
      method: "GET",
      url: `/v1/reports/metrics/${newId}`,
      headers: auth(),
    });
    expect(fresh.statusCode).toBe(200);
    expect(fresh.json().data.versionNumber).toBe(2);
    expect(fresh.json().data.status).toBe("draft");
    expect(fresh.json().data.metricKey).toBe(draftBody.metricKey);

    const original = await app.inject({
      method: "GET",
      url: `/v1/reports/metrics/${id}`,
      headers: auth(),
    });
    expect(original.json().data.status).toBe("published");
  });

  it("deprecates the published definition", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/reports/metrics/${id}/deprecate`,
      headers: auth(),
      payload: { version: 4 },
    });
    expect(res.statusCode).toBe(202);
    await drain();

    const get = await app.inject({
      method: "GET",
      url: `/v1/reports/metrics/${id}`,
      headers: auth(),
    });
    expect(get.json().data.status).toBe("deprecated");
    expect(get.json().data.deprecatedAt).not.toBeNull();
  });

  it("returns 409 DEPRECATED_IMMUTABLE when patching a deprecated definition", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/reports/metrics/${id}`,
      headers: auth(),
      payload: { description: "too late", version: 5 },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("DEPRECATED_IMMUTABLE");
  });
});

// ═══ Canonical immutability ════════════════════════════════════════════════

describe("canonical governance", () => {
  it("returns 409 CANONICAL_IMMUTABLE when patching a published canonical definition", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/v1/reports/metrics",
      headers: auth(),
      payload: {
        ...draftBody,
        metricKey: "crm.test_canonical_rate",
        aggregation: "ratio",
        unit: "percent",
        numeratorSource: "crm.test_numerator",
        denominatorSource: "crm.test_denominator",
        governance: "canonical",
      },
    });
    expect(created.statusCode).toBe(202);
    const canonicalId = created.json().data.id as string;
    await drain();

    const published = await app.inject({
      method: "POST",
      url: `/v1/reports/metrics/${canonicalId}/publish`,
      headers: auth(),
      payload: { version: 1 },
    });
    expect(published.statusCode).toBe(202);
    await drain();

    for (const patch of [
      { metricKey: "crm.test_canonical_renamed" },
      { unit: "count" },
      { aggregation: "percent" },
      { period: "yearly" },
    ]) {
      const res = await app.inject({
        method: "PATCH",
        url: `/v1/reports/metrics/${canonicalId}`,
        headers: auth(),
        payload: { ...patch, version: 2 },
      });
      expect(res.statusCode, JSON.stringify(patch)).toBe(409);
      expect(res.json().code).toBe("CANONICAL_IMMUTABLE");
    }

    // The overridable fields remain available to the tenant.
    const override = await app.inject({
      method: "PATCH",
      url: `/v1/reports/metrics/${canonicalId}`,
      headers: auth(),
      payload: { dimensions: ["region"], version: 2 },
    });
    expect(override.statusCode).toBe(202);
    await drain();
  });

  it("refuses to mutate a platform-owned canonical definition", async () => {
    const list = await app.inject({
      method: "GET",
      url: `/v1/reports/metrics?metricKey=${CANONICAL_KEY}`,
      headers: auth(),
    });
    const platformId = (list.json().data as { id: string }[])[0]?.id as string;

    const patch = await app.inject({
      method: "PATCH",
      url: `/v1/reports/metrics/${platformId}`,
      headers: auth(),
      payload: { targetValue: 90, version: 1 },
    });
    expect(patch.statusCode).toBe(409);
    expect(patch.json().code).toBe("CANONICAL_IMMUTABLE");

    const deprecate = await app.inject({
      method: "POST",
      url: `/v1/reports/metrics/${platformId}/deprecate`,
      headers: auth(),
      payload: { version: 1 },
    });
    expect(deprecate.statusCode).toBe(409);
    expect(deprecate.json().code).toBe("CANONICAL_IMMUTABLE");
  });

  it("forks a platform canonical definition into a tenant-owned draft", async () => {
    const list = await app.inject({
      method: "GET",
      url: `/v1/reports/metrics?metricKey=${CANONICAL_KEY}`,
      headers: auth(),
    });
    const platformId = (list.json().data as { id: string }[])[0]?.id as string;

    const res = await app.inject({
      method: "POST",
      url: `/v1/reports/metrics/${platformId}/versions`,
      headers: auth(),
    });
    expect(res.statusCode).toBe(202);
    const forkId = res.json().data.id as string;
    await drain();

    const get = await app.inject({
      method: "GET",
      url: `/v1/reports/metrics/${forkId}`,
      headers: auth(),
    });
    expect(get.statusCode).toBe(200);
    const data = get.json().data;
    expect(data.tenantId).toBe(TENANT);
    expect(data.governance).toBe("tenant");
    expect(data.status).toBe("draft");
    expect(data.metricKey).toBe(CANONICAL_KEY);
    expect(data.versionNumber).toBe(2);
  });
});

// ═══ Not found / malformed ids ═════════════════════════════════════════════

describe("missing and malformed ids", () => {
  it("returns 404 for an unknown definition", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/reports/metrics/${MISSING_ID}`,
      headers: auth(),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("NOT_FOUND");
  });

  it("returns 400 for a non-uuid id", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/reports/metrics/not-a-uuid",
      headers: auth(),
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 for a single read without a token", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/reports/metrics/${MISSING_ID}` });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for a single read with the wrong role", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/reports/metrics/${MISSING_ID}`,
      headers: auth(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns 404 when patching an unknown definition", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/reports/metrics/${MISSING_ID}`,
      headers: auth(),
      payload: { description: "x", version: 1 },
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 400 when patching without a version", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/reports/metrics/${MISSING_ID}`,
      headers: auth(),
      payload: { description: "x" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 401/403 on patch for unauthenticated and wrong-role callers", async () => {
    const unauth = await app.inject({
      method: "PATCH",
      url: `/v1/reports/metrics/${MISSING_ID}`,
      payload: { description: "x", version: 1 },
    });
    expect(unauth.statusCode).toBe(401);

    const forbidden = await app.inject({
      method: "PATCH",
      url: `/v1/reports/metrics/${MISSING_ID}`,
      headers: auth(["report_user"]),
      payload: { description: "x", version: 1 },
    });
    expect(forbidden.statusCode).toBe(403);
  });

  it("returns 404 when publishing, deprecating or versioning an unknown definition", async () => {
    for (const url of [
      `/v1/reports/metrics/${MISSING_ID}/publish`,
      `/v1/reports/metrics/${MISSING_ID}/deprecate`,
      `/v1/reports/metrics/${MISSING_ID}/versions`,
    ]) {
      const res = await app.inject({ method: "POST", url, headers: auth(), payload: { version: 1 } });
      expect(res.statusCode, url).toBe(404);
    }
  });

  it("returns 400 when a transition body omits the version", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/reports/metrics/${MISSING_ID}/publish`,
      headers: auth(),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 401/403 on transitions for unauthenticated and wrong-role callers", async () => {
    const unauth = await app.inject({
      method: "POST",
      url: `/v1/reports/metrics/${MISSING_ID}/publish`,
      payload: { version: 1 },
    });
    expect(unauth.statusCode).toBe(401);

    const forbidden = await app.inject({
      method: "POST",
      url: `/v1/reports/metrics/${MISSING_ID}/deprecate`,
      headers: auth(["report_user"]),
      payload: { version: 1 },
    });
    expect(forbidden.statusCode).toBe(403);

    const forbiddenVersions = await app.inject({
      method: "POST",
      url: `/v1/reports/metrics/${MISSING_ID}/versions`,
      headers: auth(["citizen"]),
    });
    expect(forbiddenVersions.statusCode).toBe(403);
  });
});

// ═══ Tenant isolation ══════════════════════════════════════════════════════

describe("tenant isolation", () => {
  it("does not expose another tenant's definitions", async () => {
    const otherTenant = "dddddddd-4444-4000-8000-0000000000d4";
    const token = signToken(
      { sub: ACTOR, tid: otherTenant, roles: ["report_admin"], sid: "sess-other" },
      SECRET,
    );
    const res = await app.inject({
      method: "GET",
      url: "/v1/reports/metrics?limit=200",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const rows = res.json().data as { tenantId: string }[];
    // Only the platform canonical rows are visible to a tenant with no definitions.
    for (const row of rows) expect(row.tenantId).toBe(PLATFORM_TENANT_ID);
  });
});
