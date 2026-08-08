/**
 * Regression tests for the 6 human-review gaps from AI_TEST_REPORT_Works_Module.md.
 */
import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  TENANT_A, ACTOR_A, AWARD_ID, WORK_ID, BILL_ID, bearerToken, jwtPayload, queueMessage,
} from "./fixtures/works-fixtures.js";
import { COMMANDS, EVENTS, FINANCE_HANDOFF } from "../src/topics.js";
import { boqItems } from "../src/modules/boq/schema.js";
import { bills, measurementBooks } from "../src/modules/billing/schema.js";
import { awards } from "../src/modules/tender/schema.js";
import { workIssues } from "../src/modules/execution/schema.js";
import {
  billAmountExceedsAward,
  isTerminalBillStatus,
} from "../src/modules/billing/domain.js";
import {
  isDuplicateBoqLine,
  boqLineKey,
} from "../src/modules/boq/domain.js";
import {
  canViewBidDetails,
  redactQuotation,
} from "../src/modules/tender/domain.js";

// ── Shared consumer mocks ───────────────────────────────────────────────────
const mockInserted: unknown[] = [];
const mockUpdated: unknown[] = [];
const mockEnqueued: Array<{ topic: string; payload?: Record<string, unknown> }> = [];
const mockSelectMap = new Map<unknown, unknown[]>();
let mockMarkResult = true;

function chainRows(rows: unknown[]) {
  const w: any = Promise.resolve(rows);
  w.limit = () => Promise.resolve(rows);
  return w;
}

const mockTx: any = {
  insert: (t: unknown) => { mockInserted.push(t); return { values: () => Promise.resolve() }; },
  update: (t: unknown) => {
    mockUpdated.push(t);
    return { set: () => ({ where: () => Promise.resolve() }) };
  },
  select: (cols?: unknown) => ({
    from: (t: unknown) => ({
      where: () => chainRows(mockSelectMap.get(t) ?? []),
    }),
  }),
};

vi.mock("../src/shared/db.js", () => ({
  db: { transaction: (fn: Function) => fn(mockTx) },
  sqlClient: { end: vi.fn() },
  scopedRead: vi.fn((fn: Function) => fn(mockTx)),
}));
vi.mock("../src/shared/infra.js", () => ({
  cache: { getOrLoad: vi.fn((_k: string, fn: Function) => fn()), invalidate: vi.fn() },
  queue: { publish: vi.fn(), subscribe: vi.fn(), start: vi.fn(), stop: vi.fn() },
}));
vi.mock("../src/shared/outbox.js", () => ({
  markProcessed: vi.fn(() => Promise.resolve(mockMarkResult)),
  enqueue: vi.fn((_tx: unknown, ev: { topic: string; payload?: Record<string, unknown> }) => {
    mockEnqueued.push(ev);
    return Promise.resolve();
  }),
  outboxMessages: {}, processed: {}, outboxSchema: {},
}));

beforeEach(() => {
  mockInserted.length = 0;
  mockUpdated.length = 0;
  mockEnqueued.length = 0;
  mockSelectMap.clear();
  mockMarkResult = true;
});

async function billingHandlers(): Promise<Record<string, Function>> {
  const { registerBillingConsumers } = await import("../src/modules/billing/consumer.js");
  const h: Record<string, Function> = {};
  registerBillingConsumers({ subscribe: (t: string, fn: Function) => { h[t] = fn; } } as any);
  return h;
}

async function boqHandlers(): Promise<Record<string, Function>> {
  const { registerBoqConsumers } = await import("../src/modules/boq/consumer.js");
  const h: Record<string, Function> = {};
  registerBoqConsumers({ subscribe: (t: string, fn: Function) => { h[t] = fn; } } as any);
  return h;
}

async function executionHandlers(): Promise<Record<string, Function>> {
  const { registerExecutionConsumers } = await import("../src/modules/execution/consumer.js");
  const h: Record<string, Function> = {};
  registerExecutionConsumers({ subscribe: (t: string, fn: Function) => { h[t] = fn; } } as any);
  return h;
}

