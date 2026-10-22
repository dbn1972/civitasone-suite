/**
 * W2 works rescan, cluster 01 -- route-level behaviour for the approval and billing write endpoints:
 *
 *   GAP-WORKS-APPROVALS-01 / TS-DETAIL-03   registers and by-id reads carry the human work number (batched, tenant-scoped)
 *   GAP-WORKS-APPROVALS-NEW-05              AA create: real date, strictly positive amount, work must exist
 *   GAP-WORKS-APPROVALS-TS-NEW-05           TS create: 403 wrong role, real date, strictly positive amount
 *   GAP-WORKS-BILLING-BILLS-NEW-05          bill create: gross > 0, deductions >= 0, bill number unique per work, 403
 *   GAP-WORKS-BILLING-MEASUREMENTS-NEW-05   measurement create: 403/400/202, only a draft MB accepts one, dimension bounds
 *
 * Every rejection must publish NO command (a rejected request leaves no audit-visible change).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { FastifyInstance } from "fastify";

const publishSpy = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock("@civitasone/db", () => ({
  createTenantDb: () => ({
    sqlClient: { end: vi.fn() },
    db: { transaction: vi.fn((fn: Function) => fn({})) },
    dbFor: vi.fn(), sqlClientFor: vi.fn(), tierOf: vi.fn(), dbForRead: vi.fn(),
  }),
  createTenantTxHook: () => async () => {},
  tenantStorage: { enterWith: vi.fn() },
  runWithTenant: vi.fn((_t: string, fn: Function) => fn()),
}));

vi.mock("@civitasone/cache", () => ({
  Cache: class {
    getOrLoad(_k: string, fn: Function) { return fn(); }
    invalidate() { return Promise.resolve(); }
  },
}));

vi.mock("@civitasone/queue", () => ({
  createQueue: () => ({ publish: publishSpy, subscribe: vi.fn(), start: vi.fn(), stop: vi.fn() }),
  MemoryQueue: class { publish = publishSpy; subscribe = vi.fn(); start = vi.fn(); stop = vi.fn(); },
}));

vi.mock("@civitasone/observability", () => ({ registerOpsRoutes: vi.fn(), dbPing: vi.fn() }));

vi.mock("@civitasone/outbox", () => ({
  outboxMessages: { _: { name: "messages" } }, processed: { _: { name: "processed" } }, outboxSchema: {},
  enqueue: vi.fn(), markProcessed: vi.fn().mockResolvedValue(true), startRelay: vi.fn(() => setInterval(() => {}, 999999)),
}));

vi.mock("@civitasone/schemas/plugin", () => ({
  registerSchemaErrorHandler: (app: any, HttpError: any) => {
    app.setErrorHandler((err: any, _req: any, reply: any) => {
      if (err instanceof HttpError) return reply.status(err.status).send({ error: { code: err.code, message: err.message } });
      if (err.name === "ZodError" || err.issues) return reply.status(400).send({ error: { code: "VALIDATION_ERROR", message: err.message } });
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
        const token = String(auth).split(" ")[1] ?? "";
        const [, body] = token.split(".");
        const payload = JSON.parse(Buffer.from(body, "base64url").toString());
        if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return;
        (req as any).ctx = { tenantId: payload.tid, actorId: payload.sub, roles: payload.roles || [], correlationId: req.id || "c", sessionId: "s", actorType: "user" };
      } catch { /* leave ctx null */ }
    });
  }, { [Symbol.for("skip-override")]: true, [Symbol.for("fastify.display-name")]: "civitasone-auth" }),
}));

vi.mock("@civitasone/auth/context", () => {
  class AuthContextError extends Error {
    status: number; code: string;
    constructor(s: number, c: string, m: string) { super(m); this.status = s; this.code = c; }
  }
  return {
    resolveServiceContext: (req: any) => { if (!req.ctx) throw new AuthContextError(401, "UNAUTHENTICATED", "missing token"); return req.ctx; },
    AuthContextError,
  };
});

vi.mock("@civitasone/auth", () => ({
  signToken: (p: any, _s: string, exp: number) => {
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const body = Buffer.from(JSON.stringify({ ...p, exp: Math.floor(Date.now() / 1000) + exp })).toString("base64url");
    return `${header}.${body}.${Buffer.from("sig").toString("base64url")}`;
  },
  hasAnyRole: (ctx: any, roles: string[]) => roles.some((r) => ctx.roles?.includes(r)),
}));

