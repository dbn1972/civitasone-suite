/**
 * Route boundary tests for works-service.
 * Tests auth (401/403), validation (400), and happy paths (202/200).
 * Uses buildApp + inject with HS256 tokens.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";

// Mock DB/infra modules before importing app
vi.mock("@civitasone/db", () => ({
  createTenantDb: () => ({
    sqlClient: { end: vi.fn() },
    db: {
      transaction: vi.fn((fn: Function) => fn({
        select: () => ({ from: () => ({ where: () => ({ limit: () => ({ offset: () => Promise.resolve([]) }), groupBy: () => Promise.resolve([]), then: (r: Function) => Promise.resolve([]).then(r) }), then: (r: Function) => Promise.resolve([]).then(r) }) }),
        insert: () => ({ values: () => ({ onConflictDoNothing: () => ({ returning: () => Promise.resolve([{ messageId: "x" }]) }) }) }),
        update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
      })),
      select: () => ({ from: () => ({ where: () => ({ limit: () => ({ offset: () => Promise.resolve([]) }) }) }) }),
    },
    dbFor: vi.fn(),
    sqlClientFor: vi.fn(),
    tierOf: vi.fn(),
    dbForRead: vi.fn(),
  }),
  createTenantTxHook: () => async () => {},
  tenantStorage: { enterWith: vi.fn() },
  runWithTenant: vi.fn((_t: string, fn: Function) => fn()),
}));

vi.mock("@civitasone/cache", () => ({
  Cache: class {
    getOrLoad(key: string, _fn: Function) {
      // Keys with page/pageSize (6+ colons) are list queries → return empty array
      // Single-item lookups (5 colons: service:tenant:entity:table:id) → return null
      const parts = key.split(":");
      if (parts.length >= 6) return Promise.resolve([]);
      return Promise.resolve(null);
    }
    invalidate() { return Promise.resolve(); }
  },
}));

vi.mock("../src/modules/tender/repo.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/modules/tender/repo.js")>();
  const defaultAward = {
    id: "00000000-2222-4000-8000-000000000001",
    tenantId: "11111111-bbbb-4000-8000-000000000001",
    workId: "00000000-1111-4000-8000-000000000001",
    acceptedAmountMinor: 999999999999n,
    status: "do_finalized",
    contractorName: "Test Contractor",
  };
  return {
    ...orig,
    getAwardById: vi.fn(async () => defaultAward),
    getAward: vi.fn(async () => defaultAward),
    listTenders: vi.fn(async () => []),
    listQuotations: vi.fn(async () => []),
    hasTenderForWork: vi.fn(async () => false),
    // Permissive default for bug #4's quotation FK gate — the "happy path"
    // route tests below don't set up a real pre_tenders row, so treat any
    // tenderId as valid by default; a dedicated test overrides this to
    // prove the 404 rejection path.
    tenderOrPreTenderExists: vi.fn(async () => true),
  };
});

// Bug #4: award creation validates the cited contractor against a real
// works.contractors record. Permissive default (matches whatever name is
// queried) so the existing "happy path" award tests don't need a real
// contractor row; a dedicated test overrides this for the rejection path.
vi.mock("../src/modules/contractor/repo.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/modules/contractor/repo.js")>();
  return {
    ...orig,
    findContractorById: vi.fn(async (_t: string, id: string) => ({ id, name: "Test Contractor", active: true })),
    findContractorByName: vi.fn(async (_t: string, name: string) => ({ id: "00000000-cccc-4000-8000-000000000001", name, active: true })),
  };
});

// BR-013 gate (boq/routes.ts POST /v1/works/boq): permissive default so the
// existing "happy path" BoQ create test doesn't need a real finalized TS
// row; a dedicated test overrides this for the rejection path.
vi.mock("../src/modules/approval/repo.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/modules/approval/repo.js")>();
  return { ...orig, hasFinalizedTsForWork: vi.fn(async () => true) };
});

// Bug #3 execution gate (execution/routes.ts POST /v1/works/execution/progress):
// permissive default work scope with no target (so the target-cap check is
// skipped) — a dedicated test overrides this for the rejection path.
vi.mock("../src/modules/execution/repo.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/modules/execution/repo.js")>();
  return {
    ...orig,
    getWorkScope: vi.fn(async (_t: string, id: string) => ({ id, targetValue: null })),
  };
});

vi.mock("@civitasone/queue", () => ({
  createQueue: () => ({
    publish: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  }),
  MemoryQueue: class {
    publish = vi.fn().mockResolvedValue(undefined);
    subscribe = vi.fn();
    start = vi.fn();
    stop = vi.fn();
  },
}));

vi.mock("@civitasone/observability", () => ({
  registerOpsRoutes: vi.fn(),
  dbPing: vi.fn(),
}));

vi.mock("@civitasone/outbox", () => ({
  outboxMessages: { _: { name: "messages" } },
  processed: { _: { name: "processed" } },
  outboxSchema: {},
  enqueue: vi.fn(),
  markProcessed: vi.fn().mockResolvedValue(true),
  startRelay: vi.fn(() => setInterval(() => {}, 999999)),
}));

vi.mock("@civitasone/schemas/plugin", () => ({
  registerSchemaErrorHandler: (app: any, HttpError: any) => {
    app.setErrorHandler((err: any, _req: any, reply: any) => {
      if (err instanceof HttpError) {
        return reply.status(err.status).send({ error: { code: err.code, message: err.message } });
      }
      // Zod validation errors
      if (err.name === "ZodError" || err.issues) {
        return reply.status(400).send({ error: { code: "VALIDATION_ERROR", message: err.message } });
      }
      if (err.validation || err.statusCode === 400) {
        return reply.status(400).send({ error: { code: "VALIDATION_ERROR", message: err.message } });
      }
      return reply.status(500).send({ error: { code: "INTERNAL", message: "internal error" } });
    });
  },
}));

vi.mock("@civitasone/auth/plugin", () => ({
  authPlugin: Object.assign(async (app: any) => {
    app.decorateRequest("ctx", undefined);
    app.addHook("onRequest", async (req: any) => {
      const auth = req.headers?.authorization;
      if (!auth) return;
      try {
        const tokenStr = auth.replace("Bearer ", "");
        const [, body] = tokenStr.split(".");
        const payload = JSON.parse(Buffer.from(body, "base64url").toString());
        if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return;
        (req as any).ctx = {
          tenantId: payload.tid,
          actorId: payload.sub,
          roles: payload.roles || [],
          correlationId: req.id || "c",
          sessionId: "s",
          actorType: "user",
        };
      } catch { /* token parse failed — leave ctx null */ }
    });
  }, { [Symbol.for("skip-override")]: true, [Symbol.for("fastify.display-name")]: "civitasone-auth" }),
}));