describe("Gap 1 — Finance hand-off on bill DO-finalization", () => {
  it("emits finance.bill.create when bill reaches do_finalized", async () => {
    mockSelectMap.set(bills, [{
      id: BILL_ID,
      billNumber: "BILL/2026/001",
      awardId: AWARD_ID,
      workId: WORK_ID,
      grossAmountMinor: 500000n,
      netPayableMinor: 450000n,
    }]);
    mockSelectMap.set(awards, [{
      id: AWARD_ID,
      contractorName: "ACME Works Ltd",
      acceptedAmountMinor: 1000000n,
    }]);

    const h = await billingHandlers();
    await h[COMMANDS.billFinalize]({
      ...queueMessage(TENANT_A, ACTOR_A, "msg-fin-1"),
      payload: { id: BILL_ID, nextStatus: "do_finalized" },
    });

    expect(mockEnqueued.some((e) => e.topic === EVENTS.billFinalized)).toBe(true);
    const financeEvt = mockEnqueued.find((e) => e.topic === FINANCE_HANDOFF.billCreate);
    expect(financeEvt).toBeDefined();
    expect(financeEvt!.payload?.grnRef).toBe(`works_bill:${BILL_ID}`);
    expect(financeEvt!.payload?.poRef).toBe(`works_award:${AWARD_ID}`);
    expect(financeEvt!.payload?.grossMinor).toBe("500000");
    expect(financeEvt!.payload?.netMinor).toBe("450000");
  });

  it("does not emit finance.bill.create for intermediate finalization steps", async () => {
    mockSelectMap.set(bills, [{ id: BILL_ID, billNumber: "B1", awardId: AWARD_ID, workId: WORK_ID, grossAmountMinor: 1n, netPayableMinor: 1n }]);
    const h = await billingHandlers();
    await h[COMMANDS.billFinalize]({
      ...queueMessage(TENANT_A, ACTOR_A, "msg-fin-2"),
      payload: { id: BILL_ID, nextStatus: "dao_finalized" },
    });
    expect(mockEnqueued.some((e) => e.topic === FINANCE_HANDOFF.billCreate)).toBe(false);
  });

  it("isTerminalBillStatus identifies do_finalized only", () => {
    expect(isTerminalBillStatus("do_finalized")).toBe(true);
    expect(isTerminalBillStatus("dao_finalized")).toBe(false);
  });
});

describe("Gap 2 — Bill amount vs award ceiling (FR-BIL-012)", () => {
  it("billAmountExceedsAward rejects cumulative gross above ceiling", () => {
    expect(billAmountExceedsAward(700000n, 300000n, 1000000n)).toBe(false);
    expect(billAmountExceedsAward(800000n, 200001n, 1000000n)).toBe(true);
  });

  it("billCreate rejects when cumulative gross exceeds award", async () => {
    mockSelectMap.set(measurementBooks, []);
    mockSelectMap.set(awards, [{ id: AWARD_ID, acceptedAmountMinor: 100000n }]);
    mockSelectMap.set(bills, [{ grossAmountMinor: 90000n }]);

    const h = await billingHandlers();
    await h[COMMANDS.billCreate]({
      ...queueMessage(TENANT_A, ACTOR_A, "msg-ceil-1"),
      payload: {
        id: "bill-new", workId: WORK_ID, awardId: AWARD_ID,
        billMode: "abstract", billNumber: "B-CEIL", grossAmountMinor: "20000",
      },
    });
    expect(mockInserted).toHaveLength(0);
  });

  it("billCreate persists when cumulative gross is within award", async () => {
    mockSelectMap.set(measurementBooks, []);
    mockSelectMap.set(awards, [{ id: AWARD_ID, acceptedAmountMinor: 100000n }]);
    mockSelectMap.set(bills, [{ grossAmountMinor: 40000n }]);

    const h = await billingHandlers();
    await h[COMMANDS.billCreate]({
      ...queueMessage(TENANT_A, ACTOR_A, "msg-ceil-2"),
      payload: {
        id: "bill-ok", workId: WORK_ID, awardId: AWARD_ID,
        billMode: "abstract", billNumber: "B-OK", grossAmountMinor: "50000",
      },
    });
    expect(mockInserted).toHaveLength(1);
  });
});

describe("Gap 3 — BoQ duplicate-line guard", () => {
  it("boqLineKey prefers itemCode over description", () => {
    expect(boqLineKey("IT-001", "Excavation")).toBe("it-001");
    expect(boqLineKey(null, "Excavation")).toBe("excavation");
  });

  it("isDuplicateBoqLine detects same workId + itemCode", () => {
    const existing = [{ workId: WORK_ID, itemCode: "IT-001", itemDescription: "A" }];
    expect(isDuplicateBoqLine(existing, WORK_ID, "IT-001", "Different desc")).toBe(true);
    expect(isDuplicateBoqLine(existing, WORK_ID, "IT-002", "A")).toBe(false);
  });

  it("boqAddItem rejects duplicate itemCode on same work", async () => {
    mockSelectMap.set(boqItems, [{
      workId: WORK_ID, itemCode: "IT-001", itemDescription: "Existing line",
    }]);
    const h = await boqHandlers();
    await h[COMMANDS.boqAddItem]({
      ...queueMessage(TENANT_A, ACTOR_A, "msg-dup-1"),
      payload: {
        id: "new-boq", workId: WORK_ID, itemCode: "IT-001",
        itemDescription: "Duplicate", unit: "cum", rate: "10000", quantity: 5,
      },
    });
    expect(mockInserted).toHaveLength(0);
  });

  it("boqAddItem persists when itemCode is unique for the work", async () => {
    mockSelectMap.set(boqItems, []);
    const h = await boqHandlers();
    await h[COMMANDS.boqAddItem]({
      ...queueMessage(TENANT_A, ACTOR_A, "msg-dup-2"),
      payload: {
        id: "new-boq", workId: WORK_ID, itemCode: "IT-002",
        itemDescription: "New line", unit: "cum", rate: "10000", quantity: 5,
      },
    });
    expect(mockInserted).toHaveLength(1);
  });
});

