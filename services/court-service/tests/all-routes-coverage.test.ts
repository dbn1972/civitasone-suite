/**
 * Court Service — All Routes Coverage Test
 *
 * Comprehensive route inject tests for all court-service modules.
 * Uses in-memory Fastify injection (no network, no real DB).
 *
 * Tests: caseRegistry, courtRegistry, caseLifecycle, hearing, filing, order,
 * causeList, scrutiny, notice, compliance, appeal, party, evidence,
 * orderIssuance, config, certifiedCopy, parcel, publicLookup, courtDocuments
 */
import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { signToken } from "@civitasone/auth";

const JWT_SECRET = "test_secret_for_civitasone_32chr";
const TENANT_ID = "aaaaaaaa-1111-4000-8000-000000000099";
const ACTOR_ID = "11111111-1111-1111-1111-111111111111";
const CASE_ID = "22222222-2222-2222-2222-222222222222";
const COURT_ID = "33333333-3333-3333-3333-333333333333";
const HEARING_ID = "44444444-4444-4444-4444-444444444444";
const ORDER_ID = "55555555-5555-5555-5555-555555555555";
const APPEAL_ID = "66666666-6666-6666-6666-666666666666";
const NOTICE_ID = "77777777-7777-7777-7777-777777777777";
const PARCEL_ID = "88888888-8888-8888-8888-888888888888";
const COPY_ID = "99999999-9999-9999-9999-999999999999";
const CONFIG_ID = "aabbccdd-1111-4000-8000-000000000001";
const EVIDENCE_ID = "aabbccdd-2222-4000-8000-000000000002";
const COMPLIANCE_ID = "aabbccdd-3333-4000-8000-000000000003";
const SCRUTINY_ID = "aabbccdd-4444-4000-8000-000000000004";
const BENCH_ID = "aabbccdd-5555-4000-8000-000000000005";
const CAUSELIST_ID = "aabbccdd-6666-4000-8000-000000000006";

// ─── Shared mock state (hoisted for vi.mock references) ──────────
const mockState = vi.hoisted(() => ({
  queryResult: [] as Record<string, unknown>[],
  countResult: 0,
  insertResult: null as Record<string, unknown> | null,
  updateResult: null as Record<string, unknown> | null,
}));

// ─── DB Mock — simple fluent chain ───────────────────────────────
vi.mock("../src/shared/db.js", () => {
  function chain(data: unknown[]) {
    const c: Record<string, unknown> = {};
    c.from = () => c;
    c.where = () => c;
    c.orderBy = () => c;
    c.groupBy = () => [];
    c.limit = (n: number) => {
      const sliced = (data as unknown[]).slice(0, n);
      return Object.assign(sliced, { offset: () => sliced });
    };
    c.offset = () => data;
    return c;
  }
  function select(fields?: Record<string, unknown>) {
    if (fields && Object.keys(fields).some((k) => k === "count")) {
      return { from: () => ({ where: () => [{ count: mockState.countResult }] }) };
    }
    return chain(mockState.queryResult);
  }
  function insert() {
    return { values: () => ({ returning: () => [mockState.insertResult ?? { id: "new-id" }] }) };
  }
  function update() {
    return { set: () => ({ where: () => ({ returning: () => [mockState.updateResult ?? { id: "updated" }] }) }) };
  }
  return {
    db: { select, insert, update, transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({ select, insert, update }) },
    sqlClient: {},
    scopedRead: async (fn: (tx: unknown) => Promise<unknown>) => fn({ select, insert, update }),
  };
});

vi.mock("../src/shared/infra.js", () => ({
  cache: {
    getOrLoad: async <T>(_k: string, loader: () => Promise<T>) => loader(),
    put: async () => {},
    invalidate: async () => {},
    invalidateAfterCommit: async () => {},
    makeKey: (...args: string[]) => args.join(":"),
  },
  queue: { publish: async () => {} },
}));
vi.mock("../src/shared/outbox.js", () => ({ enqueue: async () => {}, markProcessed: async () => {} }));
vi.mock("../src/shared/pii-crypto.js", async () => {
  // encryptedText is a Drizzle customType factory — at schema definition time
  // it is called like `encryptedText("column_name")` and returns a column builder.
  // We proxy it to a plain `text()` column equivalent so schema imports don't crash.
  const { text } = await import("drizzle-orm/pg-core");
  return {
    assertPiiKeyConfigured: () => {},
    encryptPii: (v: string) => `enc:${v}`,
    decryptPii: (v: string) => v.replace(/^enc:/, ""),
    maskEmail: (v: string | null) => (v ? `${v[0]}***@masked` : null),
    maskPhone: (v: string | null) => (v ? `****${v.slice(-4)}` : null),
    blindIndex: (v: string) => `blind:${v}`,
    encryptedText: (name: string) => text(name),
  };
});

vi.mock("@civitasone/auth/plugin", () => ({
  authPlugin: async (app: FastifyInstance) => {
    app.decorateRequest("user", null);
    app.addHook("onRequest", async (req) => {
      if ((req.routeOptions as any)?.config?.public === true) return;
      const authHeader = req.headers.authorization;
      if (!authHeader) return;
      const token = authHeader.replace("Bearer ", "");
      try {
        const [, payload] = token.split(".");
        const decoded = JSON.parse(Buffer.from(payload!, "base64url").toString());
        (req as any).user = decoded;
      } catch { /* no-op */ }
    });
  },
}));

vi.mock("@civitasone/auth/context", () => {
  class AuthContextError extends Error { status: number; code: string; constructor(s: number, c: string, m: string) { super(m); this.status = s; this.code = c; } }
  return {
    resolveServiceContext: (req: { headers: { authorization?: string } }) => {
      if (!req.headers.authorization) throw new AuthContextError(401, "UNAUTHORIZED", "unauthorized");
      const token = req.headers.authorization.replace("Bearer ", "");
      const [, payload] = token.split(".");
      const decoded = JSON.parse(Buffer.from(payload!, "base64url").toString());
      return { tenantId: decoded.tid, actorId: decoded.sub, roles: decoded.roles ?? [], sessionId: decoded.sid ?? "s" };
    },
    AuthContextError,
  };
});

vi.mock("@civitasone/auth", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@civitasone/auth")>();
  return {
    ...orig,
    hasAnyRole: (ctx: { roles: string[] }, required: string[]) => required.some((r) => ctx.roles.includes(r)),
  };
});

// ─── Repo mocks for routes that use real Drizzle queries ─────────
// These repos use cache.getOrLoad + scopedRead + Drizzle operators which
// don't work with our simple fluent chain mock. Mock them to return from mockState.

vi.mock("../src/modules/case-registry/repo.js", () => ({
  listCases: async () => mockState.queryResult,
  getCaseById: async () => mockState.queryResult[0] ?? null,
  // A spy (not a bare arrow) so tests can assert the tenant-scoping args the
  // route passes — regression guard for the tenantId filter fix.
  getCasePartiesByCaseId: vi.fn(async () => mockState.queryResult),
  listOverdueCases: async () => mockState.queryResult,
  caseAnalytics: async () => mockState.queryResult[0] ?? { instituted: 0, disposed: 0, pending: 0 },
  pendencySummary: async () => mockState.queryResult,
}));

vi.mock("../src/modules/court-registry/repo.js", () => ({
  listCourts: async () => mockState.queryResult,
  getCourtById: async () => mockState.queryResult[0] ?? undefined,
  listBenchesByCourt: async () => mockState.queryResult,
  insertCourt: async () => {},
  insertBench: async () => {},
}));

vi.mock("../src/modules/hearing/repo.js", () => ({
  listHearingsByCase: async () => mockState.queryResult,
}));

vi.mock("../src/modules/filing/repo.js", () => ({
  listFilingsByCase: async () => mockState.queryResult,
}));

vi.mock("../src/modules/order/repo.js", () => ({
  listOrdersByCase: async () => mockState.queryResult,
  getOrderById: async () => mockState.queryResult[0] ?? undefined,
}));

vi.mock("../src/modules/cause-list/repo.js", () => ({
  listItems: async () => mockState.queryResult,
  getCauseList: async () => mockState.queryResult[0] ?? undefined,
}));

vi.mock("../src/modules/scrutiny/repo.js", () => ({
  listDefectsByCase: async () => mockState.queryResult,
}));

vi.mock("../src/modules/notice/repo.js", () => ({
  listNoticesByCase: async () => mockState.queryResult,
  listServiceByNotice: async () => mockState.queryResult,
}));

vi.mock("../src/modules/compliance/repo.js", () => ({
  listByCase: async () => mockState.queryResult,
}));

vi.mock("../src/modules/appeal/repo.js", () => ({
  listAppealsByCase: async () => mockState.queryResult,
  getAppeal: async () => mockState.queryResult[0] ?? undefined,
}));

vi.mock("../src/modules/party/repo.js", () => ({
  listPartiesByCase: async () => mockState.queryResult,
}));

vi.mock("../src/modules/evidence/repo.js", () => ({
  listByCase: async () => mockState.queryResult,
}));

vi.mock("../src/modules/certified-copy/repo.js", () => ({
  listCopiesByCase: async () => mockState.queryResult,
  getCopy: async () => mockState.queryResult[0] ?? undefined,
}));

vi.mock("../src/modules/case-parcel/repo.js", () => ({
  listParcelsByCase: async () => mockState.queryResult,
  searchBySurvey: async () => mockState.queryResult,
}));

