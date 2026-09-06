/**
 * Integration tests for the findings module HTTP routes (SVC-105).
 *
 * These tests prove the non-compliance / defect / observation management API is
 * actually REACHABLE. `registerFindingsRoutes` is now mounted by `buildApp()`
 * (src/app.ts) — this test does NOT register the routes manually, so a passing
 * POST/GET is proof the production composition root wires findings.
 *
 * End-to-end path exercised:
 *   POST /v1/inspection/findings (mounted route) → publishFindingCreate →
 *   real registerFindingsConsumers handler (driven here) → insertFinding →
 *   GET /v1/inspection/findings/:id returns the persisted finding.
 *
 * Also asserts cross-tenant RLS isolation: a finding created under tenant A is
 * NOT readable with a tenant-B token (repo scopes every read by tenantId).
 *
 * **Validates: Requirements 9.1, 9.2, 9.3 (SVC-105 wiring)**
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";

// ── Identities ─────────────────────────────────────────────────────────────────

const TENANT_A = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const TENANT_B = "b2c3d4e5-f6a7-8901-bcde-f12345678901";
const USER_ID = "11111111-2222-3333-4444-555555555555";
const SECRET = "test_secret_for_civitasone_32chr";
const INSPECTION_ID = "c0c0c0c0-d1d1-e2e2-f3f3-a4a4a4a4a4a4";
const PROVISION_ID = "d0d0d0d0-e1e1-f2f2-a3a3-b4b4b4b4b4b4";

function makeToken(tenantId: string, roles: string[]): string {
  return signToken(
    { sub: USER_ID, tid: tenantId, roles, sid: "sess-test-1" },
    SECRET,
    3600,
  );
}

const A_INSPECTOR = { authorization: `Bearer ${makeToken(TENANT_A, ["inspector"])}` };
const A_READER = { authorization: `Bearer ${makeToken(TENANT_A, ["reviewing_officer"])}` };
const B_READER = { authorization: `Bearer ${makeToken(TENANT_B, ["reviewing_officer"])}` };
const NO_ROLE = { authorization: `Bearer ${makeToken(TENANT_A, ["employee"])}` };

// ── In-memory tenant-scoped store (stands in for the RLS-protected table) ──────

interface Row { [k: string]: unknown; id: string; tenantId: string; inspectionId: string }
const store = new Map<string, Row>(); // key: `${tenantId}:${id}`
const seqByKey = new Map<string, number>(); // key: `${tenantId}:${year}`
const key = (tenantId: string, id: string) => `${tenantId}:${id}`;

// ── Captured command bus (drives the real consumer) ────────────────────────────

const published: Array<{ topic: string; msg: any }> = [];
const handlers = new Map<string, (msg: any) => Promise<void>>();

async function drain(): Promise<void> {
  while (published.length > 0) {
    const { topic, msg } = published.shift()!;
    const h = handlers.get(topic);
    if (h) await h(msg);
  }
}

// ── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock("../src/shared/db.js", () => ({
  db: {
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({})),
    execute: vi.fn(),
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
  },
  sqlClient: { end: vi.fn() },
  dbFor: vi.fn(),
  sqlClientFor: vi.fn(),
  tierOf: vi.fn(),
  dbForRead: vi.fn(),
  scopedRead: vi.fn(),
}));

vi.mock("../src/shared/infra.js", () => ({
  invalidateSafely: vi.fn().mockResolvedValue(undefined),
  cache: {
    put: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(null),
    getOrLoad: vi.fn(async (_k: string, loader: () => Promise<unknown>) => loader()),
    invalidate: vi.fn().mockResolvedValue(undefined),
    makeKey: vi.fn((...args: string[]) => args.join(":")),
    invalidateResourceAfterCommit: vi.fn().mockResolvedValue(undefined),
  },
  queue: {
    publish: vi.fn(async (topic: string, msg: unknown) => {
      published.push({ topic, msg });
    }),
    subscribe: vi.fn((topic: string, handler: (msg: any) => Promise<void>) => {
      handlers.set(topic, handler);
    }),
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    healthCheck: vi.fn().mockResolvedValue({ healthy: true }),
  },
}));

// Outbox: idempotency guard passes once, event emission is a no-op.
vi.mock("../src/shared/outbox.js", () => ({
  markProcessed: vi.fn().mockResolvedValue(true),
  enqueue: vi.fn().mockResolvedValue(undefined),
}));

// Linked provision drives severity derivation (Req 9.2).
vi.mock("../src/modules/universe/repo.js", () => ({
  findProvisionById: vi.fn(async (tenantId: string, id: string) => ({
    id,
    tenantId,
    severityClass: "major",
  })),
}));

// findings repo backed by the tenant-scoped in-memory store.
vi.mock("../src/modules/findings/repo.js", () => ({
  findFindingById: vi.fn(async (tenantId: string, id: string) => store.get(key(tenantId, id)) ?? null),
  findFindings: vi.fn(async (
    tenantId: string,
    pagination: { page: number; pageSize: number },
    filters?: { inspectionId?: string; state?: string; severity?: string },
  ) => {
    let rows = [...store.values()].filter((r) => r.tenantId === tenantId);
    if (filters?.inspectionId) rows = rows.filter((r) => r.inspectionId === filters.inspectionId);
    if (filters?.state) rows = rows.filter((r) => r.state === filters.state);
    if (filters?.severity) rows = rows.filter((r) => r.severity === filters.severity);
    const total = rows.length;
    const start = (pagination.page - 1) * pagination.pageSize;
    return {
      data: rows.slice(start, start + pagination.pageSize),
      meta: { page: pagination.page, pageSize: pagination.pageSize, total },
    };
  }),
  insertFinding: vi.fn(async (_tx: unknown, data: Record<string, unknown>) => {
    const now = new Date().toISOString();
    const row = {
      id: randomUUID(),
      closedAt: null,
      closedBy: null,
      verificationEvidence: null,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
      version: 1,
      ...data,
    } as Row;
    store.set(key(row.tenantId, row.id), row);
    return row;
  }),
  nextFindingSequence: vi.fn(async (_tx: unknown, tenantId: string, year: number) => {
    const k = `${tenantId}:${year}`;
    const next = (seqByKey.get(k) ?? 0) + 1;
    seqByKey.set(k, next);
    return next;
  }),
  updateFindingState: vi.fn(async () => ({})),
  insertComplianceNotice: vi.fn(async (_tx: unknown, data: Record<string, unknown>) => ({
    id: randomUUID(),
    ...data,
  })),
  softDeleteFinding: vi.fn(async () => ({})),
  findNoticesByFinding: vi.fn(async () => []),
  findOverdueFindings: vi.fn(async () => []),
}));

// ── App + real consumer wiring ─────────────────────────────────────────────────

let app: FastifyInstance;

beforeAll(async () => {
  const { buildApp } = await import("../src/app.js");
  // NOTE: buildApp() is the sole production composition root; it now mounts the
  // findings routes itself. We deliberately do NOT call registerFindingsRoutes.
  app = await buildApp();
  await app.ready();

  // Register the REAL command consumers against the captured queue so the
  // create command actually persists (proving the full write path).
  const { queue } = await import("../src/shared/infra.js");
  const { registerFindingsConsumers } = await import("../src/modules/findings/consumer.js");
  registerFindingsConsumers(queue as never);
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  store.clear();
  seqByKey.clear();
  published.length = 0;
});

// ══════════════════════════════════════════════════════════════════════════════
// The route is actually MOUNTED (regression guard for SVC-105 wiring)
// ══════════════════════════════════════════════════════════════════════════════

describe("findings routes are mounted by buildApp (SVC-105)", () => {
  it("POST /v1/inspection/findings is reachable — returns 202, NOT 404", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/inspection/findings",
      headers: A_INSPECTOR,
      payload: {
        inspectionId: INSPECTION_ID,
        provisionId: PROVISION_ID,
        description: "Blocked fire exit on level 2",
      },
    });
    expect(res.statusCode).toBe(202);
    expect(res.statusCode).not.toBe(404);
    expect(res.json().data.accepted).toBe(true);
  });

  it("GET /v1/inspection/findings (list) is reachable — returns 200, NOT 404", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/inspection/findings",
      headers: A_READER,
    });
    expect(res.statusCode).toBe(200);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Full HTTP → consumer → persistence → HTTP read path
// ══════════════════════════════════════════════════════════════════════════════

describe("create → consume → read (real persistence)", () => {
  it("persists a finding via the mounted POST route and reads it back over HTTP", async () => {
    // 1. POST create via the NOW-MOUNTED route (202 accepted, command published)
    const createRes = await app.inject({
      method: "POST",
      url: "/v1/inspection/findings",
      headers: A_INSPECTOR,
      payload: {
        inspectionId: INSPECTION_ID,
        provisionId: PROVISION_ID,
        description: "Missing extinguisher signage",
        evidenceIds: [],
      },
    });
    expect(createRes.statusCode).toBe(202);
    expect(published).toHaveLength(1);

    // 2. Drive the real consumer — this performs the actual persistence.
    await drain();
    expect(store.size).toBe(1);

    // 3. Discover the persisted finding id, then GET it back over the HTTP route.
    const persisted = [...store.values()][0]!;
    const getRes = await app.inject({
      method: "GET",
      url: `/v1/inspection/findings/${persisted.id}`,
      headers: A_READER,
    });
    expect(getRes.statusCode).toBe(200);
    const body = getRes.json().data;
    expect(body.id).toBe(persisted.id);
    expect(body.description).toBe("Missing extinguisher signage");
    expect(body.severity).toBe("major"); // derived from provision.severityClass (Req 9.2)
    expect(body.state).toBe("open");
    expect(body.findingNumber).toMatch(/^FND-\d{4}-\d{6}$/); // Req 9.3 numbering
    expect(body.inspectionId).toBe(INSPECTION_ID);

    // 4. The list endpoint also returns it under the correct tenant.
    const listRes = await app.inject({
      method: "GET",
      url: `/v1/inspection/findings?inspectionId=${INSPECTION_ID}`,
      headers: A_READER,
    });
    expect(listRes.statusCode).toBe(200);
    const list = listRes.json();
    expect(list.data).toHaveLength(1);
    expect(list.data[0].id).toBe(persisted.id);
    expect(list.meta.total).toBe(1);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Cross-tenant RLS isolation
// ══════════════════════════════════════════════════════════════════════════════

describe("cross-tenant isolation", () => {
  it("a finding created under tenant A is NOT readable with a tenant-B token", async () => {
    // Create + persist under tenant A.
    const createRes = await app.inject({
      method: "POST",
      url: "/v1/inspection/findings",
      headers: A_INSPECTOR,
      payload: {
        inspectionId: INSPECTION_ID,
        provisionId: PROVISION_ID,
        description: "Tenant A only finding",
      },
    });
    expect(createRes.statusCode).toBe(202);
    await drain();
    const persisted = [...store.values()][0]!;
    expect(persisted.tenantId).toBe(TENANT_A);

    // Tenant B cannot read tenant A's finding by id → 404 (scoped read miss).
    const crossGet = await app.inject({
      method: "GET",
      url: `/v1/inspection/findings/${persisted.id}`,
      headers: B_READER,
    });
    expect(crossGet.statusCode).toBe(404);

    // Tenant B's list does not include it.
    const crossList = await app.inject({
      method: "GET",
      url: "/v1/inspection/findings",
      headers: B_READER,
    });
    expect(crossList.statusCode).toBe(200);
    expect(crossList.json().data).toHaveLength(0);

    // Tenant A still sees it.
    const ownGet = await app.inject({
      method: "GET",
      url: `/v1/inspection/findings/${persisted.id}`,
      headers: A_READER,
    });
    expect(ownGet.statusCode).toBe(200);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Route auth/validation guards (mounted route enforces RBAC + zod)
// ══════════════════════════════════════════════════════════════════════════════

describe("mounted route guards", () => {
  it("returns 401 without auth", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/inspection/findings",
      payload: { inspectionId: INSPECTION_ID, provisionId: PROVISION_ID, description: "x" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for a role without findings access", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/inspection/findings",
      headers: NO_ROLE,
      payload: { inspectionId: INSPECTION_ID, provisionId: PROVISION_ID, description: "x" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns 400 on invalid body (missing description)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/inspection/findings",
      headers: A_INSPECTOR,
      payload: { inspectionId: INSPECTION_ID, provisionId: PROVISION_ID },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 404 for an unknown finding id", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/inspection/findings/${randomUUID()}`,
      headers: A_READER,
    });
    expect(res.statusCode).toBe(404);
  });
});