describe("Gap 4 — issueClose route and consumer", () => {
  it("issueClose consumer closes open issue and emits issue.closed", async () => {
    mockSelectMap.set(workIssues, [{ id: "iss-1", workId: WORK_ID, status: "open" }]);
    const h = await executionHandlers();
    await h[COMMANDS.issueClose]({
      ...queueMessage(TENANT_A, ACTOR_A, "msg-close-1"),
      payload: { id: "iss-1" },
    });
    expect(mockUpdated).toHaveLength(1);
    expect(mockEnqueued.some((e) => e.topic === EVENTS.issueClosed)).toBe(true);
  });

  it("issueClose is no-op when issue already closed", async () => {
    mockSelectMap.set(workIssues, [{ id: "iss-2", workId: WORK_ID, status: "closed" }]);
    const h = await executionHandlers();
    await h[COMMANDS.issueClose]({
      ...queueMessage(TENANT_A, ACTOR_A, "msg-close-2"),
      payload: { id: "iss-2" },
    });
    expect(mockUpdated).toHaveLength(0);
  });
});

// ── Route-level tests (issue close + bid confidentiality + reporting) ───────
const countProposals = vi.fn();
const countClosures = vi.fn();
const proposalStatusCounts = vi.fn();
const listProposalsForReport = vi.fn();
const listQuotations = vi.fn();

vi.mock("../src/modules/proposal/repo.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/modules/proposal/repo.js")>();
  return {
    ...orig,
    countProposals,
    proposalStatusCounts,
    listProposalsForReport,
    getProposal: vi.fn(async () => null),
  };
});
vi.mock("../src/modules/execution/repo.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/modules/execution/repo.js")>();
  return { ...orig, countClosures };
});
vi.mock("../src/modules/tender/repo.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/modules/tender/repo.js")>();
  return { ...orig, listQuotations };
});

vi.mock("@civitasone/db", () => ({
  createTenantDb: () => ({
    sqlClient: { end: vi.fn() },
    db: { transaction: vi.fn(), select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }) },
    dbFor: vi.fn(), sqlClientFor: vi.fn(), tierOf: vi.fn(), dbForRead: vi.fn(),
  }),
  createTenantTxHook: () => async () => {},
  tenantStorage: { enterWith: vi.fn() },
  runWithTenant: vi.fn((_t: string, fn: Function) => fn()),
}));
vi.mock("@civitasone/cache", () => ({
  Cache: class { getOrLoad(_k: string, fn: Function) { return fn(); } invalidate() { return Promise.resolve(); } },
}));
vi.mock("@civitasone/queue", () => ({
  createQueue: () => ({ publish: vi.fn(), subscribe: vi.fn(), start: vi.fn(), stop: vi.fn() }),
  MemoryQueue: class { publish = vi.fn(); subscribe = vi.fn(); start = vi.fn(); stop = vi.fn(); },
}));
vi.mock("@civitasone/observability", () => ({ registerOpsRoutes: vi.fn(), dbPing: vi.fn() }));
vi.mock("@civitasone/outbox", () => ({
  outboxMessages: {}, processed: {}, outboxSchema: {},
  enqueue: vi.fn(), markProcessed: vi.fn(), startRelay: vi.fn(() => setInterval(() => {}, 999999)),
}));
vi.mock("@civitasone/schemas/plugin", () => ({
  registerSchemaErrorHandler: (app: any, HttpError: any) => {
    app.setErrorHandler((err: any, _req: any, reply: any) => {
      if (err instanceof HttpError) return reply.status(err.status).send({ error: { code: err.code } });
      return reply.status(500).send({ error: { code: "INTERNAL" } });
    });
  },
}));
vi.mock("@civitasone/auth/plugin", () => ({
  authPlugin: Object.assign(async (app: any) => {
    app.decorateRequest("ctx", undefined);
    app.addHook("onRequest", async (req: any) => {
      const auth = req.headers?.authorization;
      if (!auth) return;
      const [, body] = auth.replace("Bearer ", "").split(".");
      const payload = JSON.parse(Buffer.from(body, "base64url").toString());
      (req as any).ctx = { tenantId: payload.tid, actorId: payload.sub, roles: payload.roles || [], correlationId: "c", sessionId: "s", actorType: "user" };
    });
  }, { [Symbol.for("skip-override")]: true, [Symbol.for("fastify.display-name")]: "civitasone-auth" }),
}));
vi.mock("@civitasone/auth/context", () => {
  class AuthContextError extends Error { status: number; code: string; constructor(s: number, c: string, m: string) { super(m); this.status = s; this.code = c; } }
  return {
    resolveServiceContext: (req: any) => { if (!req.ctx) throw new AuthContextError(401, "UNAUTHENTICATED", "missing"); return req.ctx; },
    AuthContextError,
  };
});
vi.mock("@civitasone/auth", () => ({
  signToken: vi.fn(),
  hasAnyRole: (ctx: any, roles: string[]) => roles.some((r: string) => ctx.roles?.includes(r)),
}));