// ── ids ─────────────────────────────────────────────────────────────────────
const TENANT = "11111111-bbbb-4000-8000-000000000001";
const ACTOR = "00000000-aaaa-4000-8000-000000000001";
const WORK = "00000000-1111-4000-8000-000000000001";
const WORK_UNKNOWN = "00000000-0000-4000-8000-000000000099";
const WORK_DRAFT = "00000000-1111-4000-8000-000000000002";
const AUTHORITY = "00000000-2222-4000-8000-0000000000aa";
const AWARD = "00000000-2222-4000-8000-000000000001";
const MB_DRAFT = "00000000-3333-4000-8000-000000000001";
const MB_FINAL = "00000000-3333-4000-8000-000000000002";
const MB_SO = "00000000-3333-4000-8000-000000000003";
const BOQ = "00000000-4444-4000-8000-000000000001";
const AA_ID = "00000000-5555-4000-8000-000000000001";
const TS_ID = "00000000-6666-4000-8000-000000000001";

// ── approval + proposal repos ────────────────────────────────────────────────
const headersSpy = vi.hoisted(() => vi.fn());
const searchSpy = vi.hoisted(() => vi.fn());
const aaRow = { id: "00000000-5555-4000-8000-000000000001", workId: "00000000-1111-4000-8000-000000000001", aaNumber: "AA/1", status: "draft", approvedAmountMinor: 5000000n, createdBy: "00000000-aaaa-4000-8000-0000000000ff" };
const tsRow = { id: "00000000-6666-4000-8000-000000000001", workId: "00000000-1111-4000-8000-000000000001", tsNumber: "TS/1", status: "draft", tsAmountMinor: 5000000n, createdBy: "00000000-aaaa-4000-8000-0000000000ff" };
const orphanRow = { ...aaRow, id: "00000000-5555-4000-8000-000000000002", workId: "00000000-1111-4000-8000-0000000000ee", aaNumber: "AA/2" };

vi.mock("../src/modules/approval/repo.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/modules/approval/repo.js")>();
  return {
    ...orig,
    listAa: vi.fn(async () => [aaRow, orphanRow]),
    listTs: vi.fn(async () => [tsRow]),
    countAa: vi.fn(async () => 2),
    countTs: vi.fn(async () => 1),
    countAaForWork: vi.fn(async () => 0),
    countTsForWork: vi.fn(async () => 0),
    getAa: vi.fn(async (_t: string, id: string) => (id === aaRow.id ? aaRow : null)),
    getTs: vi.fn(async (_t: string, id: string) => (id === tsRow.id ? tsRow : null)),
  };
});

vi.mock("../src/modules/proposal/repo.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/modules/proposal/repo.js")>();
  return {
    ...orig,
    getProposal: vi.fn(async (_t: string, id: string) => {
      if (id === "00000000-0000-4000-8000-000000000099") return null;
      return { id, status: id === "00000000-1111-4000-8000-000000000002" ? "draft" : "dao_finalized" };
    }),
    getWorkHeaders: headersSpy,
    searchProposals: searchSpy,
  };
});

// ── billing + tender + boq repos ─────────────────────────────────────────────
const mbs: Record<string, { id: string; status: string; workId: string; awardId: string }> = {
  "00000000-3333-4000-8000-000000000001": { id: "00000000-3333-4000-8000-000000000001", status: "draft", workId: "00000000-1111-4000-8000-000000000001", awardId: "00000000-2222-4000-8000-000000000001" },
  "00000000-3333-4000-8000-000000000002": { id: "00000000-3333-4000-8000-000000000002", status: "do_finalized", workId: "00000000-1111-4000-8000-000000000001", awardId: "00000000-2222-4000-8000-000000000001" },
  "00000000-3333-4000-8000-000000000003": { id: "00000000-3333-4000-8000-000000000003", status: "so_finalized", workId: "00000000-1111-4000-8000-000000000001", awardId: "00000000-2222-4000-8000-000000000001" },
};
const priorBills = vi.hoisted(() => ({ rows: [] as Array<{ billNumber: string; grossAmountMinor: bigint }> }));

