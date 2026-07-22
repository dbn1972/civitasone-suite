/**
 * Billing Service — All Routes Coverage Test
 *
 * Comprehensive route inject tests for all billing-service modules.
 * Uses in-memory Fastify injection (no network, no real DB).
 *
 * Tests: plans, subscriptions, usage, invoices, payments, checkout,
 * einvoice, revenue, gstn, gateways, churn
 */
import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { signToken } from "@civitasone/auth";

const JWT_SECRET = "test_secret_for_civitasone_32chr";
const TENANT_ID = "aaaaaaaa-1111-4000-8000-000000000099";
const ACTOR_ID = "11111111-1111-1111-1111-111111111111";
const PLAN_ID = "22222222-2222-2222-2222-222222222222";
const SUB_ID = "33333333-3333-3333-3333-333333333333";
const INVOICE_ID = "44444444-4444-4444-4444-444444444444";
const PAYMENT_ID = "55555555-5555-5555-5555-555555555555";
const APPROVAL_ID = "66666666-6666-6666-6666-666666666666";
const LEDGER_ID = "77777777-7777-7777-7777-777777777777";

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
    sqlClient: { end: async () => {} },
    scopedRead: async (fn: (tx: unknown) => Promise<unknown>) => fn({ select, insert, update }),
  };
});

vi.mock("../src/shared/infra.js", () => ({
  cache: {
    getOrLoad: async <T>(_k: string, loader: () => Promise<T>) => loader(),
    put: async () => {},
    invalidate: async () => {},
    invalidateAfterCommit: async () => {},
    invalidateResource: async () => {},
    makeKey: (...args: string[]) => args.join(":"),
  },
  queue: { publish: async () => {} },
}));
vi.mock("../src/shared/outbox.js", () => ({ enqueue: async () => {}, markProcessed: async () => {} }));

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
      return { tenantId: decoded.tid, actorId: decoded.sub, roles: decoded.roles ?? [], sessionId: decoded.sid ?? "s", correlationId: "corr-1" };
    },
    AuthContextError,
  };
});

vi.mock("@civitasone/auth", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@civitasone/auth")>();
  return {
    ...orig,
    hasAnyRole: (ctx: { roles: string[] }, required: string[]) => required.some((r) => ctx.roles.includes(r)),
    idempotentId: () => "idem-id-001",
  };
});

// ─── Repo mocks ──────────────────────────────────────────────────
vi.mock("../src/modules/plans/repo.js", () => ({
  list: async () => mockState.queryResult,
  findById: async () => mockState.queryResult[0] ?? null,
  insert: async () => {},
}));

vi.mock("../src/modules/subscriptions/repo.js", () => ({
  findByTenant: async () => mockState.queryResult[0] ?? null,
  insertSub: async () => {},
  insertTrial: async () => {},
  updateStatus: async () => {},
  findByIdTx: async () => mockState.queryResult[0] ?? null,
}));

vi.mock("../src/modules/usage/repo.js", () => ({
  getMonthlySummary: async () => ({ tenantId: TENANT_ID, periodMonth: "2026-07", metrics: [] }),
  insertEvent: async () => {},
  upsertAggregate: async () => {},
}));

vi.mock("../src/modules/invoices/repo.js", () => ({
  listByTenant: async () => mockState.queryResult,
  findById: async () => mockState.queryResult[0] ?? undefined,
  itemsByInvoice: async () => [],
  approvalsByInvoice: async () => [],
  outstandingByTenant: async () => ({ billedMinor: 0n, paidMinor: 0n, outstandingMinor: 0n, openCount: 0 }),
  insertInvoice: async () => {},
  insertItem: async () => {},
  updateInvoice: async () => {},
  insertApproval: async () => {},
}));

vi.mock("../src/modules/payments/repo.js", () => ({
  listByInvoice: async () => mockState.queryResult,
  listByTenant: async () => mockState.queryResult,
  insertPayment: async () => {},
  insertGatewayTxn: async () => {},
}));

vi.mock("../src/modules/einvoice/repo.js", () => ({
  findByInvoiceId: async () => mockState.queryResult[0] ?? undefined,
  findById: async () => mockState.queryResult[0] ?? undefined,
  insertRequest: async () => {},
  updateRequest: async () => {},
}));

vi.mock("../src/modules/revenue/repo.js", () => ({
  listLedgers: async () => ({ data: mockState.queryResult, meta: { page: 1, pageSize: 20, total: mockState.queryResult.length } }),
  getLedgerById: async () => mockState.queryResult[0] ?? null,
  getAccrualsForLedger: async () => [],
}));

// ─── Command mocks ───────────────────────────────────────────────
vi.mock("../src/modules/plans/commands.js", () => ({
  createPlan: async () => ({ id: PLAN_ID, status: "accepted", correlationId: "corr-1" }),
}));

vi.mock("../src/modules/subscriptions/commands.js", () => ({
  createSubscription: async () => ({ id: SUB_ID, status: "accepted", correlationId: "corr-1" }),
  activateSubscription: async () => ({ id: SUB_ID, status: "accepted", correlationId: "corr-1" }),
  cancelSubscription: async () => ({ id: SUB_ID, status: "accepted", correlationId: "corr-1" }),
}));

vi.mock("../src/modules/usage/commands.js", () => ({
  recordUsage: async () => ({ id: "usage-id", status: "accepted", correlationId: "corr-1" }),
}));