describe("Gap 4 — issueClose route", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    const { buildApp } = await import("../src/app.js");
    app = await buildApp();
  });
  afterAll(async () => { await app.close(); });

  it("POST /v1/works/execution/issues/:id/close → 202", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/works/execution/issues/00000000-8888-4000-8000-000000000001/close",
      headers: { authorization: `Bearer ${bearerToken(jwtPayload(TENANT_A, ["works_operator"]))}` },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe("accepted");
  });
});

describe("Gap 5 — Reporting filters and pagination", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    const { buildApp } = await import("../src/app.js");
    app = await buildApp();
  });
  afterAll(async () => { await app.close(); });

  beforeEach(() => {
    countProposals.mockReset();
    countClosures.mockReset();
    proposalStatusCounts.mockReset();
    listProposalsForReport.mockReset();
  });

  it("summary passes date/office filters to repo", async () => {
    countProposals.mockResolvedValue(10);
    countClosures.mockResolvedValue(2);
    const divisionId = "00000000-dddd-4000-8000-000000000001";
    await app.inject({
      method: "GET",
      url: `/v1/works/reports/summary?fromDate=2026-01-01T00:00:00.000Z&toDate=2026-12-31T23:59:59.000Z&divisionId=${divisionId}`,
      headers: { authorization: `Bearer ${bearerToken(jwtPayload(TENANT_A, ["works_viewer"]))}` },
    });
    expect(countProposals).toHaveBeenCalledWith(TENANT_A, expect.objectContaining({ divisionId }));
  });

  it("GET /v1/works/reports/works returns paginated data", async () => {
    listProposalsForReport.mockResolvedValue([{ id: WORK_ID, status: "draft" }]);
    const res = await app.inject({
      method: "GET",
      url: "/v1/works/reports/works?page=2&pageSize=10",
      headers: { authorization: `Bearer ${bearerToken(jwtPayload(TENANT_A, ["works_admin"]))}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().meta.page).toBe(2);
    expect(listProposalsForReport).toHaveBeenCalled();
  });
});

describe("Gap 6 — Bid confidentiality", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    const { buildApp } = await import("../src/app.js");
    app = await buildApp();
  });
  afterAll(async () => { await app.close(); });

  const sampleQuote = {
    id: "q-1",
    contractorName: "Secret Bidder Pvt Ltd",
    method: "item_rate",
    quotedAmountMinor: 5000000n,
    quotedPercentage: "5",
    aboveOrBelowOrAtPar: "below",
  };

  it("canViewBidDetails denies works_viewer", () => {
    expect(canViewBidDetails(["works_viewer"])).toBe(false);
    expect(canViewBidDetails(["works_operator"])).toBe(true);
  });

  it("redactQuotation masks amounts for viewers", () => {
    const redacted = redactQuotation(sampleQuote, false);
    expect(redacted.contractorName).toBe("Bidder (confidential)");
    expect(redacted.quotedAmountMinor).toBeNull();
  });

  it("GET quotations redacts for works_viewer", async () => {
    listQuotations.mockResolvedValue([sampleQuote]);
    const res = await app.inject({
      method: "GET",
      url: "/v1/works/tenders/00000000-tend-4000-8000-000000000001/quotations",
      headers: { authorization: `Bearer ${bearerToken(jwtPayload(TENANT_A, ["works_viewer"]))}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data[0].quotedAmountMinor).toBeNull();
    expect(res.json().data[0].contractorName).toBe("Bidder (confidential)");
  });

  it("GET quotations shows full data for works_operator", async () => {
    listQuotations.mockResolvedValue([sampleQuote]);
    const res = await app.inject({
      method: "GET",
      url: "/v1/works/tenders/00000000-tend-4000-8000-000000000001/quotations",
      headers: { authorization: `Bearer ${bearerToken(jwtPayload(TENANT_A, ["works_operator"]))}` },
    });
    expect(res.json().data[0].contractorName).toBe("Secret Bidder Pvt Ltd");
    expect(res.json().data[0].quotedAmountMinor).toBe("5000000");
  });
});