vi.mock("../src/modules/billing/repo.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/modules/billing/repo.js")>();
  return {
    ...orig,
    getMb: vi.fn(async (_t: string, id: string) => mbs[id] ?? null),
    getMbByNumber: vi.fn(async () => null),
    getBill: vi.fn(async () => null),
    listBillsForWork: vi.fn(async () => priorBills.rows),
    // 10 units x 100 paise = 1000 paise of measured work on every MB
    listMeasurementsByMb: vi.fn(async () => [{ boqItemId: "00000000-4444-4000-8000-000000000001", quantity: "10" }]),
    listMeasurementsByBoqItem: vi.fn(async () => []),
    listBillsByMb: vi.fn(async () => []),
  };
});

vi.mock("../src/modules/tender/repo.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/modules/tender/repo.js")>();
  return {
    ...orig,
    getAwardById: vi.fn(async () => ({ id: "00000000-2222-4000-8000-000000000001", workId: "00000000-1111-4000-8000-000000000001", acceptedAmountMinor: 999999999999n, status: "do_finalized" })),
  };
});

vi.mock("../src/modules/boq/repo.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/modules/boq/repo.js")>();
  return {
    ...orig,
    getBoqItemById: vi.fn(async () => ({ id: "00000000-4444-4000-8000-000000000001", workId: "00000000-1111-4000-8000-000000000001", quantity: "1000", rate: 100n })),
    listBoqItemsByIds: vi.fn(async () => [{ id: "00000000-4444-4000-8000-000000000001", rate: 100n }]),
  };
});