vi.mock("../src/modules/config-registry/repo.js", () => ({
  listByNamespace: async () => mockState.queryResult,
  getConfig: async () => mockState.queryResult[0] ?? undefined,
  listActiveKeys: async () => [],
  getConfigValueOnTx: async () => undefined,
}));

vi.mock("../src/modules/public-lookup/repo.js", () => ({
  listActiveEstablishments: async () => mockState.queryResult,
  findEstablishmentBySlug: async () => mockState.queryResult[0] ?? undefined,
  findEstablishmentByPrefix: async () => mockState.queryResult[0] ?? undefined,
  countRecentChallenges: async () => 0,
  countRecentByIpHash: async () => 0,
  insertChallenge: async () => {},
  getChallenge: async () => undefined,
  claimAttempt: async () => undefined,
  consumeChallenge: async () => true,
  getPublicCaseByCnr: async () => mockState.queryResult[0] ?? undefined,
}));

vi.mock("../src/modules/court-documents/render.js", () => ({
  renderCauseListPdf: async () => new Uint8Array([37, 80, 68, 70]),
  renderOrderPdf: async () => new Uint8Array([37, 80, 68, 70]),
  renderCertifiedCopyPdf: async () => new Uint8Array([37, 80, 68, 70]),
}));

vi.mock("../src/modules/config-registry/presets.js", () => ({
  applyPreset: async () => ({ applied: true }),
}));

// ─── Command mocks — all commands publish to queue, we just mock them ───────
vi.mock("../src/modules/case-registry/commands.js", () => ({
  registerCase: async () => ({ id: "new-case-id", accepted: true }),
}));

vi.mock("../src/modules/court-registry/commands.js", () => ({
  createCourt: async () => ({ id: "new-court-id", accepted: true }),
  createBench: async () => ({ id: "new-bench-id", accepted: true }),
}));

vi.mock("../src/modules/case-lifecycle/commands.js", () => ({
  updateCaseStatus: async () => ({ accepted: true }),
}));

vi.mock("../src/modules/hearing/commands.js", () => ({
  scheduleHearing: async () => ({ id: "new-hearing-id", accepted: true }),
  adjournHearing: async () => ({ accepted: true }),
  recordHearingOutcome: async () => ({ accepted: true }),
}));

vi.mock("../src/modules/filing/commands.js", () => ({
  submitFiling: async () => ({ id: "new-filing-id", accepted: true }),
}));

vi.mock("../src/modules/order/commands.js", () => ({
  recordOrder: async () => ({ id: "new-order-id", accepted: true }),
}));

vi.mock("../src/modules/cause-list/commands.js", () => ({
  createCauseList: async () => ({ id: "new-causelist-id", accepted: true }),
  listCaseOnCauseList: async () => ({ accepted: true }),
}));

vi.mock("../src/modules/scrutiny/commands.js", () => ({
  recordScrutiny: async () => ({ accepted: true }),
  raiseDefect: async () => ({ accepted: true }),
  resolveScrutiny: async () => ({ accepted: true }),
  resolveDefect: async () => ({ accepted: true }),
}));

vi.mock("../src/modules/notice/commands.js", () => ({
  issueNotice: async () => ({ id: "new-notice-id", accepted: true }),
  recordService: async () => ({ accepted: true }),
  updateNoticeStatus: async () => ({ accepted: true }),
}));

vi.mock("../src/modules/compliance/commands.js", () => ({
  createDirection: async () => ({ id: "new-direction-id", accepted: true }),
  updateCompliance: async () => ({ accepted: true }),
}));

vi.mock("../src/modules/appeal/commands.js", () => ({
  fileAppeal: async () => ({ id: "new-appeal-id", accepted: true }),
  registerAppeal: async () => ({ accepted: true }),
  decideAppeal: async () => ({ accepted: true }),
  withdrawAppeal: async () => ({ accepted: true }),
}));

vi.mock("../src/modules/party/commands.js", () => ({
  addParty: async () => ({ id: "new-party-id", accepted: true }),
  updateAdvocate: async () => ({ accepted: true }),
}));

vi.mock("../src/modules/evidence/commands.js", () => ({
  submitEvidence: async () => ({ id: "new-evidence-id", accepted: true }),
  ruleOnEvidence: async () => ({ accepted: true }),
}));

vi.mock("../src/modules/order-issuance/commands.js", () => ({
  submitForApproval: async () => ({ accepted: true }),
  approveAndIssue: async () => ({ accepted: true }),
  sendBack: async () => ({ accepted: true }),
  recall: async () => ({ accepted: true }),
}));

vi.mock("../src/modules/config-registry/commands.js", () => ({
  setConfig: async () => ({ id: "new-config-id", accepted: true }),
  deactivateConfig: async () => ({ accepted: true }),
}));

vi.mock("../src/modules/certified-copy/commands.js", () => ({
  requestCopy: async () => ({ id: "new-copy-id", accepted: true }),
  transitionCopy: async () => ({ accepted: true }),
}));

vi.mock("../src/modules/case-parcel/commands.js", () => ({
  addParcel: async () => ({ id: "new-parcel-id", accepted: true }),
  updateParcel: async () => ({ accepted: true }),
}));

vi.mock("../src/modules/public-lookup/commands.js", () => ({
  publishEstablishment: async () => ({ accepted: true }),
}));

vi.mock("../src/topics.js", () => ({
  COMMANDS: {},
  EVENTS: { notificationSend: "notification.send", caseRegistered: "court.case.registered" },
  CONSUMED_EVENTS: {},
}));

vi.mock("@civitasone/db", () => ({
  createSqlClient: () => ({}),
  createTenantTxHook: () => async () => {},
  tenantStorage: { enterWith: () => {} },
  runWithTenant: async (_tid: string, fn: () => Promise<unknown>) => fn(),
}));
vi.mock("@civitasone/observability", () => ({ registerOpsRoutes: () => {}, dbPing: async () => true }));
vi.mock("@civitasone/schemas/plugin", () => ({ registerSchemaErrorHandler: () => {} }));
vi.mock("@fastify/cors", () => ({ default: async () => {} }));

// ─── Token helpers ────────────────────────────────────────────────
function makeToken(roles: string[] = ["super_admin"]): string {
  return signToken({ sub: ACTOR_ID, tid: TENANT_ID, roles, sid: "sess-1" }, JWT_SECRET, 3600);
}
const ADMIN_TOKEN = () => makeToken(["super_admin"]);
const REGISTRAR_TOKEN = () => makeToken(["registrar"]);
const NO_ROLE_TOKEN = () => makeToken(["employee"]);

// ─── Seed data templates ─────────────────────────────────────────
const SEED_CASE = {
  id: CASE_ID,
  tenantId: TENANT_ID,
  cnrNumber: "DLHC010001234202",
  caseType: "civil",
  filingNumber: "F-2026-01",
  filingDate: "2026-07-01",
  title: "Rao v. State",
  courtId: COURT_ID,
  benchId: BENCH_ID,
  status: "filed",
  createdAt: new Date("2026-07-01"),
  updatedAt: new Date("2026-07-01"),
};

const SEED_COURT = {
  id: COURT_ID,
  tenantId: TENANT_ID,
  name: "Delhi High Court",
  courtType: "high_court",
  jurisdiction: "Delhi",
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
};