vi.mock("../src/modules/invoices/commands.js", () => ({
  generateInvoice: async () => ({ id: INVOICE_ID, status: "accepted", correlationId: "corr-1" }),
  createInvoice: async () => ({ id: INVOICE_ID, status: "accepted", correlationId: "corr-1" }),
  requestIssue: async () => ({ id: INVOICE_ID, status: "accepted", correlationId: "corr-1", requiresApproval: false }),
  requestCancel: async () => ({ id: INVOICE_ID, status: "accepted", correlationId: "corr-1", requiresApproval: false }),
  decideApproval: async () => ({ id: APPROVAL_ID, status: "accepted", correlationId: "corr-1" }),
  payInvoice: async () => ({ id: INVOICE_ID, status: "accepted", correlationId: "corr-1" }),
}));

vi.mock("../src/modules/payments/commands.js", () => ({
  recordPayment: async () => ({ id: PAYMENT_ID, status: "accepted", correlationId: "corr-1" }),
}));

vi.mock("../src/modules/einvoice/commands.js", () => ({
  generateEInvoice: async () => ({ id: "einv-id", status: "accepted", correlationId: "corr-1" }),
  cancelEInvoice: async () => ({ id: "einv-id", status: "accepted", correlationId: "corr-1" }),
}));

vi.mock("../src/modules/revenue/commands.js", () => ({
  createRevenueLedger: async () => ({ id: LEDGER_ID, status: "accepted", correlationId: "corr-1" }),
  processAccrual: async () => ({ id: "accrual-id", status: "accepted", correlationId: "corr-1" }),
}));

// ─── Checkout/Razorpay mocks ─────────────────────────────────────
vi.mock("../src/modules/payments/razorpay.js", () => ({
  createOrder: async () => ({ id: "order_rpay_001", amount: 100000, currency: "INR" }),
  verifyPaymentSignature: () => true,
  verifyWebhookSignature: () => true,
  getPublicKeyId: () => "rzp_test_key",
  fetchPayment: async () => ({ id: "pay_001", status: "captured" }),
}));

vi.mock("../src/modules/payments/checkout-validators.js", () => ({
  checkoutBody: { parse: (b: unknown) => b },
  verifyPaymentBody: { parse: (b: unknown) => b },
}));

// ─── GSTN adapter mock ───────────────────────────────────────────
vi.mock("../src/modules/gstn/adapter.js", () => ({
  submitGstReturn: async () => ({ referenceId: "ref-001", status: "submitted", gstin: "29ABCDE1234F1Z5", returnPeriod: "07/2026", submittedAt: "2026-07-15T10:00:00Z" }),
  verifyGstin: async () => ({ gstin: "29ABCDE1234F1Z5", legalName: "Test Corp", tradeName: "Test", status: "active", registrationDate: "2020-01-01", lastUpdated: "2026-07-01" }),
  fetchReturnStatus: async () => ({ referenceId: "ref-001", status: "filed", returnPeriod: "07/2026", filedAt: "2026-07-16T10:00:00Z" }),
  GstnAdapterError: class extends Error { code: string; constructor(m: string, c: string) { super(m); this.code = c; } },
  CircuitBreakerOpenError: class extends Error { constructor() { super("circuit open"); } },
  isEnabled: () => true,
  getBreakerState: () => "closed",
}));

// ─── Gateway mocks ───────────────────────────────────────────────
vi.mock("../src/modules/gateways/index.js", () => ({
  createOrder: async () => ({ gatewayOrderId: "gw_order_001", gateway: "razorpay", amount: 100000n, currency: "INR", status: "created" }),
  checkStatus: async () => ({ gatewayOrderId: "gw_order_001", gateway: "razorpay", status: "authorized", amountPaise: 100000n, currency: "INR", method: "card", errorCode: null, errorMessage: null, updatedAt: "2026-07-15T10:00:00Z" }),
  capturePayment: async () => ({ gatewayOrderId: "gw_order_001", gateway: "razorpay", capturedAmount: 100000n, currency: "INR", status: "captured", capturedAt: "2026-07-15T10:01:00Z", errorCode: null, errorMessage: null }),
  GatewayError: class extends Error { code: string; gateway: string; isClientError: boolean; constructor(m: string, c: string, g: string) { super(m); this.code = c; this.gateway = g; this.isClientError = false; } },
  CircuitBreakerOpenError: class extends Error { constructor() { super("circuit open"); } },
}));

vi.mock("../src/modules/gateways/upi-autopay.js", () => ({
  executeUpiPayment: async () => ({ executionId: "upi-exec-001", mandateId: "mandate-001", amount: 100000n, status: "initiated" }),
  executeEmandateDebit: async () => ({ executionId: "em-exec-001", mandateId: "mandate-002", amount: 100000n, status: "initiated" }),
  isUpiEnabled: () => true,
  isEmandateEnabled: () => true,
}));

vi.mock("../src/modules/gateways/types.js", () => ({
  GatewayError: class extends Error { code: string; gateway: string; isClientError: boolean; constructor(m: string, c: string, g: string) { super(m); this.code = c; this.gateway = g; this.isClientError = false; } },
}));

vi.mock("../src/modules/gateways/validators.js", () => ({
  initiatePaymentBody: { parse: (b: unknown) => b },
  paymentIdParam: { parse: (p: unknown) => p },
}));