function authHeader(roles: string[] = ["works_admin"]) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify({ sub: ACTOR, tid: TENANT, roles, exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
  return { authorization: `Bearer ${header}.${body}.${Buffer.from("sig").toString("base64url")}` };
}

let app: FastifyInstance;
beforeAll(async () => { const { buildApp } = await import("../src/app.js"); app = await buildApp(); });
afterAll(async () => { await app.close(); });
beforeEach(() => {
  publishSpy.mockClear();
  headersSpy.mockReset();
  searchSpy.mockReset();
  searchSpy.mockResolvedValue([{ id: "00000000-1111-4000-8000-000000000001", workNumber: "WK/2026/001", description: "Canal lining", status: "dao_finalized" }]);
  headersSpy.mockImplementation(async (_t: string, ids: string[]) =>
    new Map(ids.filter((i) => i === WORK).map((i) => [i, { workNumber: "WK/2026/001", description: "Canal lining" }])));
  priorBills.rows = [];
});

const post = (url: string, payload: unknown, roles?: string[]) =>
  app.inject({ method: "POST", url, headers: authHeader(roles), payload: payload as Record<string, unknown> });

// ═════════════════════════════════════════════════════════════════════════════
describe("GAP-WORKS-APPROVALS-01 / TS-DETAIL-03: registers and by-id reads carry the work number", () => {
  it("AA register: each row gets workNumber from ONE batched, tenant-scoped lookup; an unresolvable work is null, never a guess", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/works/approvals/aa", headers: authHeader() });
    expect(res.statusCode).toBe(200);
    const rows = res.json().data as Array<{ aaNumber: string; workNumber: string | null }>;
    expect(rows.find((r) => r.aaNumber === "AA/1")!.workNumber).toBe("WK/2026/001");
    expect(rows.find((r) => r.aaNumber === "AA/2")!.workNumber).toBeNull();
    expect(res.json().meta.total).toBe(2);
    expect(headersSpy).toHaveBeenCalledTimes(1);
    expect(headersSpy).toHaveBeenCalledWith(TENANT, [aaRow.workId, orphanRow.workId]);
  });

  it("TS register row carries workNumber", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/works/approvals/ts", headers: authHeader() });
    expect(res.statusCode).toBe(200);
    expect(res.json().data[0].workNumber).toBe("WK/2026/001");
  });

  it("AA and TS by-id reads carry workNumber, and a missing id is still a 404", async () => {
    const aa = await app.inject({ method: "GET", url: `/v1/works/approvals/aa/${AA_ID}`, headers: authHeader() });
    expect(aa.json().data.workNumber).toBe("WK/2026/001");
    const ts = await app.inject({ method: "GET", url: `/v1/works/approvals/ts/${TS_ID}`, headers: authHeader() });
    expect(ts.json().data.workNumber).toBe("WK/2026/001");
    const missing = await app.inject({ method: "GET", url: "/v1/works/approvals/aa/00000000-0000-4000-8000-000000000000", headers: authHeader() });
    expect(missing.statusCode).toBe(404);
  });

  it("still requires a read role", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/works/approvals/aa", headers: authHeader(["citizen"]) });
    expect(res.statusCode).toBe(403);
    expect(headersSpy).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("GAP-WORKS-APPROVALS-TS-NEW-01: work picker search returns status and can rank eligible works first", () => {
  it("passes the default limit (20) and no preference through to the repo", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/works/proposals?q=WK", headers: authHeader() });
    expect(res.statusCode).toBe(200);
    expect(res.json().data[0].status).toBe("dao_finalized");
    expect(searchSpy).toHaveBeenCalledWith(TENANT, "WK", 20, []);
  });

  it("passes ?limit and ?prefer through (eligible statuses sort first so a capped list cannot hide them)", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/works/proposals?q=WK&limit=50&prefer=dao_finalized,ts_eligible", headers: authHeader() });
    expect(res.statusCode).toBe(200);
    expect(searchSpy).toHaveBeenCalledWith(TENANT, "WK", 50, ["dao_finalized", "ts_eligible"]);
  });

  for (const bad of ["limit=0", "limit=51", "limit=abc", "prefer=DAO-Finalized", "prefer=a,b,c,d,e,f"]) {
    it(`400 for ?${bad}, never silently ignored`, async () => {
      const res = await app.inject({ method: "GET", url: `/v1/works/proposals?q=WK&${bad}`, headers: authHeader() });
      expect(res.statusCode).toBe(400);
      expect(searchSpy).not.toHaveBeenCalled();
    });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
describe("GAP-WORKS-APPROVALS-NEW-05: POST /v1/works/approvals/aa", () => {
  const body = (over: Record<string, unknown> = {}) => ({
    workId: WORK, aaNumber: "AA/2026/001", aaDate: "2026-01-15", approvingAuthorityId: AUTHORITY, approvedAmountMinor: "5000000", ...over,
  });

  for (const bad of ["2026-02-30", "2026-13-01", "2026-00-10", "15/01/2026", "yesterday", "", "2026-01-15 10:00", "2026-1-5"]) {
    it(`400 for aaDate ${JSON.stringify(bad)} (used to be accepted with 202 and then throw in the consumer)`, async () => {
      const res = await post("/v1/works/approvals/aa", body({ aaDate: bad }));
      expect(res.statusCode).toBe(400);
      expect(publishSpy).not.toHaveBeenCalled();
    });
  }

  for (const bad of ["0", "-1", "-5000000", "abc", "1.5", "9223372036854775808", 0, -7]) {
    it(`400 for approvedAmountMinor ${JSON.stringify(bad)}`, async () => {
      const res = await post("/v1/works/approvals/aa", body({ approvedAmountMinor: bad }));
      expect(res.statusCode).toBe(400);
      expect(publishSpy).not.toHaveBeenCalled();
    });
  }

  it("404 when the cited work does not exist (like TS create), and nothing is published", async () => {
    const res = await post("/v1/works/approvals/aa", body({ workId: WORK_UNKNOWN }));
    expect(res.statusCode).toBe(404);
    expect(publishSpy).not.toHaveBeenCalled();
  });

  it("403 for a role that cannot create an AA, and nothing is published", async () => {
    const res = await post("/v1/works/approvals/aa", body(), ["works_viewer"]);
    expect(res.statusCode).toBe(403);
    expect(publishSpy).not.toHaveBeenCalled();
  });

  for (const date of ["2026-01-15", "2024-02-29", "2026-01-15T00:00:00Z", "2026-01-15T05:30:00+05:30"]) {
    it(`202 for aaDate ${date}`, async () => {
      const res = await post("/v1/works/approvals/aa", body({ aaDate: date }));
      expect(res.statusCode).toBe(202);
      expect(res.json().approvalType).toBe("original");
      expect(publishSpy).toHaveBeenCalledTimes(1);
    });
  }

  it("publishes the canonical paise string for a valid amount", async () => {
    await post("/v1/works/approvals/aa", body({ approvedAmountMinor: 5000000 }));
    const msg = publishSpy.mock.calls[0]![1] as { payload: { approvedAmountMinor: string } };
    expect(msg.payload.approvedAmountMinor).toBe("5000000");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("GAP-WORKS-APPROVALS-TS-NEW-05: POST /v1/works/approvals/ts", () => {
  const body = (over: Record<string, unknown> = {}) => ({
    workId: WORK, tsNumber: "TS/2026/001", tsDate: "2026-01-15", tsAuthorityId: AUTHORITY, tsAmountMinor: "5000000", ...over,
  });

  it("401 without a token", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/works/approvals/ts", payload: body() });
    expect(res.statusCode).toBe(401);
  });

  for (const role of ["works_viewer", "citizen", "estimator"]) {
    it(`403 for ${role} (not a TS creator), no command published`, async () => {
      const res = await post("/v1/works/approvals/ts", body(), [role]);
      expect(res.statusCode).toBe(403);
      expect(publishSpy).not.toHaveBeenCalled();
    });
  }

  for (const bad of ["2026-02-30", "not-a-date", "31/01/2026", ""]) {
    it(`400 for tsDate ${JSON.stringify(bad)}`, async () => {
      const res = await post("/v1/works/approvals/ts", body({ tsDate: bad }));
      expect(res.statusCode).toBe(400);
      expect(publishSpy).not.toHaveBeenCalled();
    });
  }

  for (const bad of ["0", "-1", "-5000000", "abc", "9223372036854775808"]) {
    it(`400 for tsAmountMinor ${JSON.stringify(bad)}`, async () => {
      const res = await post("/v1/works/approvals/ts", body({ tsAmountMinor: bad }));
      expect(res.statusCode).toBe(400);
      expect(publishSpy).not.toHaveBeenCalled();
    });
  }

  it("404 when the work does not exist", async () => {
    const res = await post("/v1/works/approvals/ts", body({ workId: WORK_UNKNOWN }));
    expect(res.statusCode).toBe(404);
  });

  it("422 DAO_GATE_BLOCKED for a work that is not DAO-finalized (unchanged)", async () => {
    const res = await post("/v1/works/approvals/ts", body({ workId: WORK_DRAFT }));
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("DAO_GATE_BLOCKED");
    expect(publishSpy).not.toHaveBeenCalled();
  });

  it("202 with sanctionType for a valid body", async () => {
    const res = await post("/v1/works/approvals/ts", body());
    expect(res.statusCode).toBe(202);
    expect(res.json().sanctionType).toBe("original");
    expect(publishSpy).toHaveBeenCalledTimes(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("GAP-WORKS-BILLING-BILLS-NEW-05: POST /v1/works/billing/bills", () => {
  const body = (over: Record<string, unknown> = {}) => ({
    workId: WORK, awardId: AWARD, mbId: MB_FINAL, billMode: "e_mb", billNumber: "RA-2", grossAmountMinor: "500", ...over,
  });

  it("401 without a token", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/works/billing/bills", payload: body() });
    expect(res.statusCode).toBe(401);
  });

  for (const role of ["works_viewer", "citizen", "auditor"]) {
    it(`403 for ${role} (not a bill creator), no command published`, async () => {
      const res = await post("/v1/works/billing/bills", body(), [role]);
      expect(res.statusCode).toBe(403);
      expect(publishSpy).not.toHaveBeenCalled();
    });
  }

  for (const bad of ["0", "-1", "-100", 0, -5, "abc"]) {
    it(`400 for grossAmountMinor ${JSON.stringify(bad)} (a negative gross used to pass both cumulative ceilings)`, async () => {
      const res = await post("/v1/works/billing/bills", body({ grossAmountMinor: bad }));
      expect(res.statusCode).toBe(400);
      expect(publishSpy).not.toHaveBeenCalled();
    });
  }

  it("400 for a negative deduction", async () => {
    const res = await post("/v1/works/billing/bills", body({ deductionsMinor: "-1" }));
    expect(res.statusCode).toBe(400);
    expect(publishSpy).not.toHaveBeenCalled();
  });

  it("202 for zero deductions and for deductions omitted (no deductions is a valid answer)", async () => {
    const zero = await post("/v1/works/billing/bills", body({ billNumber: "RA-Z", deductionsMinor: "0" }));
    expect(zero.statusCode).toBe(202);
    const none = await post("/v1/works/billing/bills", body({ billNumber: "RA-N" }));
    expect(none.statusCode).toBe(202);
  });

  it("202 for a valid body and publishes the trimmed bill number", async () => {
    const res = await post("/v1/works/billing/bills", body({ billNumber: "  RA-7  ", grossAmountMinor: 1000 }));
    expect(res.statusCode).toBe(202);
    const msg = publishSpy.mock.calls[0]![1] as { payload: { billNumber: string; grossAmountMinor: string } };
    expect(msg.payload.billNumber).toBe("RA-7");
    expect(msg.payload.grossAmountMinor).toBe("1000");
  });

  it("409 DUPLICATE_BILL_NUMBER when the number is already used on the work, ignoring case and surrounding spaces", async () => {
    priorBills.rows = [{ billNumber: "RA-1", grossAmountMinor: 100n }];
    const res = await post("/v1/works/billing/bills", body({ billNumber: "  ra-1 " }));
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("DUPLICATE_BILL_NUMBER");
    expect(publishSpy).not.toHaveBeenCalled();
  });

  it("a different number on the same work is accepted", async () => {
    priorBills.rows = [{ billNumber: "RA-1", grossAmountMinor: 100n }];
    const res = await post("/v1/works/billing/bills", body({ billNumber: "RA-2" }));
    expect(res.statusCode).toBe(202);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("GAP-WORKS-BILLING-MEASUREMENTS-NEW-05: POST /v1/works/billing/measurements", () => {
  const body = (over: Record<string, unknown> = {}) => ({ mbId: MB_DRAFT, boqItemId: BOQ, quantity: 5, ...over });

  it("401 without a token", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/works/billing/measurements", payload: body() });
    expect(res.statusCode).toBe(401);
  });

  for (const role of ["works_viewer", "citizen", "auditor"]) {
    it(`403 for ${role} (not a measurement recorder), no command published`, async () => {
      const res = await post("/v1/works/billing/measurements", body(), [role]);
      expect(res.statusCode).toBe(403);
      expect(publishSpy).not.toHaveBeenCalled();
    });
  }

  it("202 for a valid measurement against a draft MB", async () => {
    const res = await post("/v1/works/billing/measurements", body({ numberVal: 2, lengthVal: 3.5, breadthVal: 1.25, depthVal: 0.5, remarks: "chainage 0+120" }));
    expect(res.statusCode).toBe(202);
    expect(publishSpy).toHaveBeenCalledTimes(1);
  });

  for (const status of ["so_finalized", "do_finalized"]) {
    it(`409 MB_NOT_OPEN when the MB is ${status}: recording would change the measured-value ceiling after finalization`, async () => {
      const id = status === "do_finalized" ? MB_FINAL : MB_SO;
      const res = await post("/v1/works/billing/measurements", body({ mbId: id }));
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe("MB_NOT_OPEN");
      expect(publishSpy).not.toHaveBeenCalled();
    });
  }

  it("404 for an unknown MB", async () => {
    const res = await post("/v1/works/billing/measurements", body({ mbId: "00000000-3333-4000-8000-0000000000ff" }));
    expect(res.statusCode).toBe(404);
    expect(publishSpy).not.toHaveBeenCalled();
  });

  for (const [label, over] of [
    ["a zero quantity", { quantity: 0 }],
    ["a negative quantity", { quantity: -1 }],
    ["a quantity beyond numeric(18,4)", { quantity: 1e14 }],
    ["a length beyond numeric(12,4)", { lengthVal: 100000000 }],
    ["a breadth beyond numeric(12,4)", { breadthVal: -100000000 }],
    ["a depth beyond numeric(12,4)", { depthVal: 1e12 }],
    ["a number-of-items value beyond numeric(12,4)", { numberVal: 99999999.99995 }],
    ["a missing mbId", { mbId: undefined }],
  ] as Array<[string, Record<string, unknown>]>) {
    it(`400 for ${label}`, async () => {
      const res = await post("/v1/works/billing/measurements", body(over));
      expect(res.statusCode).toBe(400);
      expect(publishSpy).not.toHaveBeenCalled();
    });
  }

  it("the widest storable dimension (99999999.9999) is accepted", async () => {
    const res = await post("/v1/works/billing/measurements", body({ lengthVal: 99999999.9999, depthVal: -99999999.9999 }));
    expect(res.statusCode).toBe(202);
  });
});