vi.mock("@civitasone/auth/context", () => {
  class AuthContextError extends Error {
    status: number; code: string;
    constructor(s: number, c: string, m: string) { super(m); this.status = s; this.code = c; }
  }
  return {
    resolveServiceContext: (req: any) => {
      if (!req.ctx) throw new AuthContextError(401, "UNAUTHENTICATED", "missing token");
      return req.ctx;
    },
    AuthContextError,
  };
});

vi.mock("@civitasone/auth", () => ({
  signToken: (payload: any, _secret: string, exp: number) => {
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + exp })).toString("base64url");
    const sig = Buffer.from("test-sig").toString("base64url");
    return `${header}.${body}.${sig}`;
  },
  hasAnyRole: (ctx: any, roles: string[]) => roles.some((r: string) => ctx.roles?.includes(r)),
}));

const SECRET = "test_secret_for_civitasone_32chr";
const ACTOR = "00000000-aaaa-4000-8000-000000000001";
const TENANT = "11111111-bbbb-4000-8000-000000000001";

function token(roles: string[] = ["works_admin", "super_admin"]): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify({ sub: ACTOR, tid: TENANT, roles, exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
  const sig = Buffer.from("test-sig").toString("base64url");
  return `${header}.${body}.${sig}`;
}
function authHeader(roles?: string[]) {
  return { authorization: `Bearer ${token(roles)}` };
}

// Controllable MB/bill lookups for the canCreateBill 409-gate test below —
// the generic @civitasone/db mock above always resolves selects to `[]`,
// which can't express "an MB exists in a given status". workId/awardId are
// optional so pre-existing fixtures (that only cared about `status`) still
// type-check; the bug #1/#2 mb-belongs-to-bill tests set them explicitly.
const mbById: Record<string, { status: string; workId?: string; awardId?: string } | undefined> = {};
const billById: Record<string, { status: string } | undefined> = {};
vi.mock("../src/modules/billing/repo.js", () => ({
  getMb: vi.fn(async (_tenantId: string, id: string) => mbById[id] ?? null),
  getBill: vi.fn(async (_tenantId: string, id: string) => billById[id] ?? null),
  listBillsForWork: vi.fn(async () => []),
  // No measurements seeded by default — routes' measured-value gate then
  // requires grossAmountMinor "0" in tests that don't care about that
  // specific check (covered separately in orphan-consumers.test.ts).
  listMeasurementsByMb: vi.fn(async () => []),
  listMeasurementsByBoqItem: vi.fn(async () => []),
  // Code-review fix (double-billing gap): no prior bills against any MB by
  // default — the specific double-billing repro is covered in
  // orphan-consumers.test.ts, where the mock can express "MB already billed".
  listBillsByMb: vi.fn(async () => []),
}));

let app: FastifyInstance;
beforeAll(async () => {
  const { buildApp } = await import("../src/app.js");
  app = await buildApp();
});
afterAll(async () => { await app.close(); });

// ═══════════════════════════════════════════════════════════════
// MASTERS ROUTES
// ═══════════════════════════════════════════════════════════════
describe("Masters CRUD routes", () => {
  const masterPrefixes = [
    "authorities", "work-types", "work-sub-types", "proposer-types",
    "programs", "publication-levels", "repair-types", "schemes",
    "scopes", "tender-types", "user-departments", "contractor-classes",
    "issue-types", "issue-description-types", "assets",
    "work-description-types", "sr-items",
  ];

  for (const prefix of masterPrefixes) {
    it(`GET /v1/works/masters/${prefix} → 401 no token`, async () => {
      const res = await app.inject({ method: "GET", url: `/v1/works/masters/${prefix}` });
      expect(res.statusCode).toBe(401);
    });

    it(`GET /v1/works/masters/${prefix} → 403 wrong role`, async () => {
      const res = await app.inject({ method: "GET", url: `/v1/works/masters/${prefix}`, headers: authHeader(["citizen"]) });
      expect(res.statusCode).toBe(403);
    });

    it(`GET /v1/works/masters/${prefix} → not 401/403 with valid role`, async () => {
      const res = await app.inject({ method: "GET", url: `/v1/works/masters/${prefix}`, headers: authHeader() });
      // Auth passed — should not be 401 or 403; may be 200 or 500 depending on DB mock
      expect([200, 500]).toContain(res.statusCode);
    });

    it(`POST /v1/works/masters/${prefix} → 401 no token`, async () => {
      const res = await app.inject({ method: "POST", url: `/v1/works/masters/${prefix}`, payload: { name: "Test" } });
      expect(res.statusCode).toBe(401);
    });

    it(`POST /v1/works/masters/${prefix} → 403 viewer role`, async () => {
      const res = await app.inject({ method: "POST", url: `/v1/works/masters/${prefix}`, headers: authHeader(["works_viewer"]), payload: { name: "T" } });
      expect(res.statusCode).toBe(403);
    });
  }

  it("POST /v1/works/masters/authorities → 202 with valid body", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/works/masters/authorities", headers: authHeader(),
      payload: { name: "Test Authority", code: "TA01" },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().id).toBeDefined();
  });

  it("POST /v1/works/masters/authorities → 400 missing required fields", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/works/masters/authorities", headers: authHeader(),
      payload: {},
    });
    expect([400, 500]).toContain(res.statusCode);
  });

  it("GET /v1/works/masters/authorities/:id → 404 non-existent", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/works/masters/authorities/00000000-0000-4000-8000-000000000000",
      headers: authHeader(),
    });
    expect([404, 500]).toContain(res.statusCode);
  });
});

