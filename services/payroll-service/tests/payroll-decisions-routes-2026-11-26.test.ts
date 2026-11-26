/**
 * Owner decisions 2026-11-26 -- route-level tests (read side + queue mocked, same harness as b1-payroll-tax-gaps):
 *   B15 PAYROLL-TAX-DECLARATION-05: payroll_officer verifies, payroll_admin re-opens (audited reason)
 *   C19 PAYROLL-LOANS-06: tenant-configurable loan ceilings (no built-in "max eligible")
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";

const TENANT = "bbbbbbbb-0b15-4000-8000-000000000b15";
const FILER = "00000000-0b15-4000-8000-00000000000a";
const OFFICER = "00000000-0b15-4000-8000-00000000000b";
const DECL = "00000000-0b15-4000-8000-0000000000d1";
const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const tok = (sub: string, roles: string[]) => signToken({ sub, tid: TENANT, roles, sid: "s-" + sub }, SECRET);

const readQueue: unknown[] = [];
vi.mock("../src/shared/db.js", async () => {
  const actual = await vi.importActual<typeof import("../src/shared/db.js")>("../src/shared/db.js");
  return { ...actual, scopedRead: vi.fn(async () => { if (readQueue.length === 0) throw new Error("unexpected scopedRead"); return readQueue.shift(); }) };
});
const mockPublish = vi.fn().mockResolvedValue(undefined);
vi.mock("../src/shared/infra.js", () => ({
  queue: { publish: (...a: unknown[]) => mockPublish(...a), subscribe: vi.fn(), start: vi.fn(), stop: vi.fn(), ping: vi.fn() },
  cache: { getOrLoad: vi.fn((_k: string, fn: () => unknown) => fn()), invalidate: vi.fn(), invalidateResource: vi.fn(), makeKey: (...p: string[]) => p.join(":"), put: vi.fn(), ping: vi.fn() },
}));

const { buildApp } = await import("../src/app.js");
const { COMMANDS } = await import("../src/topics.js");
const app = await buildApp();
afterAll(async () => { await app.close(); });
beforeEach(() => { readQueue.length = 0; mockPublish.mockClear(); });

const call = (method: "POST" | "PUT" | "GET", url: string, sub: string, roles: string[], payload: unknown = {}) =>
  app.inject({ method, url, headers: { authorization: "Bearer " + tok(sub, roles), "content-type": "application/json" }, ...(method === "GET" ? {} : { payload: payload as Record<string, unknown> }) });

describe("B15 tax declaration: officer verifies, admin re-opens", () => {
  it("payroll_officer verifies a submitted declaration filed by someone else: 202 + verify command", async () => {
    readQueue.push([{ id: DECL, status: "submitted", createdBy: FILER, updatedBy: FILER }]);
    const r = await call("POST", "/v1/payroll/tax-declarations/" + DECL + "/verify", OFFICER, ["payroll_officer"]);
    expect(r.statusCode).toBe(202);
    expect(mockPublish.mock.calls[0]![0]).toBe(COMMANDS.taxDeclarationVerify);
  });
  it("the filer cannot verify their own declaration (403 SELF_VERIFY_FORBIDDEN)", async () => {
    readQueue.push([{ id: DECL, status: "submitted", createdBy: FILER, updatedBy: FILER }]);
    const r = await call("POST", "/v1/payroll/tax-declarations/" + DECL + "/verify", FILER, ["payroll_officer"]);
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe("SELF_VERIFY_FORBIDDEN");
    expect(mockPublish).not.toHaveBeenCalled();
  });
  it("an already-verified declaration cannot be verified again (409)", async () => {
    readQueue.push([{ id: DECL, status: "verified", createdBy: FILER, updatedBy: FILER }]);
    const r = await call("POST", "/v1/payroll/tax-declarations/" + DECL + "/verify", OFFICER, ["payroll_officer"]);
    expect(r.statusCode).toBe(409);
  });
  it.each([["employee"], ["hr_admin"], ["finance_officer"]])("%s cannot verify (403)", async (role) => {
    const r = await call("POST", "/v1/payroll/tax-declarations/" + DECL + "/verify", OFFICER, [role]);
    expect(r.statusCode).toBe(403);
  });
  it("payroll_officer cannot re-open (403); payroll_admin can, with a reason", async () => {
    const denied = await call("POST", "/v1/payroll/tax-declarations/" + DECL + "/reopen", OFFICER, ["payroll_officer"], { reason: "employee supplied corrected rent receipts" });
    expect(denied.statusCode).toBe(403);
    readQueue.push([{ id: DECL, status: "verified", createdBy: FILER, updatedBy: OFFICER }]);
    const ok = await call("POST", "/v1/payroll/tax-declarations/" + DECL + "/reopen", OFFICER, ["payroll_admin"], { reason: "employee supplied corrected rent receipts" });
    expect(ok.statusCode).toBe(202);
    expect(mockPublish.mock.calls[0]![0]).toBe(COMMANDS.taxDeclarationReopen);
  });
  it("re-open needs a real reason (400) and a locked declaration (409)", async () => {
    const noReason = await call("POST", "/v1/payroll/tax-declarations/" + DECL + "/reopen", OFFICER, ["payroll_admin"], { reason: "x" });
    expect(noReason.statusCode).toBe(400);
    readQueue.push([{ id: DECL, status: "submitted", createdBy: FILER, updatedBy: FILER }]);
    const notLocked = await call("POST", "/v1/payroll/tax-declarations/" + DECL + "/reopen", OFFICER, ["payroll_admin"], { reason: "employee supplied corrected rent receipts" });
    expect(notLocked.statusCode).toBe(409);
    expect(mockPublish).not.toHaveBeenCalled();
  });
});

describe("C19 loan ceilings: tenant-configurable, admin-only writes", () => {
  it("payroll_officer cannot set a ceiling (403); payroll_admin can (202 + command)", async () => {
    const body = { loanType: "personal", maxPrincipalMinor: 50000000, changeReason: "Finance circular sets Rs 5 lakh cap" };
    expect((await call("PUT", "/v1/payroll/loan-ceilings", OFFICER, ["payroll_officer"], body)).statusCode).toBe(403);
    const ok = await call("PUT", "/v1/payroll/loan-ceilings", OFFICER, ["payroll_admin"], body);
    expect(ok.statusCode).toBe(202);
    expect(mockPublish.mock.calls[0]![0]).toBe(COMMANDS.loanCeilingSet);
  });
  it("a ceiling needs a stated reason (400)", async () => {
    const r = await call("PUT", "/v1/payroll/loan-ceilings", OFFICER, ["payroll_admin"], { loanType: "personal", maxPrincipalMinor: 1000, changeReason: "x" });
    expect(r.statusCode).toBe(400);
  });
  it("decideLoanCeiling: no ceiling => allowed; above ceiling => refused", async () => {
    const { decideLoanCeiling } = await import("../src/modules/loans/policy.js");
    expect(decideLoanCeiling(null, 10n ** 12n).allowed).toBe(true);
    expect(decideLoanCeiling(50000000n, 50000000n).allowed).toBe(true);
    expect(decideLoanCeiling(50000000n, 50000001n).allowed).toBe(false);
  });
});