const SEED_HEARING = {
  id: HEARING_ID,
  tenantId: TENANT_ID,
  caseId: CASE_ID,
  benchId: BENCH_ID,
  scheduledAt: "2026-08-01T10:00:00Z",
  purpose: "arguments",
  status: "scheduled",
  version: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const SEED_ORDER = {
  id: ORDER_ID,
  tenantId: TENANT_ID,
  caseId: CASE_ID,
  orderType: "interim",
  orderDate: "2026-08-15",
  orderText: "Stay granted",
  status: "draft",
  signedBy: null,
  dscSignature: null,
  version: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const SEED_APPEAL = {
  id: APPEAL_ID,
  tenantId: TENANT_ID,
  originalCaseId: CASE_ID,
  appealType: "appeal",
  grounds: "Error in law",
  filedDate: "2026-09-01",
  status: "filed",
  version: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
};


// ═══════════════════════════════════════════════════════════════════
// 1. Case Registry Routes
// ═══════════════════════════════════════════════════════════════════
describe("Case Registry Routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { caseRegistryRoutes } = await import("../src/modules/case-registry/routes.js");
    app = Fastify({ logger: false });
    const { authPlugin } = await import("@civitasone/auth/plugin");
    await app.register(authPlugin);
    await app.register(caseRegistryRoutes);
    await app.ready();
  });
  afterAll(async () => { await app.close(); });

  beforeEach(() => {
    mockState.queryResult = [SEED_CASE];
    mockState.countResult = 1;
    mockState.insertResult = SEED_CASE;
  });

  describe("GET /v1/court/cases", () => {
    it("returns list for authorized user", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/court/cases", headers: { authorization: `Bearer ${ADMIN_TOKEN()}` } });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.items).toBeDefined();
    });

    it("returns 401 without auth", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/court/cases" });
      expect(res.statusCode).toBe(401);
    });

    it("returns 403 for insufficient role", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/court/cases", headers: { authorization: `Bearer ${NO_ROLE_TOKEN()}` } });
      expect(res.statusCode).toBe(403);
    });
  });

  describe("GET /v1/court/cases/:id", () => {
    it("returns case when found", async () => {
      const res = await app.inject({ method: "GET", url: `/v1/court/cases/${CASE_ID}`, headers: { authorization: `Bearer ${ADMIN_TOKEN()}` } });
      expect(res.statusCode).toBe(200);
    });

    it("scopes the parties lookup to the caller's tenant (tenantId filter regression guard)", async () => {
      const { getCasePartiesByCaseId } = await import("../src/modules/case-registry/repo.js");
      (getCasePartiesByCaseId as ReturnType<typeof vi.fn>).mockClear();
      const res = await app.inject({ method: "GET", url: `/v1/court/cases/${CASE_ID}`, headers: { authorization: `Bearer ${ADMIN_TOKEN()}` } });
      expect(res.statusCode).toBe(200);
      expect(getCasePartiesByCaseId).toHaveBeenCalledWith(TENANT_ID, CASE_ID);
    });

    it("masks party PII for a registrar but reveals it for super_admin (DPDP regression guard)", async () => {
      // This is the exact bug PR #794 fixed: GET /cases/:id used to embed
      // parties straight from the DB row with NO role-based masking at all,
      // while the dedicated GET /cases/:id/parties endpoint (party module,
      // see below) already masked correctly. Both must now agree.
      const { getCasePartiesByCaseId } = await import("../src/modules/case-registry/repo.js");
      const partyRow = {
        id: "party-1",
        caseId: CASE_ID,
        partyRole: "petitioner",
        nameEnc: "Ramesh Kumar Sharma",
        addressEnc: "12 MG Road, Lucknow",
        phoneEnc: "9876543210",
        emailEnc: "ramesh@example.com",
        advocateName: "Adv. Priya Singh",
        advocateBarId: "UP/1234/2010",
        version: 1,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      };
      (getCasePartiesByCaseId as ReturnType<typeof vi.fn>).mockResolvedValueOnce([partyRow]);

      const registrarRes = await app.inject({ method: "GET", url: `/v1/court/cases/${CASE_ID}`, headers: { authorization: `Bearer ${REGISTRAR_TOKEN()}` } });
      expect(registrarRes.statusCode).toBe(200);
      const registrarBody = registrarRes.json();
      expect(registrarBody.piiRevealed).toBe(false);
      expect(registrarBody.parties[0].name).toBeNull();
      expect(registrarBody.parties[0].address).toBeNull();
      expect(registrarBody.parties[0].phone).not.toBe("9876543210");
      expect(registrarBody.parties[0].email).not.toBe("ramesh@example.com");
      // Raw encrypted-column field names must never reach the wire.
      expect(registrarBody.parties[0].nameEnc).toBeUndefined();

      (getCasePartiesByCaseId as ReturnType<typeof vi.fn>).mockResolvedValueOnce([partyRow]);
      const adminRes = await app.inject({ method: "GET", url: `/v1/court/cases/${CASE_ID}`, headers: { authorization: `Bearer ${ADMIN_TOKEN()}` } });
      expect(adminRes.statusCode).toBe(200);
      const adminBody = adminRes.json();
      expect(adminBody.piiRevealed).toBe(true);
      expect(adminBody.parties[0].name).toBe("Ramesh Kumar Sharma");
      expect(adminBody.parties[0].phone).toBe("9876543210");
    });

    it("returns 404 when not found", async () => {
      mockState.queryResult = [];
      const res = await app.inject({ method: "GET", url: `/v1/court/cases/${CASE_ID}`, headers: { authorization: `Bearer ${ADMIN_TOKEN()}` } });
      expect(res.statusCode).toBe(404);
    });

    it("returns 400 for invalid UUID", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/court/cases/not-a-uuid", headers: { authorization: `Bearer ${ADMIN_TOKEN()}` } });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("GET /v1/court/cases/overdue", () => {
    it("returns overdue cases", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/court/cases/overdue", headers: { authorization: `Bearer ${ADMIN_TOKEN()}` } });
      expect(res.statusCode).toBe(200);
      expect(res.json().items).toBeDefined();
    });
  });

  describe("GET /v1/court/cases/analytics", () => {
    it("returns analytics data", async () => {
      mockState.queryResult = [{ instituted: 10, disposed: 5, pending: 5 }];
      const res = await app.inject({ method: "GET", url: "/v1/court/cases/analytics", headers: { authorization: `Bearer ${ADMIN_TOKEN()}` } });
      expect(res.statusCode).toBe(200);
    });
  });

  describe("GET /v1/court/cases/pendency", () => {
    it("returns pendency summary", async () => {
      mockState.queryResult = [{ status: "filed", count: 3 }];
      const res = await app.inject({ method: "GET", url: "/v1/court/cases/pendency", headers: { authorization: `Bearer ${ADMIN_TOKEN()}` } });
      expect(res.statusCode).toBe(200);
    });
  });

  describe("POST /v1/court/cases", () => {
    it("returns 401 without token", async () => {
      const res = await app.inject({ method: "POST", url: "/v1/court/cases", payload: {} });
      expect(res.statusCode).toBe(401);
    });

    it("returns 403 for insufficient role", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/court/cases",
        headers: { authorization: `Bearer ${NO_ROLE_TOKEN()}` },
        payload: { cnrNumber: "X", caseType: "civil", filingDate: "2026-07-01", title: "Test", courtId: COURT_ID, parties: [{ partyRole: "petitioner", name: "A" }] },
      });
      expect(res.statusCode).toBe(403);
    });

    it("returns 202 for valid body", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/court/cases",
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: { cnrNumber: "DLHC010001234202", caseType: "civil", filingDate: "2026-07-01", title: "Rao v. State", courtId: COURT_ID, parties: [{ partyRole: "petitioner", name: "A. Rao" }] },
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 400 for missing required fields", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/court/cases",
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: { caseType: "civil" },
      });
      expect(res.statusCode).toBe(400);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. Court Registry Routes