// ─── Churn adapter mock ──────────────────────────────────────────
vi.mock("../src/modules/churn/adapter.js", () => ({
  predictChurn: async () => ({ prediction: 0.35, factors: [{ feature: "payment_delay", contribution: 0.2, direction: "positive" }], confidence: 0.8, fallback: false, advisory: true }),
  CircuitBreakerOpenError: class extends Error { constructor() { super("circuit open"); } },
}));

// ─── Infra mocks ─────────────────────────────────────────────────
vi.mock("../src/topics.js", () => ({
  COMMANDS: {
    planCreate: "billing.plan.create",
    subscriptionCreate: "billing.subscription.create",
    subscriptionActivate: "billing.subscription.activate",
    subscriptionCancel: "billing.subscription.cancel",
    usageRecord: "billing.usage.record",
    invoiceGenerate: "billing.invoice.generate",
    invoiceCreate: "billing.invoice.create",
    invoiceIssue: "billing.invoice.issue",
    invoiceRequestIssue: "billing.invoice.request_issue",
    invoiceRequestCancel: "billing.invoice.request_cancel",
    invoiceApprovalDecide: "billing.invoice.approval_decide",
    invoiceCancel: "billing.invoice.cancel",
    invoicePay: "billing.invoice.pay",
    paymentRecord: "billing.payment.record",
    checkoutCreate: "billing.checkout.create",
    checkoutVerify: "billing.checkout.verify",
    webhookRazorpay: "billing.webhook.razorpay",
  },
  EVENTS: {},
  CONSUMED_EVENTS: {},
  SERVICE: "billing",
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
vi.mock("@civitasone/circuit-breaker", () => ({
  CircuitBreaker: class { call = async (fn: () => Promise<unknown>) => fn(); state = "closed"; },
  CircuitBreakerOpenError: class extends Error { constructor() { super("circuit open"); } },
}));

// ─── Token helpers ────────────────────────────────────────────────
function makeToken(roles: string[] = ["super_admin"]): string {
  return signToken({ sub: ACTOR_ID, tid: TENANT_ID, roles, sid: "sess-1" }, JWT_SECRET, 3600);
}
const ADMIN_TOKEN = () => makeToken(["super_admin"]);
const BILLING_TOKEN = () => makeToken(["billing_admin"]);
const FINANCE_TOKEN = () => makeToken(["finance_officer"]);
const TENANT_ADMIN_TOKEN = () => makeToken(["tenant_admin"]);
const NO_ROLE_TOKEN = () => makeToken(["employee"]);

// ─── Seed data ────────────────────────────────────────────────────
const SEED_PLAN = {
  id: PLAN_ID, name: "Starter", code: "starter", priceMinor: "100000",
  currency: "INR", govtExempt: false, active: true,
};

const SEED_SUB = {
  id: SUB_ID, tenantId: TENANT_ID, planId: PLAN_ID, status: "active", trialExpiresAt: null,
};

const SEED_INVOICE = {
  id: INVOICE_ID, tenantId: TENANT_ID, periodMonth: "2026-07", status: "issued",
  totalMinor: 100000n, paidMinor: 0n, taxMinor: 18000n, chargesMinor: 0n,
  currency: "INR", issuedAt: "2026-07-01", paidAt: null, cancelledAt: null,
  cancelReason: null, issuedBy: ACTOR_ID, cancelledBy: null,
};

const SEED_PAYMENT = {
  id: PAYMENT_ID, tenantId: TENANT_ID, invoiceId: INVOICE_ID,
  amountMinor: 100000n, currency: "INR", method: "razorpay",
  status: "captured", receiptNo: "REC-001", reference: "pay_ref_001",
  receivedAt: "2026-07-15T10:00:00Z",
};

const SEED_EINVOICE = {
  id: "einv-001", tenantId: TENANT_ID, invoiceId: INVOICE_ID,
  irn: "IRN123456", ackNo: "ACK001", ackDate: "2026-07-01",
  signedQrCode: "qr-data", status: "generated", errorMessage: null,
  cancelledAt: null, cancelReason: null,
  createdAt: new Date("2026-07-01"), updatedAt: new Date("2026-07-01"),
};

const SEED_LEDGER = {
  id: LEDGER_ID, tenantId: TENANT_ID, subscriptionId: SUB_ID,
  totalAmountPaise: "1200000", servicePeriodStart: "2026-01-01",
  servicePeriodEnd: "2026-12-31", totalDays: 365,
  recognizedPaise: "600000", deferredPaise: "600000",
  status: "active", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-07-01T00:00:00Z",
};

// ═══════════════════════════════════════════════════════════════════
// 1. Plans Routes
// ═══════════════════════════════════════════════════════════════════
describe("Plans Routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { plansRoutes } = await import("../src/modules/plans/routes.js");
    app = Fastify({ logger: false });
    const { authPlugin } = await import("@civitasone/auth/plugin");
    await app.register(authPlugin);
    await app.register(plansRoutes);
    await app.ready();
  });
  afterAll(async () => { await app.close(); });

  beforeEach(() => {
    mockState.queryResult = [SEED_PLAN];
  });

  describe("POST /v1/billing/plans", () => {
    it("returns 202 for valid body", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/billing/plans",
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: { name: "Pro", code: "pro", priceMinor: 500000, currency: "INR" },
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 401 without token", async () => {
      const res = await app.inject({ method: "POST", url: "/v1/billing/plans", payload: {} });
      expect(res.statusCode).toBe(401);
    });

    it("returns 403 for insufficient role", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/billing/plans",
        headers: { authorization: `Bearer ${NO_ROLE_TOKEN()}` },
        payload: { name: "Pro", code: "pro", priceMinor: 500000, currency: "INR" },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe("GET /v1/billing/plans (public)", () => {
    it("returns 200 without auth", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/billing/plans" });
      expect(res.statusCode).toBe(200);
    });
  });

  describe("GET /v1/billing/plans/:id (public)", () => {
    it("returns 200 when found", async () => {
      const res = await app.inject({ method: "GET", url: `/v1/billing/plans/${PLAN_ID}` });
      expect(res.statusCode).toBe(200);
    });

    it("returns 404 when not found", async () => {
      mockState.queryResult = [];
      const res = await app.inject({ method: "GET", url: `/v1/billing/plans/${PLAN_ID}` });
      expect(res.statusCode).toBe(404);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. Subscriptions Routes
// ═══════════════════════════════════════════════════════════════════
describe("Subscriptions Routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { subscriptionsRoutes } = await import("../src/modules/subscriptions/routes.js");
    app = Fastify({ logger: false });
    const { authPlugin } = await import("@civitasone/auth/plugin");
    await app.register(authPlugin);
    await app.register(subscriptionsRoutes);
    await app.ready();
  });
  afterAll(async () => { await app.close(); });

  beforeEach(() => {
    mockState.queryResult = [SEED_SUB];
  });

  describe("POST /v1/billing/subscriptions", () => {
    it("returns 202 for valid body", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/billing/subscriptions",
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: { tenantId: TENANT_ID, planId: PLAN_ID },
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 401 without token", async () => {
      const res = await app.inject({ method: "POST", url: "/v1/billing/subscriptions", payload: {} });
      expect(res.statusCode).toBe(401);
    });

    it("returns 403 for insufficient role", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/billing/subscriptions",
        headers: { authorization: `Bearer ${NO_ROLE_TOKEN()}` },
        payload: { tenantId: TENANT_ID, planId: PLAN_ID },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe("PATCH /v1/billing/subscriptions/:id/activate", () => {
    it("returns 202 for valid request", async () => {
      const res = await app.inject({
        method: "PATCH", url: `/v1/billing/subscriptions/${SUB_ID}/activate`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 401 without token", async () => {
      const res = await app.inject({ method: "PATCH", url: `/v1/billing/subscriptions/${SUB_ID}/activate` });
      expect(res.statusCode).toBe(401);
    });
  });

  describe("PATCH /v1/billing/subscriptions/:id/cancel", () => {
    it("returns 202 for valid request", async () => {
      const res = await app.inject({
        method: "PATCH", url: `/v1/billing/subscriptions/${SUB_ID}/cancel`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
      });
      expect(res.statusCode).toBe(202);
    });
  });

  describe("GET /v1/billing/tenants/:id/subscription", () => {
    it("returns 200 when found", async () => {
      const res = await app.inject({
        method: "GET", url: `/v1/billing/tenants/${TENANT_ID}/subscription`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
      });
      expect(res.statusCode).toBe(200);
    });

    it("returns 404 when not found", async () => {
      mockState.queryResult = [];
      const res = await app.inject({
        method: "GET", url: `/v1/billing/tenants/${TENANT_ID}/subscription`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("GET /v1/billing/subscriptions", () => {
    it("returns 200 for admin", async () => {
      const res = await app.inject({
        method: "GET", url: "/v1/billing/subscriptions",
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
      });
      expect(res.statusCode).toBe(200);
    });

    it("returns 401 without token", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/billing/subscriptions" });
      expect(res.statusCode).toBe(401);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. Usage Routes
// ═══════════════════════════════════════════════════════════════════
describe("Usage Routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { usageRoutes } = await import("../src/modules/usage/routes.js");
    app = Fastify({ logger: false });
    const { authPlugin } = await import("@civitasone/auth/plugin");
    await app.register(authPlugin);
    await app.register(usageRoutes);
    await app.ready();
  });
  afterAll(async () => { await app.close(); });

  describe("POST /v1/billing/usage", () => {
    it("returns 202 for valid body", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/billing/usage",
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: { tenantId: TENANT_ID, metricKey: "api_calls", quantity: 100 },
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 401 without token", async () => {
      const res = await app.inject({ method: "POST", url: "/v1/billing/usage", payload: {} });
      expect(res.statusCode).toBe(401);
    });

    it("returns 403 for insufficient role", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/billing/usage",
        headers: { authorization: `Bearer ${NO_ROLE_TOKEN()}` },
        payload: { tenantId: TENANT_ID, metricKey: "api_calls", quantity: 100 },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe("GET /v1/billing/tenants/:id/usage", () => {
    it("returns 200 for admin", async () => {
      const res = await app.inject({
        method: "GET", url: `/v1/billing/tenants/${TENANT_ID}/usage?month=2026-07`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
      });
      expect(res.statusCode).toBe(200);
    });

    it("returns 401 without token", async () => {
      const res = await app.inject({ method: "GET", url: `/v1/billing/tenants/${TENANT_ID}/usage?month=2026-07` });
      expect(res.statusCode).toBe(401);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. Invoices Routes
// ═══════════════════════════════════════════════════════════════════
describe("Invoices Routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { invoicesRoutes } = await import("../src/modules/invoices/routes.js");
    app = Fastify({ logger: false });
    const { authPlugin } = await import("@civitasone/auth/plugin");
    await app.register(authPlugin);
    await app.register(invoicesRoutes);
    await app.ready();
  });
  afterAll(async () => { await app.close(); });

  beforeEach(() => {
    mockState.queryResult = [SEED_INVOICE];
  });

  describe("POST /v1/billing/invoices/generate", () => {
    it("returns 202 for valid body", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/billing/invoices/generate",
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: { tenantId: TENANT_ID, periodMonth: "2026-07" },
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 401 without token", async () => {
      const res = await app.inject({ method: "POST", url: "/v1/billing/invoices/generate", payload: {} });
      expect(res.statusCode).toBe(401);
    });

    it("returns 403 for insufficient role", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/billing/invoices/generate",
        headers: { authorization: `Bearer ${NO_ROLE_TOKEN()}` },
        payload: { tenantId: TENANT_ID, periodMonth: "2026-07" },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe("POST /v1/billing/invoices", () => {
    it("returns 202 for valid body", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/billing/invoices",
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: { tenantId: TENANT_ID, periodMonth: "2026-07", items: [{ description: "API usage", kind: "line", quantity: 1, amountMinor: 100000 }] },
      });
      expect(res.statusCode).toBe(202);
    });
  });

  describe("PATCH /v1/billing/invoices/:id/issue", () => {
    it("returns 202 for valid request", async () => {
      const res = await app.inject({
        method: "PATCH", url: `/v1/billing/invoices/${INVOICE_ID}/issue`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 404 when invoice not found", async () => {
      mockState.queryResult = [];
      const res = await app.inject({
        method: "PATCH", url: `/v1/billing/invoices/${INVOICE_ID}/issue`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("PATCH /v1/billing/invoices/:id/cancel", () => {
    it("returns 202 for valid request", async () => {
      const res = await app.inject({
        method: "PATCH", url: `/v1/billing/invoices/${INVOICE_ID}/cancel`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: { reason: "Duplicate billing" },
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 404 when invoice not found", async () => {
      mockState.queryResult = [];
      const res = await app.inject({
        method: "PATCH", url: `/v1/billing/invoices/${INVOICE_ID}/cancel`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: { reason: "Test" },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("PATCH /v1/billing/invoices/:id/approvals/:approvalId", () => {
    it("returns 202 for valid approval decision", async () => {
      const res = await app.inject({
        method: "PATCH", url: `/v1/billing/invoices/${INVOICE_ID}/approvals/${APPROVAL_ID}`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: { approve: true, reason: "Looks good" },
      });
      expect(res.statusCode).toBe(202);
    });
  });

  describe("PATCH /v1/billing/invoices/:id/pay", () => {
    it("returns 202 for valid pay request", async () => {
      const res = await app.inject({
        method: "PATCH", url: `/v1/billing/invoices/${INVOICE_ID}/pay`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 404 when invoice not found", async () => {
      mockState.queryResult = [];
      const res = await app.inject({
        method: "PATCH", url: `/v1/billing/invoices/${INVOICE_ID}/pay`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("GET /v1/billing/invoices/:id", () => {
    it("returns 200 when found", async () => {
      const res = await app.inject({
        method: "GET", url: `/v1/billing/invoices/${INVOICE_ID}`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
      });
      expect(res.statusCode).toBe(200);
    });

    it("returns 404 when not found", async () => {
      mockState.queryResult = [];
      const res = await app.inject({
        method: "GET", url: `/v1/billing/invoices/${INVOICE_ID}`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("GET /v1/billing/tenants/:id/outstanding", () => {
    it("returns 200 for admin", async () => {
      const res = await app.inject({
        method: "GET", url: `/v1/billing/tenants/${TENANT_ID}/outstanding`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
      });
      expect(res.statusCode).toBe(200);
    });
  });

  describe("GET /v1/billing/tenants/:id/invoices", () => {
    it("returns 200 for admin", async () => {
      const res = await app.inject({
        method: "GET", url: `/v1/billing/tenants/${TENANT_ID}/invoices`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
      });
      expect(res.statusCode).toBe(200);
    });
  });

  describe("GET /v1/billing/invoices", () => {
    it("returns 200 for billing_admin role", async () => {
      const res = await app.inject({
        method: "GET", url: "/v1/billing/invoices",
        headers: { authorization: `Bearer ${BILLING_TOKEN()}` },
      });
      expect(res.statusCode).toBe(200);
    });

    it("returns 403 for employee role", async () => {
      const res = await app.inject({
        method: "GET", url: "/v1/billing/invoices",
        headers: { authorization: `Bearer ${NO_ROLE_TOKEN()}` },
      });
      expect(res.statusCode).toBe(403);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. Payments Routes
// ═══════════════════════════════════════════════════════════════════
describe("Payments Routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { paymentsRoutes } = await import("../src/modules/payments/routes.js");
    app = Fastify({ logger: false });
    const { authPlugin } = await import("@civitasone/auth/plugin");
    await app.register(authPlugin);
    await app.register(paymentsRoutes);
    await app.ready();
  });
  afterAll(async () => { await app.close(); });

  beforeEach(() => {
    mockState.queryResult = [SEED_PAYMENT];
  });

  describe("POST /v1/billing/payments", () => {
    it("returns 202 for valid body", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/billing/payments",
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: { tenantId: TENANT_ID, invoiceId: INVOICE_ID, amountMinor: 100000, method: "razorpay", gateway: "razorpay" },
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 401 without token", async () => {
      const res = await app.inject({ method: "POST", url: "/v1/billing/payments", payload: {} });
      expect(res.statusCode).toBe(401);
    });

    it("returns 403 for insufficient role", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/billing/payments",
        headers: { authorization: `Bearer ${NO_ROLE_TOKEN()}` },
        payload: { tenantId: TENANT_ID, invoiceId: INVOICE_ID, amountMinor: 100000, method: "razorpay" },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe("GET /v1/billing/invoices/:id/payments", () => {
    it("returns 200 for admin", async () => {
      const res = await app.inject({
        method: "GET", url: `/v1/billing/invoices/${INVOICE_ID}/payments`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
      });
      expect(res.statusCode).toBe(200);
    });
  });

  describe("GET /v1/billing/tenants/:id/payments", () => {
    it("returns 200 for admin", async () => {
      const res = await app.inject({
        method: "GET", url: `/v1/billing/tenants/${TENANT_ID}/payments`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
      });
      expect(res.statusCode).toBe(200);
    });
  });

  describe("GET /v1/billing/payments", () => {
    it("returns 200 for billing_admin role", async () => {
      const res = await app.inject({
        method: "GET", url: "/v1/billing/payments",
        headers: { authorization: `Bearer ${BILLING_TOKEN()}` },
      });
      expect(res.statusCode).toBe(200);
    });

    it("returns 403 for employee role", async () => {
      const res = await app.inject({
        method: "GET", url: "/v1/billing/payments",
        headers: { authorization: `Bearer ${NO_ROLE_TOKEN()}` },
      });
      expect(res.statusCode).toBe(403);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// 6. Checkout Routes
// ═══════════════════════════════════════════════════════════════════
describe("Checkout Routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { checkoutRoutes } = await import("../src/modules/payments/checkout-routes.js");
    app = Fastify({ logger: false });
    const { authPlugin } = await import("@civitasone/auth/plugin");
    await app.register(authPlugin);
    await app.register(checkoutRoutes);
    await app.ready();
  });
  afterAll(async () => { await app.close(); });

  beforeEach(() => {
    mockState.queryResult = [{ priceMinor: 100000n, currency: "INR" }];
  });

  describe("POST /v1/billing/checkout", () => {
    it("returns 200 for valid checkout", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/billing/checkout",
        headers: { authorization: `Bearer ${TENANT_ADMIN_TOKEN()}` },
        payload: { planId: PLAN_ID, billingCycle: "monthly" },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().orderId).toBeDefined();
    });

    it("returns 401 without token", async () => {
      const res = await app.inject({ method: "POST", url: "/v1/billing/checkout", payload: { planId: PLAN_ID, billingCycle: "monthly" } });
      expect(res.statusCode).toBe(401);
    });

    it("returns 403 for employee role", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/billing/checkout",
        headers: { authorization: `Bearer ${NO_ROLE_TOKEN()}` },
        payload: { planId: PLAN_ID, billingCycle: "monthly" },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe("POST /v1/billing/payments/verify", () => {
    it("returns 202 for valid signature", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/billing/payments/verify",
        headers: { authorization: `Bearer ${TENANT_ADMIN_TOKEN()}` },
        payload: { razorpayOrderId: "order_001", razorpayPaymentId: "pay_001", razorpaySignature: "sig_valid" },
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 401 without token", async () => {
      const res = await app.inject({ method: "POST", url: "/v1/billing/payments/verify", payload: {} });
      expect(res.statusCode).toBe(401);
    });
  });

  describe("POST /v1/billing/webhooks/razorpay", () => {
    it("returns 200 for valid webhook", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/billing/webhooks/razorpay",
        headers: { "x-razorpay-signature": "valid_sig" },
        payload: { event: "payment.captured", payload: { payment: { id: "pay_001" } } },
      });
      expect(res.statusCode).toBe(200);
    });

    it("returns 400 without signature header", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/billing/webhooks/razorpay",
        payload: { event: "payment.captured" },
      });
      expect(res.statusCode).toBe(400);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// 7. eInvoice Routes
// ═══════════════════════════════════════════════════════════════════
describe("eInvoice Routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { einvoiceRoutes } = await import("../src/modules/einvoice/routes.js");
    app = Fastify({ logger: false });
    const { authPlugin } = await import("@civitasone/auth/plugin");
    await app.register(authPlugin);
    await app.register(einvoiceRoutes);
    await app.ready();
  });
  afterAll(async () => { await app.close(); });

  beforeEach(() => {
    mockState.queryResult = [SEED_EINVOICE];
  });

  describe("POST /v1/billing/invoices/:id/generate-irn", () => {
    it("returns 202 for valid request", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/billing/invoices/${INVOICE_ID}/generate-irn`,
        headers: { authorization: `Bearer ${BILLING_TOKEN()}` },
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 401 without token", async () => {
      const res = await app.inject({ method: "POST", url: `/v1/billing/invoices/${INVOICE_ID}/generate-irn` });
      expect(res.statusCode).toBe(401);
    });

    it("returns 403 for employee role", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/billing/invoices/${INVOICE_ID}/generate-irn`,
        headers: { authorization: `Bearer ${NO_ROLE_TOKEN()}` },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe("POST /v1/billing/invoices/:id/cancel-irn", () => {
    it("returns 202 for valid request", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/billing/invoices/${INVOICE_ID}/cancel-irn`,
        headers: { authorization: `Bearer ${BILLING_TOKEN()}` },
        payload: { reason: "Incorrect details" },
      });
      expect(res.statusCode).toBe(202);
    });
  });

  describe("GET /v1/billing/invoices/:id/einvoice", () => {
    it("returns 200 when found", async () => {
      const res = await app.inject({
        method: "GET", url: `/v1/billing/invoices/${INVOICE_ID}/einvoice`,
        headers: { authorization: `Bearer ${BILLING_TOKEN()}` },
      });
      expect(res.statusCode).toBe(200);
    });

    it("returns 404 when not found", async () => {
      mockState.queryResult = [];
      const res = await app.inject({
        method: "GET", url: `/v1/billing/invoices/${INVOICE_ID}/einvoice`,
        headers: { authorization: `Bearer ${BILLING_TOKEN()}` },
      });
      expect(res.statusCode).toBe(404);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// 8. Revenue Routes
// ═══════════════════════════════════════════════════════════════════
describe("Revenue Routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { revenueRoutes } = await import("../src/modules/revenue/routes.js");
    app = Fastify({ logger: false });
    const { authPlugin } = await import("@civitasone/auth/plugin");
    await app.register(authPlugin);
    await app.register(revenueRoutes);
    await app.ready();
  });
  afterAll(async () => { await app.close(); });

  beforeEach(() => {
    mockState.queryResult = [SEED_LEDGER];
  });

  describe("POST /v1/billing/revenue/ledgers", () => {
    it("returns 202 for valid body", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/billing/revenue/ledgers",
        headers: { authorization: `Bearer ${FINANCE_TOKEN()}` },
        payload: { subscriptionId: SUB_ID, totalAmountPaise: "1200000", servicePeriodStart: "2026-01-01", servicePeriodEnd: "2026-12-31" },
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 401 without token", async () => {
      const res = await app.inject({ method: "POST", url: "/v1/billing/revenue/ledgers", payload: {} });
      expect(res.statusCode).toBe(401);
    });

    it("returns 403 for employee role", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/billing/revenue/ledgers",
        headers: { authorization: `Bearer ${NO_ROLE_TOKEN()}` },
        payload: { subscriptionId: SUB_ID, totalAmountPaise: "1200000", servicePeriodStart: "2026-01-01", servicePeriodEnd: "2026-12-31" },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe("GET /v1/billing/revenue/ledgers", () => {
    it("returns 200 for finance role", async () => {
      const res = await app.inject({
        method: "GET", url: "/v1/billing/revenue/ledgers",
        headers: { authorization: `Bearer ${FINANCE_TOKEN()}` },
      });
      expect(res.statusCode).toBe(200);
    });

    it("returns 403 for employee role", async () => {
      const res = await app.inject({
        method: "GET", url: "/v1/billing/revenue/ledgers",
        headers: { authorization: `Bearer ${NO_ROLE_TOKEN()}` },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe("GET /v1/billing/revenue/ledgers/:id", () => {
    it("returns 200 when found", async () => {
      const res = await app.inject({
        method: "GET", url: `/v1/billing/revenue/ledgers/${LEDGER_ID}`,
        headers: { authorization: `Bearer ${FINANCE_TOKEN()}` },
      });
      expect(res.statusCode).toBe(200);
    });

    it("returns 404 when not found", async () => {
      mockState.queryResult = [];
      const res = await app.inject({
        method: "GET", url: `/v1/billing/revenue/ledgers/${LEDGER_ID}`,
        headers: { authorization: `Bearer ${FINANCE_TOKEN()}` },
      });
      expect(res.statusCode).toBe(404);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// 9. GSTN Routes
// ═══════════════════════════════════════════════════════════════════
describe("GSTN Routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { gstnRoutes } = await import("../src/modules/gstn/routes.js");
    app = Fastify({ logger: false });
    const { authPlugin } = await import("@civitasone/auth/plugin");
    await app.register(authPlugin);
    await app.register(gstnRoutes);
    await app.ready();
  });
  afterAll(async () => { await app.close(); });

  describe("POST /v1/billing/gstn/returns", () => {
    it("returns 201 for valid body", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/billing/gstn/returns",
        headers: { authorization: `Bearer ${BILLING_TOKEN()}` },
        payload: {
          gstin: "29ABCDE1234F1Z5", returnPeriod: "07/2026", returnType: "GSTR1",
          totalTaxableValue: "100000", totalCgst: "9000", totalSgst: "9000", totalIgst: "0",
        },
      });
      expect(res.statusCode).toBe(201);
    });

    it("returns 401 without token", async () => {
      const res = await app.inject({ method: "POST", url: "/v1/billing/gstn/returns", payload: {} });
      expect(res.statusCode).toBe(401);
    });

    it("returns 403 for employee role", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/billing/gstn/returns",
        headers: { authorization: `Bearer ${NO_ROLE_TOKEN()}` },
        payload: {
          gstin: "29ABCDE1234F1Z5", returnPeriod: "07/2026", returnType: "GSTR1",
          totalTaxableValue: "100000", totalCgst: "9000", totalSgst: "9000", totalIgst: "0",
        },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe("GET /v1/billing/gstn/returns/:ref/status", () => {
    it("returns 200 for valid ref", async () => {
      const res = await app.inject({
        method: "GET", url: "/v1/billing/gstn/returns/ref-001/status",
        headers: { authorization: `Bearer ${BILLING_TOKEN()}` },
      });
      expect(res.statusCode).toBe(200);
    });

    it("returns 401 without token", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/billing/gstn/returns/ref-001/status" });
      expect(res.statusCode).toBe(401);
    });
  });

  describe("GET /v1/billing/gstn/gstin/:gstin/verify", () => {
    it("returns 200 for valid GSTIN", async () => {
      const res = await app.inject({
        method: "GET", url: "/v1/billing/gstn/gstin/29ABCDE1234F1Z5/verify",
        headers: { authorization: `Bearer ${BILLING_TOKEN()}` },
      });
      expect(res.statusCode).toBe(200);
    });

    it("returns 401 without token", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/billing/gstn/gstin/29ABCDE1234F1Z5/verify" });
      expect(res.statusCode).toBe(401);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// 10. Gateway Routes
// ═══════════════════════════════════════════════════════════════════
describe("Gateway Routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { gatewayRoutes } = await import("../src/modules/gateways/routes.js");
    app = Fastify({ logger: false });
    const { authPlugin } = await import("@civitasone/auth/plugin");
    await app.register(authPlugin);
    await app.register(gatewayRoutes);
    await app.ready();
  });
  afterAll(async () => { await app.close(); });

  describe("POST /v1/billing/payments/initiate", () => {
    it("returns 202 for gateway method", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/billing/payments/initiate",
        headers: { authorization: `Bearer ${BILLING_TOKEN()}` },
        payload: { method: "gateway", amountPaise: "100000", currency: "INR", invoiceId: INVOICE_ID },
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 202 for upi_autopay method", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/billing/payments/initiate",
        headers: { authorization: `Bearer ${BILLING_TOKEN()}` },
        payload: { method: "upi_autopay", amountPaise: "100000", currency: "INR", mandateId: "mandate-001" },
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 202 for emandate method", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/billing/payments/initiate",
        headers: { authorization: `Bearer ${BILLING_TOKEN()}` },
        payload: { method: "emandate", amountPaise: "100000", currency: "INR", mandateId: "mandate-002" },
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 401 without token", async () => {
      const res = await app.inject({ method: "POST", url: "/v1/billing/payments/initiate", payload: {} });
      expect(res.statusCode).toBe(401);
    });

    it("returns 403 for employee role", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/billing/payments/initiate",
        headers: { authorization: `Bearer ${NO_ROLE_TOKEN()}` },
        payload: { method: "gateway", amountPaise: "100000", currency: "INR" },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe("GET /v1/billing/payments/:id/status", () => {
    it("returns 200 for valid id", async () => {
      const res = await app.inject({
        method: "GET", url: `/v1/billing/payments/${PAYMENT_ID}/status`,
        headers: { authorization: `Bearer ${BILLING_TOKEN()}` },
      });
      expect(res.statusCode).toBe(200);
    });

    it("returns 401 without token", async () => {
      const res = await app.inject({ method: "GET", url: `/v1/billing/payments/${PAYMENT_ID}/status` });
      expect(res.statusCode).toBe(401);
    });
  });

  describe("POST /v1/billing/payments/:id/capture", () => {
    it("returns 200 for valid capture", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/billing/payments/${PAYMENT_ID}/capture`,
        headers: { authorization: `Bearer ${BILLING_TOKEN()}` },
      });
      expect(res.statusCode).toBe(200);
    });

    it("returns 401 without token", async () => {
      const res = await app.inject({ method: "POST", url: `/v1/billing/payments/${PAYMENT_ID}/capture` });
      expect(res.statusCode).toBe(401);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// 11. Churn Routes
// ═══════════════════════════════════════════════════════════════════
describe("Churn Routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { churnRoutes } = await import("../src/modules/churn/routes.js");
    app = Fastify({ logger: false });
    const { authPlugin } = await import("@civitasone/auth/plugin");
    await app.register(authPlugin);
    await app.register(churnRoutes);
    await app.ready();
  });
  afterAll(async () => { await app.close(); });

  describe("GET /v1/billing/subscriptions/:id/churn-risk", () => {
    it("returns 200 with churn data", async () => {
      const res = await app.inject({
        method: "GET", url: `/v1/billing/subscriptions/${SUB_ID}/churn-risk`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.probability).toBeDefined();
      expect(body.data.riskLevel).toBeDefined();
    });

    it("returns 401 without token", async () => {
      const res = await app.inject({ method: "GET", url: `/v1/billing/subscriptions/${SUB_ID}/churn-risk` });
      expect(res.statusCode).toBe(401);
    });
  });

  describe("GET /v1/billing/revenue/forecast", () => {
    it("returns 200 with forecast data", async () => {
      const res = await app.inject({
        method: "GET", url: "/v1/billing/revenue/forecast?horizon=6",
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.currentMrr).toBeDefined();
      expect(body.data.projectedMrr).toBeDefined();
    });

    it("returns 401 without token", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/billing/revenue/forecast?horizon=6" });
      expect(res.statusCode).toBe(401);
    });
  });

  describe("GET /v1/billing/revenue/cohorts", () => {
    it("returns 200 with cohort data", async () => {
      const res = await app.inject({
        method: "GET", url: "/v1/billing/revenue/cohorts",
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.cohorts).toBeDefined();
    });

    it("returns 401 without token", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/billing/revenue/cohorts" });
      expect(res.statusCode).toBe(401);
    });
  });
});