// ═══════════════════════════════════════════════════════════════
// PROPOSAL ROUTES
// ═══════════════════════════════════════════════════════════════
describe("Proposal routes", () => {
  it("GET /v1/works/proposals → 401 no token", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/works/proposals" });
    expect(res.statusCode).toBe(401);
  });

  it("GET /v1/works/proposals → 403 wrong role", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/works/proposals", headers: authHeader(["citizen"]) });
    expect(res.statusCode).toBe(403);
  });

  it("GET /v1/works/proposals → 200 valid", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/works/proposals", headers: authHeader() });
    expect(res.statusCode).toBe(200);
  });

  it("POST /v1/works/proposals → 202 valid body", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/works/proposals", headers: authHeader(),
      payload: {
        description: "Road repair NH-48",
        category: "regular",
        workTypeId: "00000000-1111-4000-8000-000000000001",
        estimatedCostMinor: "5000000",
      },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().id).toBeDefined();
  });

  it("POST /v1/works/proposals → 400 missing description", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/works/proposals", headers: authHeader(),
      payload: { category: "regular", workTypeId: "00000000-1111-4000-8000-000000000001", estimatedCostMinor: "5000" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/works/proposals → 400 invalid category", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/works/proposals", headers: authHeader(),
      payload: { description: "X", category: "invalid", workTypeId: "00000000-1111-4000-8000-000000000001", estimatedCostMinor: "5000" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/works/proposals/split → 202 valid", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/works/proposals/split", headers: authHeader(),
      payload: { parentWorkId: "00000000-1111-4000-8000-000000000001", description: "Split A" },
    });
    expect(res.statusCode).toBe(202);
  });

  it("POST /v1/works/proposals/split → 400 missing parentWorkId", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/works/proposals/split", headers: authHeader(),
      payload: { description: "Split A" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/works/proposals/coa → 202 valid COA", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/works/proposals/coa", headers: authHeader(),
      payload: { workId: "00000000-1111-4000-8000-000000000001", majorHead: "2059" },
    });
    expect(res.statusCode).toBe(202);
  });

  it("POST /v1/works/proposals/coa → 400 invalid majorHead", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/works/proposals/coa", headers: authHeader(),
      payload: { workId: "00000000-1111-4000-8000-000000000001", majorHead: "AB" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/works/proposals/office-mapping → 202 valid", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/works/proposals/office-mapping", headers: authHeader(),
      payload: { workId: "00000000-1111-4000-8000-000000000001", divisionId: "00000000-2222-4000-8000-000000000001" },
    });
    expect(res.statusCode).toBe(202);
  });

  it("GET /v1/works/proposals/:id → 404 not found", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/works/proposals/00000000-0000-4000-8000-000000000000",
      headers: authHeader(),
    });
    expect([404, 500]).toContain(res.statusCode);
  });
});