// ═══════════════════════════════════════════════════════════════════
describe("Court Registry Routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { courtRegistryRoutes } = await import("../src/modules/court-registry/routes.js");
    app = Fastify({ logger: false });
    const { authPlugin } = await import("@civitasone/auth/plugin");
    await app.register(authPlugin);
    await app.register(courtRegistryRoutes);
    await app.ready();
  });
  afterAll(async () => { await app.close(); });

  beforeEach(() => {
    mockState.queryResult = [SEED_COURT];
    mockState.countResult = 1;
    mockState.insertResult = SEED_COURT;
  });

  describe("GET /v1/court/courts", () => {
    it("returns courts list", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/court/courts", headers: { authorization: `Bearer ${ADMIN_TOKEN()}` } });
      expect(res.statusCode).toBe(200);
      expect(res.json().items).toBeDefined();
    });

    it("returns 401 without auth", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/court/courts" });
      expect(res.statusCode).toBe(401);
    });
  });

  describe("GET /v1/court/courts/:id", () => {
    it("returns court when found", async () => {
      const res = await app.inject({ method: "GET", url: `/v1/court/courts/${COURT_ID}`, headers: { authorization: `Bearer ${ADMIN_TOKEN()}` } });
      expect(res.statusCode).toBe(200);
    });

    it("returns 404 when not found", async () => {
      mockState.queryResult = [];
      const res = await app.inject({ method: "GET", url: `/v1/court/courts/${COURT_ID}`, headers: { authorization: `Bearer ${ADMIN_TOKEN()}` } });
      expect(res.statusCode).toBe(404);
    });

    it("returns 400 for invalid UUID", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/court/courts/bad-id", headers: { authorization: `Bearer ${ADMIN_TOKEN()}` } });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("POST /v1/court/courts", () => {
    it("returns 401 without token", async () => {
      const res = await app.inject({ method: "POST", url: "/v1/court/courts", payload: {} });
      expect(res.statusCode).toBe(401);
    });

    it("returns 202 for valid body", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/court/courts",
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: { name: "Delhi HC", courtType: "high_court", jurisdiction: "Delhi" },
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 403 for registrar (not court_admin)", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/court/courts",
        headers: { authorization: `Bearer ${REGISTRAR_TOKEN()}` },
        payload: { name: "Test", courtType: "district", jurisdiction: "Test" },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe("POST /v1/court/courts/:id/benches", () => {
    it("returns 202 for valid bench body", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/court/courts/${COURT_ID}/benches`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: { name: "Bench A", benchType: "single" },
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 401 without token", async () => {
      const res = await app.inject({ method: "POST", url: `/v1/court/courts/${COURT_ID}/benches`, payload: { name: "X" } });
      expect(res.statusCode).toBe(401);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. Case Lifecycle Routes
// ═══════════════════════════════════════════════════════════════════
describe("Case Lifecycle Routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { caseLifecycleRoutes } = await import("../src/modules/case-lifecycle/routes.js");
    app = Fastify({ logger: false });
    const { authPlugin } = await import("@civitasone/auth/plugin");
    await app.register(authPlugin);
    await app.register(caseLifecycleRoutes);
    await app.ready();
  });
  afterAll(async () => { await app.close(); });

  describe("PATCH /v1/court/cases/:id/status", () => {
    it("returns 202 for valid status update", async () => {
      const res = await app.inject({
        method: "PATCH", url: `/v1/court/cases/${CASE_ID}/status`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: { toStatus: "admitted", expectedVersion: 1 },
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 401 without token", async () => {
      const res = await app.inject({ method: "PATCH", url: `/v1/court/cases/${CASE_ID}/status`, payload: { toStatus: "admitted", expectedVersion: 1 } });
      expect(res.statusCode).toBe(401);
    });

    it("returns 403 for insufficient role", async () => {
      const res = await app.inject({
        method: "PATCH", url: `/v1/court/cases/${CASE_ID}/status`,
        headers: { authorization: `Bearer ${NO_ROLE_TOKEN()}` },
        payload: { toStatus: "admitted", expectedVersion: 1 },
      });
      expect(res.statusCode).toBe(403);
    });

    it("returns 400 for invalid UUID in param", async () => {
      const res = await app.inject({
        method: "PATCH", url: "/v1/court/cases/not-uuid/status",
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: { toStatus: "admitted", expectedVersion: 1 },
      });
      expect(res.statusCode).toBe(400);
    });
  });
});


// ═══════════════════════════════════════════════════════════════════
// 4. Hearing Routes
// ═══════════════════════════════════════════════════════════════════
describe("Hearing Routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { hearingRoutes } = await import("../src/modules/hearing/routes.js");
    app = Fastify({ logger: false });
    const { authPlugin } = await import("@civitasone/auth/plugin");
    await app.register(authPlugin);
    await app.register(hearingRoutes);
    await app.ready();
  });
  afterAll(async () => { await app.close(); });

  beforeEach(() => {
    mockState.queryResult = [SEED_HEARING];
    mockState.countResult = 1;
  });

  describe("POST /v1/court/cases/:id/hearings", () => {
    it("returns 202 for valid hearing", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/court/cases/${CASE_ID}/hearings`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: { scheduledAt: "2026-08-01T10:00:00Z", purpose: "arguments" },
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 401 without token", async () => {
      const res = await app.inject({ method: "POST", url: `/v1/court/cases/${CASE_ID}/hearings`, payload: { scheduledAt: "2026-08-01T10:00:00Z" } });
      expect(res.statusCode).toBe(401);
    });

    it("returns 403 for insufficient role", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/court/cases/${CASE_ID}/hearings`,
        headers: { authorization: `Bearer ${NO_ROLE_TOKEN()}` },
        payload: { scheduledAt: "2026-08-01T10:00:00Z" },
      });
      expect(res.statusCode).toBe(403);
    });

    it("returns 400 for invalid caseId param", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/court/cases/bad/hearings",
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: { scheduledAt: "2026-08-01T10:00:00Z" },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("GET /v1/court/cases/:id/hearings", () => {
    it("returns hearings list", async () => {
      const res = await app.inject({ method: "GET", url: `/v1/court/cases/${CASE_ID}/hearings`, headers: { authorization: `Bearer ${ADMIN_TOKEN()}` } });
      expect(res.statusCode).toBe(200);
      expect(res.json().items).toBeDefined();
    });

    it("returns 401 without auth", async () => {
      const res = await app.inject({ method: "GET", url: `/v1/court/cases/${CASE_ID}/hearings` });
      expect(res.statusCode).toBe(401);
    });
  });

  describe("PATCH /v1/court/hearings/:id/adjourn", () => {
    it("returns 202 for valid adjourn", async () => {
      const res = await app.inject({
        method: "PATCH", url: `/v1/court/hearings/${HEARING_ID}/adjourn`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: { reason: "Advocate unavailable", nextDate: "2026-08-15", expectedVersion: 1 },
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 400 for missing required fields", async () => {
      const res = await app.inject({
        method: "PATCH", url: `/v1/court/hearings/${HEARING_ID}/adjourn`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("PATCH /v1/court/hearings/:id/outcome", () => {
    it("returns 202 for valid outcome", async () => {
      const res = await app.inject({
        method: "PATCH", url: `/v1/court/hearings/${HEARING_ID}/outcome`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: { outcome: "held", expectedVersion: 1 },
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 400 for invalid outcome value", async () => {
      const res = await app.inject({
        method: "PATCH", url: `/v1/court/hearings/${HEARING_ID}/outcome`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: { outcome: "invalid", expectedVersion: 1 },
      });
      expect(res.statusCode).toBe(400);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. Filing Routes
// ═══════════════════════════════════════════════════════════════════
describe("Filing Routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { filingRoutes } = await import("../src/modules/filing/routes.js");
    app = Fastify({ logger: false });
    const { authPlugin } = await import("@civitasone/auth/plugin");
    await app.register(authPlugin);
    await app.register(filingRoutes);
    await app.ready();
  });
  afterAll(async () => { await app.close(); });

  beforeEach(() => {
    // filingFeeMinor/courtFeeMinor are BigInt PAISE columns — routes.ts's
    // serializeFiling() calls .toString() on them, so the mock row must carry
    // real bigints here (as a genuine DB row would), not omit the columns.
    mockState.queryResult = [{
      id: "f1", caseId: CASE_ID, tenantId: TENANT_ID, filingType: "written_statement",
      status: "submitted", filingFeeMinor: 500n, courtFeeMinor: 200n,
    }];
    mockState.countResult = 1;
  });

  describe("POST /v1/court/cases/:id/filings", () => {
    it("returns 202 for valid filing", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/court/cases/${CASE_ID}/filings`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: { filingType: "written_statement", filingFeeMinor: 500, courtFeeMinor: 200 },
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 401 without token", async () => {
      const res = await app.inject({ method: "POST", url: `/v1/court/cases/${CASE_ID}/filings`, payload: { filingType: "ws", filingFeeMinor: 0, courtFeeMinor: 0 } });
      expect(res.statusCode).toBe(401);
    });

    it("returns 403 for insufficient role", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/court/cases/${CASE_ID}/filings`,
        headers: { authorization: `Bearer ${NO_ROLE_TOKEN()}` },
        payload: { filingType: "written_statement", filingFeeMinor: 500, courtFeeMinor: 200 },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe("GET /v1/court/cases/:id/filings", () => {
    it("returns filings list", async () => {
      const res = await app.inject({ method: "GET", url: `/v1/court/cases/${CASE_ID}/filings`, headers: { authorization: `Bearer ${ADMIN_TOKEN()}` } });
      expect(res.statusCode).toBe(200);
      expect(res.json().items).toBeDefined();
    });

    it("returns 401 without auth", async () => {
      const res = await app.inject({ method: "GET", url: `/v1/court/cases/${CASE_ID}/filings` });
      expect(res.statusCode).toBe(401);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// 6. Order Routes
// ═══════════════════════════════════════════════════════════════════
describe("Order Routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { orderRoutes } = await import("../src/modules/order/routes.js");
    app = Fastify({ logger: false });
    const { authPlugin } = await import("@civitasone/auth/plugin");
    await app.register(authPlugin);
    await app.register(orderRoutes);
    await app.ready();
  });
  afterAll(async () => { await app.close(); });

  beforeEach(() => {
    mockState.queryResult = [SEED_ORDER];
    mockState.countResult = 1;
  });

  describe("POST /v1/court/cases/:id/orders", () => {
    it("returns 202 for valid order", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/court/cases/${CASE_ID}/orders`,
        headers: { authorization: `Bearer ${makeToken(["judge"])}` },
        payload: { orderType: "interim", orderDate: "2026-08-15", orderText: "Stay granted" },
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 401 without token", async () => {
      const res = await app.inject({ method: "POST", url: `/v1/court/cases/${CASE_ID}/orders`, payload: {} });
      expect(res.statusCode).toBe(401);
    });

    it("returns 403 for registrar (not in order write roles)", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/court/cases/${CASE_ID}/orders`,
        headers: { authorization: `Bearer ${REGISTRAR_TOKEN()}` },
        payload: { orderType: "interim", orderDate: "2026-08-15", orderText: "Test" },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe("GET /v1/court/cases/:id/orders", () => {
    it("returns orders list", async () => {
      const res = await app.inject({ method: "GET", url: `/v1/court/cases/${CASE_ID}/orders`, headers: { authorization: `Bearer ${ADMIN_TOKEN()}` } });
      expect(res.statusCode).toBe(200);
      expect(res.json().items).toBeDefined();
    });
  });

  describe("GET /v1/court/orders/:id", () => {
    it("returns order when found", async () => {
      const res = await app.inject({ method: "GET", url: `/v1/court/orders/${ORDER_ID}`, headers: { authorization: `Bearer ${ADMIN_TOKEN()}` } });
      expect(res.statusCode).toBe(200);
    });

    it("returns 404 when not found", async () => {
      mockState.queryResult = [];
      const res = await app.inject({ method: "GET", url: `/v1/court/orders/${ORDER_ID}`, headers: { authorization: `Bearer ${ADMIN_TOKEN()}` } });
      expect(res.statusCode).toBe(404);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// 7. Cause List Routes
// ═══════════════════════════════════════════════════════════════════
describe("Cause List Routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { causeListRoutes } = await import("../src/modules/cause-list/routes.js");
    app = Fastify({ logger: false });
    const { authPlugin } = await import("@civitasone/auth/plugin");
    await app.register(authPlugin);
    await app.register(causeListRoutes);
    await app.ready();
  });
  afterAll(async () => { await app.close(); });

  beforeEach(() => {
    mockState.queryResult = [{ id: CAUSELIST_ID, tenantId: TENANT_ID, courtId: COURT_ID, listDate: "2026-08-01" }];
    mockState.countResult = 1;
  });

  describe("POST /v1/court/cause-lists", () => {
    it("returns 202 for valid cause list", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/court/cause-lists",
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: { courtId: COURT_ID, listDate: "2026-08-01" },
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 401 without token", async () => {
      const res = await app.inject({ method: "POST", url: "/v1/court/cause-lists", payload: {} });
      expect(res.statusCode).toBe(401);
    });

    it("returns 403 for insufficient role", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/court/cause-lists",
        headers: { authorization: `Bearer ${NO_ROLE_TOKEN()}` },
        payload: { courtId: COURT_ID, listDate: "2026-08-01" },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe("POST /v1/court/cause-lists/:id/items", () => {
    it("returns 202 for valid item", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/court/cause-lists/${CAUSELIST_ID}/items`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: { caseId: CASE_ID, itemNumber: 1, slot: "10:00", courtroom: "Room 1" },
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 401 without token", async () => {
      const res = await app.inject({ method: "POST", url: `/v1/court/cause-lists/${CAUSELIST_ID}/items`, payload: { caseId: CASE_ID, itemNumber: 1, slot: "10:00", courtroom: "Room 1" } });
      expect(res.statusCode).toBe(401);
    });
  });

  describe("GET /v1/court/cause-lists/:id/items", () => {
    it("returns items list", async () => {
      const res = await app.inject({ method: "GET", url: `/v1/court/cause-lists/${CAUSELIST_ID}/items`, headers: { authorization: `Bearer ${ADMIN_TOKEN()}` } });
      expect(res.statusCode).toBe(200);
      expect(res.json().items).toBeDefined();
    });

    it("returns 401 without auth", async () => {
      const res = await app.inject({ method: "GET", url: `/v1/court/cause-lists/${CAUSELIST_ID}/items` });
      expect(res.statusCode).toBe(401);
    });
  });
});


