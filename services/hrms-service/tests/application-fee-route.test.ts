/**
 * R-RA-0099 — application fee routes (assess / pay / get).
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-0099-4000-8000-000000000099";
const USER = "aaaaaaaa-7777-4000-8000-000000000099";
const APP = "dddddddd-0099-4000-8000-00000000d099";
const JOB = "ffffffff-0099-4000-8000-00000000f099";
const FEE = "eeeeeeee-0099-4000-8000-00000000e099";

const H = vi.hoisted(() => ({
  findApplication: vi.fn(), getVacancyFee: vi.fn(), findFee: vi.fn(), insertFee: vi.fn(), updateFee: vi.fn(),
}));

vi.mock("../src/modules/recruitment/audit-emit.js", () => ({ emitAudit: async () => undefined }));
vi.mock("../src/shared/db.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  db: { transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb({}) },
}));
vi.mock("../src/modules/recruitment/screening-repo.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  findApplication: (...a: unknown[]) => H.findApplication(...a),
}));
vi.mock("../src/modules/recruitment/application-fee-repo.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  getVacancyFee: (...a: unknown[]) => H.getVacancyFee(...a),
  findFee: (...a: unknown[]) => H.findFee(...a),
  insertFee: (...a: unknown[]) => H.insertFee(...a),
  updateFee: (...a: unknown[]) => H.updateFee(...a),
}));

import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const tok = (roles: string[]) => signToken({ sub: USER, tid: TENANT, roles, sid: "s" }, SECRET);
const auth = (roles = ["hr_admin"]) => ({ authorization: `Bearer ${tok(roles)}` });
const feeRow = (over = {}) => ({ id: FEE, tenantId: TENANT, applicationId: APP, jobOpeningId: JOB, amountMinor: 50000n, currency: "INR", status: "pending", exemptionReason: null, provider: "none", paymentRef: null, paidAt: null, version: 1, ...over });

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.FEATURE_FEE_GATEWAY_ENABLED;
  H.findApplication.mockResolvedValue({ id: APP, tenantId: TENANT, jobOpeningId: JOB, category: "GEN" });
  H.getVacancyFee.mockResolvedValue(50000n);
  H.findFee.mockResolvedValue(null);
  H.insertFee.mockResolvedValue(undefined);
  H.updateFee.mockResolvedValue(undefined);
});
afterAll(async () => { await sqlClient.end(); });

describe("application fee (R-RA-0099)", () => {
  it("assesses a pending fee for a non-exempt candidate (201, amount as string)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/applications/${APP}/fee/assess`, headers: auth(["hr_officer"]) });
    expect(r.statusCode).toBe(201);
    expect(r.json().data).toMatchObject({ status: "pending", amountMinor: "50000", currency: "INR" });
    await app.close();
  });

  it("assesses exempt for a reserved category", async () => {
    H.findApplication.mockResolvedValue({ id: APP, tenantId: TENANT, jobOpeningId: JOB, category: "SC" });
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/applications/${APP}/fee/assess`, headers: auth(), payload: { categoryVerified: true } });
    expect(r.statusCode).toBe(201);
    expect(r.json().data).toMatchObject({ status: "exempt", amountMinor: "0" });
    await app.close();
  });

  it("does NOT exempt a self-declared category without verification (pending)", async () => {
    H.findApplication.mockResolvedValue({ id: APP, tenantId: TENANT, jobOpeningId: JOB, category: "SC" });
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/applications/${APP}/fee/assess`, headers: auth() });
    expect(r.statusCode).toBe(201);
    expect(r.json().data).toMatchObject({ status: "pending", amountMinor: "50000" });
    await app.close();
  });

  it("is idempotent — returns the existing fee (200 assessed:false)", async () => {
    H.findFee.mockResolvedValue(feeRow());
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/applications/${APP}/fee/assess`, headers: auth() });
    expect(r.statusCode).toBe(200);
    expect(r.json().assessed).toBe(false);
    expect(H.insertFee).not.toHaveBeenCalled();
    await app.close();
  });

  it("404 assess for a missing application", async () => {
    H.findApplication.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/applications/${APP}/fee/assess`, headers: auth() });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("records a manual payment with a reference (200 paid)", async () => {
    H.findFee.mockResolvedValue(feeRow());
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/applications/${APP}/fee/pay`, headers: auth(["hr_admin"]), payload: { mode: "manual", paymentRef: "CHALLAN-9" } });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toMatchObject({ status: "paid", provider: "manual", paymentRef: "CHALLAN-9" });
    expect(H.updateFee).toHaveBeenCalledOnce();
    await app.close();
  });

  it("rejects a manual payment without a reference (422)", async () => {
    H.findFee.mockResolvedValue(feeRow());
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/applications/${APP}/fee/pay`, headers: auth(["hr_admin"]), payload: { mode: "manual" } });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("INVALID_PAYMENT");
    await app.close();
  });

  it("cannot pay an exempt fee (409)", async () => {
    H.findFee.mockResolvedValue(feeRow({ status: "exempt", amountMinor: 0n }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/applications/${APP}/fee/pay`, headers: auth(["hr_admin"]), payload: { paymentRef: "x" } });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("FEE_EXEMPT");
    await app.close();
  });

  it("cannot pay a refunded fee (409 NOT_PAYABLE)", async () => {
    H.findFee.mockResolvedValue(feeRow({ status: "refunded" }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/applications/${APP}/fee/pay`, headers: auth(["hr_admin"]), payload: { paymentRef: "x" } });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("NOT_PAYABLE");
    await app.close();
  });

  it("online payment is 501 when the gateway is not enabled (honest, not faked)", async () => {
    H.findFee.mockResolvedValue(feeRow());
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/applications/${APP}/fee/pay`, headers: auth(["hr_admin"]), payload: { mode: "online" } });
    expect(r.statusCode).toBe(501);
    expect(H.updateFee).not.toHaveBeenCalled();
    await app.close();
  });

  it("forbids an hr_officer from recording a payment (403)", async () => {
    H.findFee.mockResolvedValue(feeRow());
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/applications/${APP}/fee/pay`, headers: auth(["hr_officer"]), payload: { paymentRef: "x" } });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("gets the fee status (200)", async () => {
    H.findFee.mockResolvedValue(feeRow({ status: "paid", provider: "manual", paymentRef: "CH-1", paidAt: new Date("2026-07-01T00:00:00Z") }));
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/applications/${APP}/fee`, headers: auth(["hr_officer"]) });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toMatchObject({ status: "paid", amountMinor: "50000", paymentRef: "CH-1" });
    await app.close();
  });

  it("requires auth (401)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/applications/${APP}/fee` });
    expect(r.statusCode).toBe(401);
    await app.close();
  });
});