// ═══════════════════════════════════════════════════════════════
// APPROVAL ROUTES
// ═══════════════════════════════════════════════════════════════
describe("Approval routes", () => {
  it("POST /v1/works/approvals/aa → 401 no token", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/works/approvals/aa", payload: {} });
    expect(res.statusCode).toBe(401);
  });

  it("POST /v1/works/approvals/aa → 403 wrong role", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/works/approvals/aa",
      headers: authHeader(["works_viewer"]), payload: {},
    });
    expect(res.statusCode).toBe(403);
  });

  it("POST /v1/works/approvals/aa → 400 invalid body", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/works/approvals/aa",
      headers: authHeader(), payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/works/approvals/aa → 202 valid", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/works/approvals/aa", headers: authHeader(),
      payload: {
        workId: "00000000-1111-4000-8000-000000000001",
        aaNumber: "AA/2024/001",
        aaDate: "2024-01-15T00:00:00Z",
        approvingAuthorityId: "00000000-2222-4000-8000-000000000001",
        approvedAmountMinor: "5000000",
      },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().approvalType).toBe("original");
  });

  it("POST /v1/works/approvals/aa/:id/finalize → 404 not found", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/works/approvals/aa/00000000-0000-4000-8000-000000000000/finalize",
      headers: authHeader(), payload: {},
    });
    expect(res.statusCode).toBe(404);
  });

  it("POST /v1/works/approvals/ts → 400 invalid body", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/works/approvals/ts",
      headers: authHeader(), payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/works/approvals/ts → 404 work not found (DAO gate)", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/works/approvals/ts", headers: authHeader(),
      payload: {
        workId: "00000000-0000-4000-8000-000000000099",
        tsNumber: "TS/2024/001",
        tsDate: "2024-01-15T00:00:00Z",
        tsAuthorityId: "00000000-2222-4000-8000-000000000001",
        tsAmountMinor: "5000000",
      },
    });
    expect([404, 500]).toContain(res.statusCode);
  });

  it("POST /v1/works/approvals/ts/:id/finalize → 404 not found", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/works/approvals/ts/00000000-0000-4000-8000-000000000000/finalize",
      headers: authHeader(), payload: {},
    });
    expect(res.statusCode).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════