// ═══════════════════════════════════════════════════════════════════
// 8. Scrutiny Routes
// ═══════════════════════════════════════════════════════════════════
describe("Scrutiny Routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { scrutinyRoutes } = await import("../src/modules/scrutiny/routes.js");
    app = Fastify({ logger: false });
    const { authPlugin } = await import("@civitasone/auth/plugin");
    await app.register(authPlugin);
    await app.register(scrutinyRoutes);
    await app.ready();
  });
  afterAll(async () => { await app.close(); });

  beforeEach(() => {
    mockState.queryResult = [{ id: SCRUTINY_ID, tenantId: TENANT_ID, caseId: CASE_ID, status: "pending" }];
    mockState.countResult = 1;
  });

  describe("POST /v1/court/cases/:id/scrutiny", () => {
    it("returns 202 for valid scrutiny", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/court/cases/${CASE_ID}/scrutiny`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: { caseId: CASE_ID, status: "cleared", remarks: "All documents in order" },
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 401 without token", async () => {
      const res = await app.inject({ method: "POST", url: `/v1/court/cases/${CASE_ID}/scrutiny`, payload: { caseId: CASE_ID } });
      expect(res.statusCode).toBe(401);
    });

    it("returns 403 for insufficient role", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/court/cases/${CASE_ID}/scrutiny`,
        headers: { authorization: `Bearer ${NO_ROLE_TOKEN()}` },
        payload: { caseId: CASE_ID },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe("POST /v1/court/cases/:id/defects", () => {
    it("returns 202 for valid defect", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/court/cases/${CASE_ID}/defects`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: { caseId: CASE_ID, category: "incomplete_documents", description: "Missing proof of address" },
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 401 without token", async () => {
      const res = await app.inject({ method: "POST", url: `/v1/court/cases/${CASE_ID}/defects`, payload: { caseId: CASE_ID, category: "x", description: "y" } });
      expect(res.statusCode).toBe(401);
    });
  });

  describe("GET /v1/court/cases/:id/defects", () => {
    it("returns defects list", async () => {
      const res = await app.inject({ method: "GET", url: `/v1/court/cases/${CASE_ID}/defects`, headers: { authorization: `Bearer ${ADMIN_TOKEN()}` } });
      expect(res.statusCode).toBe(200);
      expect(res.json().items).toBeDefined();
    });
  });

  describe("PATCH /v1/court/scrutiny/:id/resolve", () => {
    it("returns 202 for valid resolve", async () => {
      const res = await app.inject({
        method: "PATCH", url: `/v1/court/scrutiny/${SCRUTINY_ID}/resolve`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: { status: "cleared", expectedVersion: 1 },
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 401 without token", async () => {
      const res = await app.inject({ method: "PATCH", url: `/v1/court/scrutiny/${SCRUTINY_ID}/resolve`, payload: { status: "cleared", expectedVersion: 1 } });
      expect(res.statusCode).toBe(401);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// 9. Notice Routes
// ═══════════════════════════════════════════════════════════════════
describe("Notice Routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { noticeRoutes } = await import("../src/modules/notice/routes.js");
    app = Fastify({ logger: false });
    const { authPlugin } = await import("@civitasone/auth/plugin");
    await app.register(authPlugin);
    await app.register(noticeRoutes);
    await app.ready();
  });
  afterAll(async () => { await app.close(); });

  beforeEach(() => {
    mockState.queryResult = [{
      id: NOTICE_ID, tenantId: TENANT_ID, caseId: CASE_ID, noticeType: "summons",
      status: "issued", issueDate: "2026-08-01", renderedBody: "You are summoned",
      issuedTo: "John Doe", version: 1, createdAt: new Date(), updatedAt: new Date(),
    }];
    mockState.countResult = 1;
  });

  describe("POST /v1/court/cases/:id/notices", () => {
    it("returns 202 for valid notice", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/court/cases/${CASE_ID}/notices`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: { caseId: CASE_ID, noticeType: "summons", issuedTo: "John Doe", issueDate: "2026-08-01" },
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 401 without token", async () => {
      const res = await app.inject({ method: "POST", url: `/v1/court/cases/${CASE_ID}/notices`, payload: { caseId: CASE_ID, noticeType: "summons", issueDate: "2026-08-01" } });
      expect(res.statusCode).toBe(401);
    });

    it("returns 403 for insufficient role", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/court/cases/${CASE_ID}/notices`,
        headers: { authorization: `Bearer ${NO_ROLE_TOKEN()}` },
        payload: { caseId: CASE_ID, noticeType: "summons", issueDate: "2026-08-01" },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe("GET /v1/court/cases/:id/notices", () => {
    it("returns notices list with PII for privileged role", async () => {
      const res = await app.inject({ method: "GET", url: `/v1/court/cases/${CASE_ID}/notices`, headers: { authorization: `Bearer ${ADMIN_TOKEN()}` } });
      expect(res.statusCode).toBe(200);
      expect(res.json().items).toBeDefined();
      expect(res.json().piiRevealed).toBe(true);
    });

    it("returns notices list with PII redacted for non-privileged role", async () => {
      const res = await app.inject({ method: "GET", url: `/v1/court/cases/${CASE_ID}/notices`, headers: { authorization: `Bearer ${REGISTRAR_TOKEN()}` } });
      expect(res.statusCode).toBe(200);
      expect(res.json().piiRevealed).toBe(false);
    });

    it("returns 401 without auth", async () => {
      const res = await app.inject({ method: "GET", url: `/v1/court/cases/${CASE_ID}/notices` });
      expect(res.statusCode).toBe(401);
    });
  });

  describe("PATCH /v1/court/notices/:id/status", () => {
    it("returns 202 for valid status update", async () => {
      const res = await app.inject({
        method: "PATCH", url: `/v1/court/notices/${NOTICE_ID}/status`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: { status: "served", expectedVersion: 1 },
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 401 without token", async () => {
      const res = await app.inject({ method: "PATCH", url: `/v1/court/notices/${NOTICE_ID}/status`, payload: {} });
      expect(res.statusCode).toBe(401);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// 10. Compliance Routes
// ═══════════════════════════════════════════════════════════════════
describe("Compliance Routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { complianceRoutes } = await import("../src/modules/compliance/routes.js");
    app = Fastify({ logger: false });
    const { authPlugin } = await import("@civitasone/auth/plugin");
    await app.register(authPlugin);
    await app.register(complianceRoutes);
    await app.ready();
  });
  afterAll(async () => { await app.close(); });

  beforeEach(() => {
    mockState.queryResult = [{ id: COMPLIANCE_ID, tenantId: TENANT_ID, caseId: CASE_ID, direction: "file report", status: "pending", version: 1 }];
    mockState.countResult = 1;
  });

  describe("POST /v1/court/cases/:id/compliance", () => {
    it("returns 202 for valid compliance direction", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/court/cases/${CASE_ID}/compliance`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: { caseId: CASE_ID, direction: "Submit affidavit", dueDate: "2026-09-01" },
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 401 without token", async () => {
      const res = await app.inject({ method: "POST", url: `/v1/court/cases/${CASE_ID}/compliance`, payload: { caseId: CASE_ID, direction: "X" } });
      expect(res.statusCode).toBe(401);
    });

    it("returns 403 for insufficient role", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/court/cases/${CASE_ID}/compliance`,
        headers: { authorization: `Bearer ${NO_ROLE_TOKEN()}` },
        payload: { caseId: CASE_ID, direction: "Test" },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe("GET /v1/court/cases/:id/compliance", () => {
    it("returns compliance list", async () => {
      const res = await app.inject({ method: "GET", url: `/v1/court/cases/${CASE_ID}/compliance`, headers: { authorization: `Bearer ${ADMIN_TOKEN()}` } });
      expect(res.statusCode).toBe(200);
      expect(res.json().items).toBeDefined();
    });

    it("returns 401 without auth", async () => {
      const res = await app.inject({ method: "GET", url: `/v1/court/cases/${CASE_ID}/compliance` });
      expect(res.statusCode).toBe(401);
    });
  });

  describe("PATCH /v1/court/compliance/:id", () => {
    it("returns 202 for valid update", async () => {
      const res = await app.inject({
        method: "PATCH", url: `/v1/court/compliance/${COMPLIANCE_ID}`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: { status: "completed", progressNotes: "Affidavit filed", expectedVersion: 1 },
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 401 without token", async () => {
      const res = await app.inject({ method: "PATCH", url: `/v1/court/compliance/${COMPLIANCE_ID}`, payload: { status: "completed", expectedVersion: 1 } });
      expect(res.statusCode).toBe(401);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// 11. Appeal Routes
// ═══════════════════════════════════════════════════════════════════
describe("Appeal Routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { appealRoutes } = await import("../src/modules/appeal/routes.js");
    app = Fastify({ logger: false });
    const { authPlugin } = await import("@civitasone/auth/plugin");
    await app.register(authPlugin);
    await app.register(appealRoutes);
    await app.ready();
  });
  afterAll(async () => { await app.close(); });

  beforeEach(() => {
    mockState.queryResult = [SEED_APPEAL];
    mockState.countResult = 1;
    mockState.insertResult = SEED_APPEAL;
  });

  describe("POST /v1/court/appeals", () => {
    it("returns 202 for valid appeal", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/court/appeals",
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: { originalCaseId: CASE_ID, grounds: "Error in law", filedDate: "2026-09-01" },
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 401 without token", async () => {
      const res = await app.inject({ method: "POST", url: "/v1/court/appeals", payload: {} });
      expect(res.statusCode).toBe(401);
    });

    it("returns 403 for insufficient role", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/court/appeals",
        headers: { authorization: `Bearer ${NO_ROLE_TOKEN()}` },
        payload: { originalCaseId: CASE_ID, grounds: "Error", filedDate: "2026-09-01" },
      });
      expect(res.statusCode).toBe(403);
    });

    it("returns 400 for invalid body (missing grounds)", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/court/appeals",
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: { originalCaseId: CASE_ID },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("GET /v1/court/cases/:id/appeals", () => {
    it("returns appeals list", async () => {
      const res = await app.inject({ method: "GET", url: `/v1/court/cases/${CASE_ID}/appeals`, headers: { authorization: `Bearer ${ADMIN_TOKEN()}` } });
      expect(res.statusCode).toBe(200);
      expect(res.json().items).toBeDefined();
    });

    it("returns 401 without auth", async () => {
      const res = await app.inject({ method: "GET", url: `/v1/court/cases/${CASE_ID}/appeals` });
      expect(res.statusCode).toBe(401);
    });
  });

  describe("GET /v1/court/appeals/:id", () => {
    it("returns appeal when found", async () => {
      const res = await app.inject({ method: "GET", url: `/v1/court/appeals/${APPEAL_ID}`, headers: { authorization: `Bearer ${ADMIN_TOKEN()}` } });
      expect(res.statusCode).toBe(200);
    });

    it("returns 404 when not found", async () => {
      mockState.queryResult = [];
      const res = await app.inject({ method: "GET", url: `/v1/court/appeals/${APPEAL_ID}`, headers: { authorization: `Bearer ${ADMIN_TOKEN()}` } });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("PATCH /v1/court/appeals/:id/register", () => {
    it("returns 202 for valid register", async () => {
      const res = await app.inject({
        method: "PATCH", url: `/v1/court/appeals/${APPEAL_ID}/register`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: { expectedVersion: 1 },
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 401 without token", async () => {
      const res = await app.inject({ method: "PATCH", url: `/v1/court/appeals/${APPEAL_ID}/register`, payload: {} });
      expect(res.statusCode).toBe(401);
    });
  });

  describe("PATCH /v1/court/appeals/:id/decide", () => {
    it("returns 202 for valid decision", async () => {
      const res = await app.inject({
        method: "PATCH", url: `/v1/court/appeals/${APPEAL_ID}/decide`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: { decision: "allowed", decisionSummary: "Appeal has merit", decidedDate: "2026-10-01", expectedVersion: 1 },
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 400 for invalid decision enum", async () => {
      const res = await app.inject({
        method: "PATCH", url: `/v1/court/appeals/${APPEAL_ID}/decide`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: { decision: "invalid_enum", decisionSummary: "x", decidedDate: "2026-10-01", expectedVersion: 1 },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("PATCH /v1/court/appeals/:id/withdraw", () => {
    it("returns 202 for valid withdrawal", async () => {
      const res = await app.inject({
        method: "PATCH", url: `/v1/court/appeals/${APPEAL_ID}/withdraw`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: { expectedVersion: 1 },
      });
      expect(res.statusCode).toBe(202);
    });
  });
});


// ═══════════════════════════════════════════════════════════════════
// 12. Party Routes
// ═══════════════════════════════════════════════════════════════════
describe("Party Routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { partyRoutes } = await import("../src/modules/party/routes.js");
    app = Fastify({ logger: false });
    const { authPlugin } = await import("@civitasone/auth/plugin");
    await app.register(authPlugin);
    await app.register(partyRoutes);
    await app.ready();
  });
  afterAll(async () => { await app.close(); });

  beforeEach(() => {
    mockState.queryResult = [{
      id: "p1", caseId: CASE_ID, tenantId: TENANT_ID, partyRole: "petitioner",
      nameEnc: "A. Rao", addressEnc: "123 Street", phoneEnc: "9990001111", emailEnc: "rao@example.gov.in",
      advocateName: "Adv. Sharma", advocateBarId: "DEL/123", version: 1,
      createdAt: new Date(), updatedAt: new Date(),
    }];
    mockState.countResult = 1;
  });

  describe("POST /v1/court/cases/:id/parties", () => {
    it("returns 202 for valid party", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/court/cases/${CASE_ID}/parties`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: { partyRole: "respondent", name: "State of Delhi" },
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 401 without token", async () => {
      const res = await app.inject({ method: "POST", url: `/v1/court/cases/${CASE_ID}/parties`, payload: {} });
      expect(res.statusCode).toBe(401);
    });

    it("returns 403 for insufficient role", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/court/cases/${CASE_ID}/parties`,
        headers: { authorization: `Bearer ${NO_ROLE_TOKEN()}` },
        payload: { partyRole: "respondent", name: "Test" },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe("GET /v1/court/cases/:id/parties", () => {
    it("returns parties list with full PII for super_admin", async () => {
      const res = await app.inject({ method: "GET", url: `/v1/court/cases/${CASE_ID}/parties`, headers: { authorization: `Bearer ${ADMIN_TOKEN()}` } });
      expect(res.statusCode).toBe(200);
      expect(res.json().piiRevealed).toBe(true);
      expect(res.json().items[0].name).toBe("A. Rao");
    });

    it("returns parties list with masked PII for registrar", async () => {
      const res = await app.inject({ method: "GET", url: `/v1/court/cases/${CASE_ID}/parties`, headers: { authorization: `Bearer ${REGISTRAR_TOKEN()}` } });
      expect(res.statusCode).toBe(200);
      expect(res.json().piiRevealed).toBe(false);
      expect(res.json().items[0].name).toBeNull();
    });

    it("returns 401 without auth", async () => {
      const res = await app.inject({ method: "GET", url: `/v1/court/cases/${CASE_ID}/parties` });
      expect(res.statusCode).toBe(401);
    });
  });

  describe("PATCH /v1/court/parties/:id/advocate", () => {
    it("returns 202 for valid advocate update", async () => {
      const res = await app.inject({
        method: "PATCH", url: `/v1/court/parties/11111111-1111-1111-1111-111111111111/advocate`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: { advocateName: "Adv. Singh", advocateBarId: "DEL/456", expectedVersion: 1 },
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 401 without token", async () => {
      const res = await app.inject({ method: "PATCH", url: `/v1/court/parties/11111111-1111-1111-1111-111111111111/advocate`, payload: {} });
      expect(res.statusCode).toBe(401);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// 13. Evidence Routes
// ═══════════════════════════════════════════════════════════════════
describe("Evidence Routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { evidenceRoutes } = await import("../src/modules/evidence/routes.js");
    app = Fastify({ logger: false });
    const { authPlugin } = await import("@civitasone/auth/plugin");
    await app.register(authPlugin);
    await app.register(evidenceRoutes);
    await app.ready();
  });
  afterAll(async () => { await app.close(); });

  beforeEach(() => {
    mockState.queryResult = [{ id: EVIDENCE_ID, tenantId: TENANT_ID, caseId: CASE_ID, exhibitType: "document", status: "submitted", version: 1 }];
    mockState.countResult = 1;
  });

  describe("POST /v1/court/cases/:id/evidence", () => {
    it("returns 202 for valid evidence", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/court/cases/${CASE_ID}/evidence`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: { caseId: CASE_ID, title: "Lease agreement", evidenceType: "document", storageRef: "exhibits/lease.pdf" },
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 401 without token", async () => {
      const res = await app.inject({ method: "POST", url: `/v1/court/cases/${CASE_ID}/evidence`, payload: { caseId: CASE_ID, title: "X" } });
      expect(res.statusCode).toBe(401);
    });

    it("returns 403 for insufficient role", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/court/cases/${CASE_ID}/evidence`,
        headers: { authorization: `Bearer ${NO_ROLE_TOKEN()}` },
        payload: { caseId: CASE_ID, title: "Test" },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe("GET /v1/court/cases/:id/evidence", () => {
    it("returns evidence list", async () => {
      const res = await app.inject({ method: "GET", url: `/v1/court/cases/${CASE_ID}/evidence`, headers: { authorization: `Bearer ${ADMIN_TOKEN()}` } });
      expect(res.statusCode).toBe(200);
      expect(res.json().items).toBeDefined();
    });

    it("returns 401 without auth", async () => {
      const res = await app.inject({ method: "GET", url: `/v1/court/cases/${CASE_ID}/evidence` });
      expect(res.statusCode).toBe(401);
    });
  });

  describe("PATCH /v1/court/evidence/:id/rule", () => {
    it("returns 202 for valid ruling", async () => {
      const res = await app.inject({
        method: "PATCH", url: `/v1/court/evidence/${EVIDENCE_ID}/rule`,
        headers: { authorization: `Bearer ${makeToken(["judge"])}` },
        payload: { ruling: "admitted", remarks: "Relevant to the matter", expectedVersion: 1 },
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 403 for registrar (not in rule roles)", async () => {
      const res = await app.inject({
        method: "PATCH", url: `/v1/court/evidence/${EVIDENCE_ID}/rule`,
        headers: { authorization: `Bearer ${REGISTRAR_TOKEN()}` },
        payload: { ruling: "admitted", expectedVersion: 1 },
      });
      expect(res.statusCode).toBe(403);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// 14. Order Issuance Routes
// ═══════════════════════════════════════════════════════════════════
describe("Order Issuance Routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { orderIssuanceRoutes } = await import("../src/modules/order-issuance/routes.js");
    app = Fastify({ logger: false });
    const { authPlugin } = await import("@civitasone/auth/plugin");
    await app.register(authPlugin);
    await app.register(orderIssuanceRoutes);
    await app.ready();
  });
  afterAll(async () => { await app.close(); });

  describe("PATCH /v1/court/orders/:id/submit-for-approval", () => {
    it("returns 202 for valid submit", async () => {
      const res = await app.inject({
        method: "PATCH", url: `/v1/court/orders/${ORDER_ID}/submit-for-approval`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: { expectedVersion: 1 },
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 401 without token", async () => {
      const res = await app.inject({ method: "PATCH", url: `/v1/court/orders/${ORDER_ID}/submit-for-approval`, payload: {} });
      expect(res.statusCode).toBe(401);
    });

    it("returns 403 for insufficient role", async () => {
      const res = await app.inject({
        method: "PATCH", url: `/v1/court/orders/${ORDER_ID}/submit-for-approval`,
        headers: { authorization: `Bearer ${NO_ROLE_TOKEN()}` },
        payload: { expectedVersion: 1 },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe("PATCH /v1/court/orders/:id/approve-issue", () => {
    it("returns 202 for valid approval", async () => {
      const res = await app.inject({
        method: "PATCH", url: `/v1/court/orders/${ORDER_ID}/approve-issue`,
        headers: { authorization: `Bearer ${makeToken(["judge"])}` },
        payload: { dscSignature: "MEUCIG...(base64-dsc)...==", expectedVersion: 1 },
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 403 for registrar", async () => {
      const res = await app.inject({
        method: "PATCH", url: `/v1/court/orders/${ORDER_ID}/approve-issue`,
        headers: { authorization: `Bearer ${REGISTRAR_TOKEN()}` },
        payload: { dscSignature: "MEUCIG...", expectedVersion: 1 },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe("PATCH /v1/court/orders/:id/send-back", () => {
    it("returns 202 for valid send-back", async () => {
      const res = await app.inject({
        method: "PATCH", url: `/v1/court/orders/${ORDER_ID}/send-back`,
        headers: { authorization: `Bearer ${makeToken(["judge"])}` },
        payload: { reason: "Needs corrections", expectedVersion: 1 },
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 401 without token", async () => {
      const res = await app.inject({ method: "PATCH", url: `/v1/court/orders/${ORDER_ID}/send-back`, payload: {} });
      expect(res.statusCode).toBe(401);
    });
  });

  describe("PATCH /v1/court/orders/:id/recall", () => {
    it("returns 202 for valid recall", async () => {
      const res = await app.inject({
        method: "PATCH", url: `/v1/court/orders/${ORDER_ID}/recall`,
        headers: { authorization: `Bearer ${makeToken(["judge"])}` },
        payload: { recallReason: "Clerical error discovered", expectedVersion: 1 },
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 403 for employee role", async () => {
      const res = await app.inject({
        method: "PATCH", url: `/v1/court/orders/${ORDER_ID}/recall`,
        headers: { authorization: `Bearer ${NO_ROLE_TOKEN()}` },
        payload: { recallReason: "X", expectedVersion: 1 },
      });
      expect(res.statusCode).toBe(403);
    });
  });
});


// ═══════════════════════════════════════════════════════════════════
// 15. Config Registry Routes
// ═══════════════════════════════════════════════════════════════════
describe("Config Registry Routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { configRoutes } = await import("../src/modules/config-registry/routes.js");
    app = Fastify({ logger: false });
    const { authPlugin } = await import("@civitasone/auth/plugin");
    await app.register(authPlugin);
    await app.register(configRoutes);
    await app.ready();
  });
  afterAll(async () => { await app.close(); });

  beforeEach(() => {
    mockState.queryResult = [{ id: CONFIG_ID, tenantId: TENANT_ID, namespace: "case_types", key: "civil", value: {}, active: true, version: 1 }];
    mockState.countResult = 1;
  });

  describe("POST /v1/court/config", () => {
    it("returns 202 for valid config", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/court/config",
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: { namespace: "case_types", configKey: "civil", value: { label: "Civil" } },
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 401 without token", async () => {
      const res = await app.inject({ method: "POST", url: "/v1/court/config", payload: { namespace: "case_types", configKey: "civil", value: {} } });
      expect(res.statusCode).toBe(401);
    });

    it("returns 403 for registrar (not court_admin)", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/court/config",
        headers: { authorization: `Bearer ${REGISTRAR_TOKEN()}` },
        payload: { namespace: "case_types", configKey: "civil", value: {} },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe("GET /v1/court/config/:namespace", () => {
    it("returns config entries for namespace", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/court/config/case_types", headers: { authorization: `Bearer ${ADMIN_TOKEN()}` } });
      expect(res.statusCode).toBe(200);
      expect(res.json().items).toBeDefined();
    });

    it("returns 401 without auth", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/court/config/case_types" });
      expect(res.statusCode).toBe(401);
    });
  });

  describe("GET /v1/court/config-entry", () => {
    it("returns single config entry", async () => {
      const res = await app.inject({
        method: "GET", url: "/v1/court/config-entry?namespace=case_types&key=civil",
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
      });
      expect(res.statusCode).toBe(200);
    });

    it("returns 404 when not found", async () => {
      mockState.queryResult = [];
      const res = await app.inject({
        method: "GET", url: "/v1/court/config-entry?namespace=case_types&key=missing",
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("POST /v1/court/config/presets/:preset", () => {
    it("returns 202 for valid preset", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/court/config/presets/revenue",
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 401 without token", async () => {
      const res = await app.inject({ method: "POST", url: "/v1/court/config/presets/revenue" });
      expect(res.statusCode).toBe(401);
    });
  });

  describe("PATCH /v1/court/config/:id/deactivate", () => {
    it("returns 202 for valid deactivation", async () => {
      const res = await app.inject({
        method: "PATCH", url: `/v1/court/config/${CONFIG_ID}/deactivate`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: { expectedVersion: 1 },
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 401 without token", async () => {
      const res = await app.inject({ method: "PATCH", url: `/v1/court/config/${CONFIG_ID}/deactivate`, payload: {} });
      expect(res.statusCode).toBe(401);
    });

    it("returns 403 for registrar", async () => {
      const res = await app.inject({
        method: "PATCH", url: `/v1/court/config/${CONFIG_ID}/deactivate`,
        headers: { authorization: `Bearer ${REGISTRAR_TOKEN()}` },
        payload: { expectedVersion: 1 },
      });
      expect(res.statusCode).toBe(403);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// 16. Certified Copy Routes
// ═══════════════════════════════════════════════════════════════════
describe("Certified Copy Routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { certifiedCopyRoutes } = await import("../src/modules/certified-copy/routes.js");
    app = Fastify({ logger: false });
    const { authPlugin } = await import("@civitasone/auth/plugin");
    await app.register(authPlugin);
    await app.register(certifiedCopyRoutes);
    await app.ready();
  });
  afterAll(async () => { await app.close(); });

  beforeEach(() => {
    mockState.queryResult = [{
      id: COPY_ID, tenantId: TENANT_ID, caseId: CASE_ID, orderId: ORDER_ID,
      documentRef: "DOC-001", applicantNameEnc: "John Doe", copiesCount: 2,
      urgent: false, feeMinor: BigInt(500), feeSource: "manual", paymentRef: null, receiptMinor: null, status: "requested",
      requestedBy: ACTOR_ID, issuedBy: null, issuedAt: null, deliveryMode: "in_person",
      remarks: null, version: 1, createdAt: new Date(), updatedAt: new Date(),
    }];
    mockState.countResult = 1;
  });

  describe("POST /v1/court/cases/:id/certified-copies", () => {
    it("returns 202 for valid request", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/court/cases/${CASE_ID}/certified-copies`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: { caseId: CASE_ID, orderId: ORDER_ID, applicantName: "John Doe", copiesCount: 2 },
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 401 without token", async () => {
      const res = await app.inject({ method: "POST", url: `/v1/court/cases/${CASE_ID}/certified-copies`, payload: { caseId: CASE_ID } });
      expect(res.statusCode).toBe(401);
    });

    it("returns 403 for insufficient role", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/court/cases/${CASE_ID}/certified-copies`,
        headers: { authorization: `Bearer ${NO_ROLE_TOKEN()}` },
        payload: { caseId: CASE_ID, orderId: ORDER_ID, applicantName: "X", copiesCount: 1 },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe("GET /v1/court/cases/:id/certified-copies", () => {
    it("returns copies list with PII for privileged role", async () => {
      const res = await app.inject({ method: "GET", url: `/v1/court/cases/${CASE_ID}/certified-copies`, headers: { authorization: `Bearer ${ADMIN_TOKEN()}` } });
      expect(res.statusCode).toBe(200);
      expect(res.json().piiRevealed).toBe(true);
    });

    it("returns 401 without auth", async () => {
      const res = await app.inject({ method: "GET", url: `/v1/court/cases/${CASE_ID}/certified-copies` });
      expect(res.statusCode).toBe(401);
    });
  });

  describe("GET /v1/court/certified-copies/:id", () => {
    it("returns copy when found", async () => {
      const res = await app.inject({ method: "GET", url: `/v1/court/certified-copies/${COPY_ID}`, headers: { authorization: `Bearer ${ADMIN_TOKEN()}` } });
      expect(res.statusCode).toBe(200);
    });

    it("returns 404 when not found", async () => {
      mockState.queryResult = [];
      const res = await app.inject({ method: "GET", url: `/v1/court/certified-copies/${COPY_ID}`, headers: { authorization: `Bearer ${ADMIN_TOKEN()}` } });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("PATCH /v1/court/certified-copies/:id/status", () => {
    it("returns 202 for valid status transition", async () => {
      const res = await app.inject({
        method: "PATCH", url: `/v1/court/certified-copies/${COPY_ID}/status`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: { target: "issued", expectedVersion: 1 },
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 401 without token", async () => {
      const res = await app.inject({ method: "PATCH", url: `/v1/court/certified-copies/${COPY_ID}/status`, payload: { target: "issued", expectedVersion: 1 } });
      expect(res.statusCode).toBe(401);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// 17. Parcel Routes
// ═══════════════════════════════════════════════════════════════════
describe("Parcel Routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { parcelRoutes } = await import("../src/modules/case-parcel/routes.js");
    app = Fastify({ logger: false });
    const { authPlugin } = await import("@civitasone/auth/plugin");
    await app.register(authPlugin);
    await app.register(parcelRoutes);
    await app.ready();
  });
  afterAll(async () => { await app.close(); });

  beforeEach(() => {
    mockState.queryResult = [{
      id: PARCEL_ID, tenantId: TENANT_ID, caseId: CASE_ID,
      surveyNumber: "SRV-123", khasraNumber: "K-456", areaSqm: BigInt(5000),
      village: "Test Village", version: 1, createdAt: new Date(), updatedAt: new Date(),
    }];
    mockState.countResult = 1;
  });

  describe("POST /v1/court/cases/:id/parcels", () => {
    it("returns 202 for valid parcel", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/court/cases/${CASE_ID}/parcels`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: { surveyNumber: "SRV-123", areaSqm: 5000, village: "Test Village" },
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 401 without token", async () => {
      const res = await app.inject({ method: "POST", url: `/v1/court/cases/${CASE_ID}/parcels`, payload: {} });
      expect(res.statusCode).toBe(401);
    });

    it("returns 403 for insufficient role", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/court/cases/${CASE_ID}/parcels`,
        headers: { authorization: `Bearer ${NO_ROLE_TOKEN()}` },
        payload: { surveyNumber: "X" },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe("GET /v1/court/cases/:id/parcels", () => {
    it("returns parcels list", async () => {
      const res = await app.inject({ method: "GET", url: `/v1/court/cases/${CASE_ID}/parcels`, headers: { authorization: `Bearer ${ADMIN_TOKEN()}` } });
      expect(res.statusCode).toBe(200);
      expect(res.json().items).toBeDefined();
    });

    it("returns 401 without auth", async () => {
      const res = await app.inject({ method: "GET", url: `/v1/court/cases/${CASE_ID}/parcels` });
      expect(res.statusCode).toBe(401);
    });
  });

  describe("PATCH /v1/court/parcels/:id", () => {
    it("returns 202 for valid update", async () => {
      const res = await app.inject({
        method: "PATCH", url: `/v1/court/parcels/${PARCEL_ID}`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: { village: "Updated Village", expectedVersion: 1 },
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 401 without token", async () => {
      const res = await app.inject({ method: "PATCH", url: `/v1/court/parcels/${PARCEL_ID}`, payload: {} });
      expect(res.statusCode).toBe(401);
    });
  });

  describe("GET /v1/court/parcels/search", () => {
    it("returns parcels matching survey number", async () => {
      const res = await app.inject({
        method: "GET", url: "/v1/court/parcels/search?surveyNumber=SRV-123",
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().items).toBeDefined();
    });

    it("returns 401 without auth", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/court/parcels/search?surveyNumber=X" });
      expect(res.statusCode).toBe(401);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// 18. Court Documents Routes
// ═══════════════════════════════════════════════════════════════════
describe("Court Documents Routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { courtDocumentsRoutes } = await import("../src/modules/court-documents/routes.js");
    app = Fastify({ logger: false });
    const { authPlugin } = await import("@civitasone/auth/plugin");
    await app.register(authPlugin);
    await app.register(courtDocumentsRoutes);
    await app.ready();
  });
  afterAll(async () => { await app.close(); });

  beforeEach(() => {
    mockState.queryResult = [SEED_ORDER];
    mockState.countResult = 1;
  });

  describe("GET /v1/court/cause-lists/:id/pdf", () => {
    it("returns 404 when cause list not found", async () => {
      mockState.queryResult = [];
      const res = await app.inject({ method: "GET", url: `/v1/court/cause-lists/${CAUSELIST_ID}/pdf`, headers: { authorization: `Bearer ${ADMIN_TOKEN()}` } });
      expect(res.statusCode).toBe(404);
    });

    it("returns 401 without token", async () => {
      const res = await app.inject({ method: "GET", url: `/v1/court/cause-lists/${CAUSELIST_ID}/pdf` });
      expect(res.statusCode).toBe(401);
    });

    it("returns 403 for insufficient role", async () => {
      const res = await app.inject({ method: "GET", url: `/v1/court/cause-lists/${CAUSELIST_ID}/pdf`, headers: { authorization: `Bearer ${NO_ROLE_TOKEN()}` } });
      expect(res.statusCode).toBe(403);
    });
  });

  describe("GET /v1/court/orders/:id/pdf", () => {
    it("returns 404 when order not found", async () => {
      mockState.queryResult = [];
      const res = await app.inject({ method: "GET", url: `/v1/court/orders/${ORDER_ID}/pdf`, headers: { authorization: `Bearer ${ADMIN_TOKEN()}` } });
      expect(res.statusCode).toBe(404);
    });

    it("returns 401 without token", async () => {
      const res = await app.inject({ method: "GET", url: `/v1/court/orders/${ORDER_ID}/pdf` });
      expect(res.statusCode).toBe(401);
    });
  });

  describe("GET /v1/court/certified-copies/:id/pdf", () => {
    it("returns 404 when copy not found", async () => {
      mockState.queryResult = [];
      const res = await app.inject({ method: "GET", url: `/v1/court/certified-copies/${COPY_ID}/pdf`, headers: { authorization: `Bearer ${ADMIN_TOKEN()}` } });
      expect(res.statusCode).toBe(404);
    });

    it("returns 401 without token", async () => {
      const res = await app.inject({ method: "GET", url: `/v1/court/certified-copies/${COPY_ID}/pdf` });
      expect(res.statusCode).toBe(401);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// 19. Public Lookup Routes
// ═══════════════════════════════════════════════════════════════════
describe("Public Lookup Routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { publicLookupRoutes } = await import("../src/modules/public-lookup/routes.js");
    app = Fastify({ logger: false });
    const { authPlugin } = await import("@civitasone/auth/plugin");
    await app.register(authPlugin);
    await app.register(publicLookupRoutes);
    await app.ready();
  });
  afterAll(async () => { await app.close(); });

  beforeEach(() => {
    mockState.queryResult = [];
    mockState.countResult = 0;
  });

  describe("POST /v1/court/public-directory", () => {
    it("returns 202 for valid publish (admin)", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/court/public-directory",
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: { establishmentCode: "DLHC01", courtName: "Delhi High Court", publicSlug: "delhi-hc" },
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 401 without token", async () => {
      const res = await app.inject({ method: "POST", url: "/v1/court/public-directory", payload: { establishmentCode: "X", courtName: "X", publicSlug: "xx" } });
      expect(res.statusCode).toBe(401);
    });

    it("returns 403 for registrar", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/court/public-directory",
        headers: { authorization: `Bearer ${REGISTRAR_TOKEN()}` },
        payload: { establishmentCode: "DLHC01", courtName: "Test", publicSlug: "test-court" },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe("GET /v1/public/establishments", () => {
    it("returns list without auth (public route)", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/public/establishments" });
      expect(res.statusCode).toBe(200);
      expect(res.json().items).toBeDefined();
    });
  });
});
