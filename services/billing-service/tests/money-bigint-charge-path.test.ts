/**
 * GAP2-BILLING-CHECKOUT-01 + GAP2-BILLING-PAYMENTS-11 — money is BigInt paise in
 * the charge path, never a JS float.
 *
 * CHECKOUT-01: POST /v1/billing/checkout computed the Razorpay order amount as
 * `Number(plan.priceMinor) * (annual ? 12 : 1)` — IEEE-754 float math that loses
 * integer precision above Number.MAX_SAFE_INTEGER paise. The fix keeps the amount
 * in BigInt and serialises it as an exact integer on the wire. This test uses a
 * plan price large enough that float math would round, and asserts the amount
 * Razorpay receives equals priceMinor * 12 exactly.
 *
 * PAYMENTS-11: POST /v1/billing/payments/:id/capture published the captured
 * amount as `Number(result.capturedAmount)` (a bigint) into the paymentRecord
 * audit/reconciliation command, float-rounding large values. The fix passes the
 * exact `.toString()`. This test captures a payment above MAX_SAFE_INTEGER paise
 * and asserts the published payload carries the exact integer string.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr"; // gitleaks:allow
const TENANT = "11111111-aaaa-4000-8000-000000000001";
const ACTOR = "00000000-aaaa-4000-8000-000000000001";

function token(roles: string[] = ["billing_admin"]) {
  return signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-money" }, SECRET, 3600);
}

// A value whose exact integer form cannot be represented by an IEEE-754 double.
// Number.MAX_SAFE_INTEGER === 9007199254740991. The next odd integer above it
// rounds when passed through Number().
const BIG_PAISE = 9007199254740993n; // = MAX_SAFE_INTEGER + 2, not float-exact
const PLAN_PRICE_MINOR = 9007199254740993n;

// Capture publish payloads from the queue so we can assert exact strings.
const published: Array<{ type: string; payload: Record<string, unknown> }> = [];

vi.mock("../src/shared/infra.js", () => ({
  cache: {
    get: vi.fn().mockResolvedValue(null),
    put: vi.fn().mockResolvedValue(undefined),
    getOrLoad: vi.fn().mockResolvedValue(null),
    invalidate: vi.fn().mockResolvedValue(undefined),
  },
  queue: {
    publish: vi.fn(async (type: string, msg: { payload: Record<string, unknown> }) => {
      published.push({ type, payload: msg.payload });
    }),
    subscribe: vi.fn(),
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    healthCheck: vi.fn().mockResolvedValue({ healthy: true }),
  },
}));

// Mock the gateway facade so capturePayment returns a bigint above MAX_SAFE_INTEGER.
vi.mock("../src/modules/gateways/index.js", () => ({
  capturePayment: vi.fn(async (orderId: string) => ({
    gatewayOrderId: orderId,
    gateway: "razorpay",
    capturedAmount: BIG_PAISE,
    currency: "INR",
    status: "captured",
    capturedAt: "2026-07-15T10:00:00Z",
    errorCode: null,
    errorMessage: null,
  })),
  createOrder: vi.fn(),
  checkStatus: vi.fn(),
  refundPayment: vi.fn(),
}));

// Capture the Razorpay order request body (CHECKOUT-01).
let lastOrderBody: string | null = null;

describe("GAP2-BILLING money BigInt charge path", () => {
  beforeEach(() => {
    published.length = 0;
    lastOrderBody = null;
    vi.stubEnv("JWT_SECRET", SECRET);
    vi.stubEnv("PAYMENT_GATEWAY", "razorpay");
    vi.stubEnv("RAZORPAY_KEY_ID", "rzp_test_key"); // gitleaks:allow
    vi.stubEnv("RAZORPAY_KEY_SECRET", "rzp_test_secret"); // gitleaks:allow
    vi.stubEnv("PAYMENT_UPI_ENABLED", "false");
    vi.stubEnv("PAYMENT_EMANDATE_ENABLED", "false");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("PAYMENTS-11: capture publishes the exact integer-paise string (no float rounding)", async () => {
    vi.resetModules();
    const { buildApp } = await import("../src/app.js");
    const app: FastifyInstance = await buildApp();
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/v1/billing/payments/order_big/capture",
      headers: { authorization: `Bearer ${token()}`, "x-tenant-id": TENANT },
    });

    expect(res.statusCode).toBe(200);
    const rec = published.find((p) => p.payload.method === "gateway" && "amountPaise" in p.payload);
    expect(rec).toBeDefined();
    // Exact integer string — Number(BIG_PAISE).toString() would be "9007199254740992".
    expect(rec!.payload.amountPaise).toBe("9007199254740993");
    expect(rec!.payload.amountPaise).not.toBe(String(Number(BIG_PAISE)));

    await app.close();
  });

  it("CHECKOUT-01: Razorpay order amount equals priceMinor*12 exactly (no float rounding)", async () => {
    // Mock the DB scopedRead to return the large plan price, and fetch to
    // capture the order request body.
    vi.doMock("../src/shared/db.js", async (importOriginal) => {
      const original = await importOriginal<Record<string, unknown>>();
      return {
        ...original,
        scopedRead: vi.fn(async (fn: (tx: unknown) => unknown) => {
          const tx = {
            select: () => tx,
            from: () => tx,
            where: () => tx,
            limit: () => [{ priceMinor: PLAN_PRICE_MINOR, currency: "INR" }],
          };
          return fn(tx);
        }),
      };
    });

    vi.doMock("../src/modules/payments/checkout-validators.js", () => ({
      checkoutBody: { parse: (b: unknown) => b },
      verifyPaymentBody: { parse: (b: unknown) => b },
    }));

    const fetchMock = vi.fn(async (url: string, init: { body: string }) => {
      if (url.endsWith("/orders")) {
        lastOrderBody = init.body;
        return { ok: true, json: async () => ({ id: "order_big", amount: 0, currency: "INR", receipt: "r", status: "created" }) };
      }
      return { ok: false, status: 404, text: async () => "not found" };
    });
    vi.stubGlobal("fetch", fetchMock);

    vi.resetModules();
    const { buildApp } = await import("../src/app.js");
    const app: FastifyInstance = await buildApp();
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/v1/billing/checkout",
      headers: { authorization: `Bearer ${token(["tenant_admin"])}`, "x-tenant-id": TENANT },
      payload: { planId: "11111111-2222-4000-8000-000000000001", billingCycle: "annual" },
    });

    expect(res.statusCode).toBe(200);
    // Exact: priceMinor * 12 as an integer.
    const expected = (PLAN_PRICE_MINOR * 12n).toString();
    expect(lastOrderBody).toBeTruthy();
    const parsedAmount = JSON.parse(lastOrderBody as string).amount;
    // The wire value must be the exact integer (JSON parses it as a Number here,
    // but the serialised body string must contain the exact digits).
    expect((lastOrderBody as string)).toContain(`"amount":${expected}`);
    // And the HTTP response echoes the exact string.
    expect(res.json().amountPaise).toBe(expected);
    // Sanity: float math would have produced a different (rounded) value.
    expect(String(Number(PLAN_PRICE_MINOR) * 12)).not.toBe(expected);
    // (parsedAmount is a JS number and may be rounded; we only assert on the
    // raw serialised body above, which is what Razorpay actually receives.)
    void parsedAmount;

    await app.close();
    vi.doUnmock("../src/shared/db.js");
    vi.doUnmock("../src/modules/payments/checkout-validators.js");
  });
});