// BOQ ROUTES
// ═══════════════════════════════════════════════════════════════
describe("BoQ routes", () => {
  it("GET /v1/works/boq/:workId → 401 no token", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/works/boq/00000000-1111-4000-8000-000000000001" });
    expect(res.statusCode).toBe(401);
  });

  it("GET /v1/works/boq/:workId → 403 wrong role", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/works/boq/00000000-1111-4000-8000-000000000001",
      headers: authHeader(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });

  it("GET /v1/works/boq/:workId → 200 valid", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/works/boq/00000000-1111-4000-8000-000000000001",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
  });

  it("POST /v1/works/boq → 202 valid", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/works/boq", headers: authHeader(),
      payload: {
        workId: "00000000-1111-4000-8000-000000000001",
        itemDescription: "Cement Concrete M20",
        unit: "cum",
        rate: "45000",
        quantity: 10.5,
      },
    });
    expect(res.statusCode).toBe(202);
  });

  it("POST /v1/works/boq → 400 missing fields", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/works/boq", headers: authHeader(),
      payload: { workId: "00000000-1111-4000-8000-000000000001" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/works/boq/recapitulate → 202 valid", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/works/boq/recapitulate", headers: authHeader(),
      payload: {
        workId: "00000000-1111-4000-8000-000000000001",
        contingencyPercent: 3, turnoverTaxPercent: 1,
        workChargePercent: 2, qualityControlPercent: 1, centagePercent: 12.5,
      },
    });
    expect(res.statusCode).toBe(202);
  });

  it("GET /v1/works/boq/:workId/recapitulation → 404", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/works/boq/00000000-1111-4000-8000-000000000001/recapitulation",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════
// TENDER ROUTES
// ═══════════════════════════════════════════════════════════════
describe("Tender routes", () => {
  it("POST /v1/works/tenders/pre-tender → 401 no token", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/works/tenders/pre-tender", payload: {} });
    expect(res.statusCode).toBe(401);
  });

  it("POST /v1/works/tenders/pre-tender → 403 wrong role", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/works/tenders/pre-tender",
      headers: authHeader(["works_viewer"]), payload: {},
    });
    expect(res.statusCode).toBe(403);
  });

  it("POST /v1/works/tenders/pre-tender → 202 valid", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/works/tenders/pre-tender", headers: authHeader(),
      payload: { workId: "00000000-1111-4000-8000-000000000001" },
    });
    expect(res.statusCode).toBe(202);
  });

  it("POST /v1/works/tenders/quotation → 202 valid", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/works/tenders/quotation", headers: authHeader(),
      payload: {
        tenderId: "00000000-1111-4000-8000-000000000001",
        contractorName: "ABC Constructions",
        method: "item_rate",
      },
    });
    expect(res.statusCode).toBe(202);
  });

  it("POST /v1/works/tenders/quotation → 400 invalid method", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/works/tenders/quotation", headers: authHeader(),
      payload: {
        tenderId: "00000000-1111-4000-8000-000000000001",
        contractorName: "X", method: "invalid",
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/works/tenders/award → 202 valid", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/works/tenders/award", headers: authHeader(),
      payload: {
        workId: "00000000-1111-4000-8000-000000000001",
        contractorName: "XYZ Builders",
        acceptedAmountMinor: "7500000",
      },
    });
    expect(res.statusCode).toBe(202);
  });

  it("POST /v1/works/tenders/award → 400 missing contractor", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/works/tenders/award", headers: authHeader(),
      payload: { workId: "00000000-1111-4000-8000-000000000001", acceptedAmountMinor: "100" },
    });
    expect(res.statusCode).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════
