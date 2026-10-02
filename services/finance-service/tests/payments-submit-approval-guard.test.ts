/**
 * GAP-FINANCE-PAYMENTS-DETAIL-03 / DETAIL-06 / PAYMENTS-05 (ml-finance-06).
 *
 *  - POST /v1/finance/payments/:id/submit-approval refuses a terminal or already-
 *    submitted payment with 409 (it used to answer 202 for ANY status, and the
 *    consumer then flipped a `released` payment back to `pending_approval`) and a
 *    missing payment with 404.
 *  - the consumer-side guard (assertPaymentSubmittable) rejects the same statuses.
 *  - GET /v1/finance/payments/:id carries eftRef/utr so the detail shows the same
 *    reference as the register.
 *  - the register list carries the exact amountMinor string so the web can sort numerically.
 * repo / commands / cache are mocked; no Postgres needed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { signToken } from "@civitasone/auth";

const findPaymentByIdAndTenant = vi.fn();
const listPaymentsByTenant = vi.fn();
const findBillsByIds = vi.fn();
const submitPaymentForApproval = vi.fn();

vi.mock("../src/shared/infra.js", () => ({
  cache: {
    getOrLoad: async (_key: string, loader: () => Promise<unknown>) => loader(),
    listOrLoad: async (_t: string, _k: string, _key: string, loader: () => Promise<unknown>) => loader(),
    makeKey: (...parts: string[]) => parts.join(":"),
    invalidate: vi.fn(),
  },
}));
vi.mock("../src/modules/payments/repo.js", () => ({
  findPaymentByIdAndTenant: (...a: unknown[]) => findPaymentByIdAndTenant(...a),
  listPaymentsByTenant: (...a: unknown[]) => listPaymentsByTenant(...a),
  findBillsByIds: (...a: unknown[]) => findBillsByIds(...a),
}));
vi.mock("../src/modules/payments/commands.js", () => ({
  submitPaymentForApproval: (...a: unknown[]) => submitPaymentForApproval(...a),
}));

import { paymentsRoutes } from "../src/modules/payments/routes.js";
import { financeErrorHandler } from "../src/shared/context.js";
import { DomainError, assertPaymentSubmittable } from "../src/modules/payments/domain.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-3333-4000-8000-0000000000c6";
const ACTOR = "00000000-aaaa-4000-8000-0000000000c6";
const PAY_ID = "5b1c2d3e-0000-4000-8000-00000000abcd";
const BILL_ID = "6b1c2d3e-0000-4000-8000-00000000abcd";

const hdr = () => ({ authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles: ["finance_officer"], sid: "s" }, SECRET)}` });
async function app() {
  const a = Fastify();
  a.setErrorHandler(financeErrorHandler);
  await a.register(paymentsRoutes);
  await a.ready();
  return a;
}
const payment = (over: Record<string, unknown> = {}) => ({
  id: PAY_ID, tenantId: TENANT, billId: BILL_ID, amountMinor: 1000000000n, mode: "NEFT", currency: "INR",
  status: "initiated", eftRef: "EFT-2026-0042", utr: null, createdBy: ACTOR, createdAt: "2026-07-04T12:00:00.000Z", ...over,
});

describe("assertPaymentSubmittable", () => {
  it.each(["released", "completed", "failed", "cancelled", "pending_approval"])("rejects %s", (s) => {
    expect(() => assertPaymentSubmittable(s)).toThrow(DomainError);
  });
  it.each(["initiated", "pending", "approved"])("allows %s", (s) => {
    expect(() => assertPaymentSubmittable(s)).not.toThrow();
  });
});

describe("POST /v1/finance/payments/:id/submit-approval", () => {
  beforeEach(() => {
    [findPaymentByIdAndTenant, submitPaymentForApproval].forEach((m) => m.mockReset());
    submitPaymentForApproval.mockResolvedValue({ id: PAY_ID, status: "accepted", correlationId: "c" });
  });
  const post = async () => (await app()).inject({ method: "POST", url: `/v1/finance/payments/${PAY_ID}/submit-approval`, headers: hdr(), payload: {} });

  it.each(["released", "failed", "pending_approval"])("409s a %s payment and queues nothing", async (status) => {
    findPaymentByIdAndTenant.mockResolvedValue(payment({ status }));
    const res = await post();
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).code).toBe("PAYMENT_NOT_SUBMITTABLE");
    expect(JSON.parse(res.body).message).toContain(`'${status}'`);
    expect(submitPaymentForApproval).not.toHaveBeenCalled();
  });

  it("404s a payment that does not exist", async () => {
    findPaymentByIdAndTenant.mockResolvedValue(null);
    const res = await post();
    expect(res.statusCode).toBe(404);
    expect(submitPaymentForApproval).not.toHaveBeenCalled();
  });

  it("accepts (202) an initiated payment", async () => {
    findPaymentByIdAndTenant.mockResolvedValue(payment({ status: "initiated" }));
    const res = await post();
    expect(res.statusCode).toBe(202);
    expect(submitPaymentForApproval).toHaveBeenCalledTimes(1);
  });
});

describe("GET /v1/finance/payments/:id", () => {
  it("returns eftRef and utr (the reference the register shows)", async () => {
    findPaymentByIdAndTenant.mockReset().mockResolvedValue(payment({ utr: "UTR123" }));
    const res = await (await app()).inject({ method: "GET", url: `/v1/finance/payments/${PAY_ID}`, headers: hdr() });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ eftRef: "EFT-2026-0042", utr: "UTR123", amountMinor: "1000000000" });
  });
});

describe("GET /v1/finance/payments (register)", () => {
  it("includes the exact amountMinor string beside amountDisplay, above 2^53 paise too", async () => {
    listPaymentsByTenant.mockReset().mockResolvedValue([
      payment({ amountMinor: 9007199254740993n, id: "11111111-1111-4000-8000-000000000001" }),
      payment({ amountMinor: 999999900n, id: "11111111-1111-4000-8000-000000000002" }),
    ]);
    findBillsByIds.mockReset().mockResolvedValue([]);
    const res = await (await app()).inject({ method: "GET", url: "/v1/finance/payments", headers: hdr() });
    expect(res.statusCode).toBe(200);
    const rows = JSON.parse(res.body).data as Array<{ amountMinor: string; amountDisplay: string }>;
    expect(rows.map((r) => r.amountMinor)).toEqual(["9007199254740993", "999999900"]);
    expect(rows[1]?.amountDisplay).toBe("₹99,99,999.00");
  });
});
