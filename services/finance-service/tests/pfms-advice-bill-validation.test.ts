/**
 * GAP-FINANCE-PFMS-07: POST /v1/finance/pfms/payment-advice must describe a real,
 * payable bill of the caller's tenant for exactly its net amount. Mocked: no Postgres.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { signToken } from "@civitasone/auth";

const findBill = vi.fn();
const submitAdvice = vi.fn();
vi.mock("../src/modules/payments/repo.js", () => ({ findBillByIdAndTenant: (...a: unknown[]) => findBill(...a) }));
vi.mock("../src/modules/pfms/pfms-client.js", () => {
  class PfmsTreasuryError extends Error { code = "X"; httpStatus = 502; }
  return {
    PfmsTreasuryError,
    submitPaymentAdvice: (...a: unknown[]) => submitAdvice(...a),
    getPaymentStatus: vi.fn(),
    submitSalaryBill: vi.fn(),
    getTreasuryBalance: vi.fn(),
  };
});

import { pfmsTreasuryStubRoutes } from "../src/modules/pfms/treasury-stubs.js";
import { financeErrorHandler } from "../src/shared/context.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-3333-4000-8000-0000000000a1";
const ACTOR = "00000000-aaaa-4000-8000-0000000000a1";
const BILL = "22222222-2222-4222-8222-222222222222";

const ADVICE = {
  billId: BILL, payeeName: "Acme", payeeAccountNo: "1234567890", payeeIfsc: "SBIN0001234",
  amountMinor: 1250000, purposeCode: "PUR01",
};

async function post(body: unknown) {
  const a = Fastify();
  a.setErrorHandler(financeErrorHandler);
  await a.register(pfmsTreasuryStubRoutes);
  await a.ready();
  const token = signToken({ sub: ACTOR, tid: TENANT, roles: ["finance_officer"], actorType: "user" } as never, SECRET);
  return a.inject({ method: "POST", url: "/v1/finance/pfms/payment-advice", headers: { authorization: `Bearer ${token}` }, payload: body as object });
}

describe("payment-advice bill validation", () => {
  beforeEach(() => {
    findBill.mockReset().mockResolvedValue({ id: BILL, tenantId: TENANT, status: "passed", netMinor: 1250000n });
    submitAdvice.mockReset().mockResolvedValue({ adviceId: "a1", mode: "sandbox" });
  });

  it("a passed bill with the exact net amount goes through", async () => {
    const res = await post(ADVICE);
    expect(res.statusCode).toBe(201);
    expect(findBill).toHaveBeenCalledWith(BILL, TENANT);
    expect(submitAdvice).toHaveBeenCalledTimes(1);
  });

  it("legacy 'approved' status is accepted too", async () => {
    findBill.mockResolvedValue({ id: BILL, tenantId: TENANT, status: "approved", netMinor: 1250000n });
    expect((await post(ADVICE)).statusCode).toBe(201);
  });

  it("an unknown bill (or another tenant's) is 400 and nothing is submitted", async () => {
    findBill.mockResolvedValue(null);
    const res = await post(ADVICE);
    expect(res.statusCode).toBe(400);
    expect(submitAdvice).not.toHaveBeenCalled();
    findBill.mockResolvedValue({ id: BILL, tenantId: "other-tenant", status: "passed", netMinor: 1250000n });
    expect((await post(ADVICE)).statusCode).toBe(400);
  });

  it.each(["pending", "paid", "rejected", "on_hold"])("a '%s' bill is 409", async (status) => {
    findBill.mockResolvedValue({ id: BILL, tenantId: TENANT, status, netMinor: 1250000n });
    const res = await post(ADVICE);
    expect(res.statusCode).toBe(409);
    expect(submitAdvice).not.toHaveBeenCalled();
  });

  it("an amount different from the bill's net is 409", async () => {
    const res = await post({ ...ADVICE, amountMinor: 1250001 });
    expect(res.statusCode).toBe(409);
    expect(submitAdvice).not.toHaveBeenCalled();
  });
});