// EXECUTION ROUTES
// ═══════════════════════════════════════════════════════════════
describe("Execution routes", () => {
  it("GET /v1/works/execution/:workId/scopes → 401", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/works/execution/00000000-1111-4000-8000-000000000001/scopes" });
    expect(res.statusCode).toBe(401);
  });

  it("GET /v1/works/execution/:workId/scopes → 200", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/works/execution/00000000-1111-4000-8000-000000000001/scopes",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
  });

  it("POST /v1/works/execution/scopes → 202 valid", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/works/execution/scopes", headers: authHeader(),
      payload: { workId: "00000000-1111-4000-8000-000000000001", scopeId: "00000000-2222-4000-8000-000000000001" },
    });
    expect(res.statusCode).toBe(202);
  });

  it("POST /v1/works/execution/progress → 202 valid", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/works/execution/progress", headers: authHeader(),
      payload: { workScopeId: "00000000-1111-4000-8000-000000000001", month: 6, year: 2024, currentAchievement: 25 },
    });
    expect(res.statusCode).toBe(202);
  });

  it("POST /v1/works/execution/progress → 400 invalid month", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/works/execution/progress", headers: authHeader(),
      payload: { workScopeId: "00000000-1111-4000-8000-000000000001", month: 13, year: 2024, currentAchievement: 25 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/works/execution/photos → 202 valid", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/works/execution/photos", headers: authHeader(),
      payload: { workId: "00000000-1111-4000-8000-000000000001", fileKey: "photos/2024/img001.jpg" },
    });
    expect(res.statusCode).toBe(202);
  });

  it("POST /v1/works/execution/issues → 202 valid", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/works/execution/issues", headers: authHeader(),
      payload: { workId: "00000000-1111-4000-8000-000000000001", description: "Material quality issue" },
    });
    expect(res.statusCode).toBe(202);
  });

  it("POST /v1/works/execution/close → 202 valid", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/works/execution/close", headers: authHeader(["dao", "super_admin"]),
      payload: { workId: "00000000-1111-4000-8000-000000000001", closureType: "dropped", remarks: "No fund" },
    });
    expect(res.statusCode).toBe(202);
  });

  it("POST /v1/works/execution/close → 403 section_officer cannot close", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/works/execution/close", headers: authHeader(["section_officer"]),
      payload: { workId: "00000000-1111-4000-8000-000000000001", closureType: "dropped" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("GET /v1/works/execution/:workId/issues → 200", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/works/execution/00000000-1111-4000-8000-000000000001/issues",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════
// BILLING ROUTES
// ═══════════════════════════════════════════════════════════════
describe("Billing routes", () => {
  it("GET /v1/works/billing/:workId/bills → 401", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/works/billing/00000000-1111-4000-8000-000000000001/bills" });
    expect(res.statusCode).toBe(401);
  });

  it("GET /v1/works/billing/:workId/bills → 200", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/works/billing/00000000-1111-4000-8000-000000000001/bills",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
  });

  it("POST /v1/works/billing/mb → 202 valid", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/works/billing/mb", headers: authHeader(),
      payload: {
        workId: "00000000-1111-4000-8000-000000000001",
        awardId: "00000000-2222-4000-8000-000000000001",
        mbNumber: "MB/2024/001",
      },
    });
    expect(res.statusCode).toBe(202);
  });

  it("POST /v1/works/billing/mb → 400 missing mbNumber", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/works/billing/mb", headers: authHeader(),
      payload: { workId: "00000000-1111-4000-8000-000000000001", awardId: "00000000-2222-4000-8000-000000000001" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/works/billing/mb/:id/finalize → 404 not found", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/works/billing/mb/00000000-0000-4000-8000-000000000000/finalize",
      headers: authHeader(),
      payload: { nextStatus: "so_finalized" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("POST /v1/works/billing/bills → 202 valid", async () => {
    // mbId is now required (bug #1 — no-3-way-match fix) and must resolve to
    // a do_finalized MB belonging to this work/award (bug #2 family). No
    // measurements are seeded on the shared billing/repo mock, so gross is
    // 0 here — the non-zero measured-value path is covered in
    // orphan-consumers.test.ts / works-ai-pack-gaps.test.ts.
    const mbId = "00000000-2222-4000-8000-000000000097";
    mbById[mbId] = {
      status: "do_finalized",
      workId: "00000000-1111-4000-8000-000000000001",
      awardId: "00000000-2222-4000-8000-000000000001",
    };
    const res = await app.inject({
      method: "POST", url: "/v1/works/billing/bills", headers: authHeader(),
      payload: {
        workId: "00000000-1111-4000-8000-000000000001",
        awardId: "00000000-2222-4000-8000-000000000001",
        mbId,
        billMode: "e_mb",
        billNumber: "BILL/2024/001",
        grossAmountMinor: "0",
        deductionsMinor: "0",
      },
    });
    expect(res.statusCode).toBe(202);
  });

  it("POST /v1/works/billing/bills → 400 invalid billMode", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/works/billing/bills", headers: authHeader(),
      payload: {
        workId: "00000000-1111-4000-8000-000000000001",
        awardId: "00000000-2222-4000-8000-000000000001",
        billMode: "invalid", billNumber: "B1", grossAmountMinor: "100",
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/works/billing/bills/:id/finalize → 404 not found", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/works/billing/bills/00000000-0000-4000-8000-000000000000/finalize",
      headers: authHeader(),
      payload: { nextStatus: "so_finalized" },
    });
    expect(res.statusCode).toBe(404);
  });

  // canCreateBill gate (works.md §Billing): a bill referencing an MB may only
  // be created once that MB is fully finalized (do_finalized).
  it("POST /v1/works/billing/bills → 409 when the referenced MB is not do_finalized", async () => {
    const mbId = "00000000-2222-4000-8000-000000000099";
    mbById[mbId] = { status: "draft" };
    const res = await app.inject({
      method: "POST", url: "/v1/works/billing/bills", headers: authHeader(),
      payload: {
        workId: "00000000-1111-4000-8000-000000000001",
        awardId: "00000000-2222-4000-8000-000000000001",
        mbId,
        billMode: "e_mb",
        billNumber: "BILL/2024/409",
        grossAmountMinor: "1000000",
      },
    });
    expect(res.statusCode).toBe(409);
  });

  // Bug #1 (no-3-way-match fix): mbId is no longer optional.
  it("POST /v1/works/billing/bills → 400 when mbId is missing", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/works/billing/bills", headers: authHeader(),
      payload: {
        workId: "00000000-1111-4000-8000-000000000001",
        awardId: "00000000-2222-4000-8000-000000000001",
        billMode: "abstract",
        billNumber: "BILL/2024/NOMB",
        grossAmountMinor: "100",
      },
    });
    expect(res.statusCode).toBe(400);
  });

  // Bug #2: the award-ceiling check can't be defeated by citing an
  // unrelated work's award.
  it("POST /v1/works/billing/bills → 422 when the cited award does not belong to the work", async () => {
    const mbId = "00000000-2222-4000-8000-000000000095";
    mbById[mbId] = {
      status: "do_finalized",
      workId: "00000000-1111-4000-8000-000000000077", // does not match the award below
      awardId: "00000000-2222-4000-8000-000000000001",
    };
    const res = await app.inject({
      method: "POST", url: "/v1/works/billing/bills", headers: authHeader(),
      payload: {
        // defaultAward (tender/repo mock) belongs to
        // 00000000-1111-4000-8000-000000000001, not this work.
        workId: "00000000-1111-4000-8000-000000000077",
        awardId: "00000000-2222-4000-8000-000000000001",
        mbId,
        billMode: "e_mb",
        billNumber: "BILL/2024/AWM",
        grossAmountMinor: "0",
      },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("AWARD_WORK_MISMATCH");
  });

  it("POST /v1/works/billing/bills → 404 when the referenced MB does not exist", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/works/billing/bills", headers: authHeader(),
      payload: {
        workId: "00000000-1111-4000-8000-000000000001",
        awardId: "00000000-2222-4000-8000-000000000001",
        mbId: "00000000-2222-4000-8000-000000000000",
        billMode: "e_mb",
        billNumber: "BILL/2024/410",
        grossAmountMinor: "1000000",
      },
    });
    expect(res.statusCode).toBe(404);
  });

  it("POST /v1/works/billing/bills → 202 when the referenced MB is do_finalized", async () => {
    const mbId = "00000000-2222-4000-8000-000000000098";
    mbById[mbId] = {
      status: "do_finalized",
      workId: "00000000-1111-4000-8000-000000000001",
      awardId: "00000000-2222-4000-8000-000000000001",
    };
    const res = await app.inject({
      method: "POST", url: "/v1/works/billing/bills", headers: authHeader(),
      payload: {
        workId: "00000000-1111-4000-8000-000000000001",
        awardId: "00000000-2222-4000-8000-000000000001",
        mbId,
        billMode: "e_mb",
        billNumber: "BILL/2024/202-mb",
        // No measurements seeded on the shared mock, so gross is 0 — the
        // non-zero measured-value path is covered in
        // orphan-consumers.test.ts / works-ai-pack-gaps.test.ts.
        grossAmountMinor: "0",
      },
    });
    expect(res.statusCode).toBe(202);
  });
});

// ═══════════════════════════════════════════════════════════════
// REPORTING ROUTES
// ═══════════════════════════════════════════════════════════════
describe("Reporting routes", () => {
  it("GET /v1/works/reports/summary → 200", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/works/reports/summary", headers: authHeader() });
    expect(res.statusCode).toBe(200);
  });

  it("GET /v1/works/reports/status → 200", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/works/reports/status", headers: authHeader() });
    expect(res.statusCode).toBe(200);
  });

  it("GET /v1/works/reports/summary → 401 no auth", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/works/reports/summary" });
    expect(res.statusCode).toBe(401);
  });

  it("GET /v1/works/reports/summary → 403 wrong role", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/works/reports/summary", headers: authHeader(["citizen"]) });
    expect(res.statusCode).toBe(403);
  });
});
