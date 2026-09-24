/**
 * SEC-P2-03 regression: POST /v1/payroll/reimbursements accepted an
 * arbitrary `employeeId` in the request body with no check that it matched
 * the caller — any authenticated `employee`-role caller could file a
 * reimbursement claim (with a real payout) in a co-worker's name (IDOR /
 * claim forgery). The route now calls enforceEmployeeOwnership(...) and
 * forces employeeId to the caller's own actorId for self-service callers;
 * HR/payroll roles keep the existing ability to submit a claim on behalf of
 * another employee.
 *
 * hrms-client is mocked the same way tests/world-class-cqrs.test.ts mocks it
 * for this same command — commands.createReimbursement does a real
 * synchronous HRMS existence check before publishing, and this service's
 * isolated test env has no hrms-service running. The queue/cache are left
 * real (QUEUE_DRIVER=memory / CACHE_DRIVER=memory, set globally in
 * vitest.config.ts) so this exercises the actual route -> guard ->
 * command -> publish chain, same as tests/payroll-routes.test.ts's existing
 * (unguarded-employeeId) POST /v1/payroll/reimbursements coverage.
 */
import { describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";

vi.mock("../src/shared/hrms-client.js", () => ({
  verifyEmployeeExists: vi.fn(async () => true),
}));

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const ADMIN_ACTOR = randomUUID();
const EMP_OWN = randomUUID();
const EMP_OTHER = randomUUID();

function token(sub: string, roles: string[]) {
  return signToken({ sub, tid: TENANT, roles, sid: "sec-p2-03" }, SECRET);
}

function payload(employeeId: string) {
  return { employeeId, category: "medical", amountMinor: 150000, period: "2026-08" };
}

describe("POST /v1/payroll/reimbursements — ownership (SEC-P2-03)", () => {
  it("rejects a self-service employee filing a claim in a co-worker's name (403)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/reimbursements",
      headers: { authorization: `Bearer ${token(EMP_OWN, ["employee"])}` },
      payload: payload(EMP_OTHER),
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("lets a self-service employee file their OWN claim (202)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/reimbursements",
      headers: { authorization: `Bearer ${token(EMP_OWN, ["employee"])}` },
      payload: payload(EMP_OWN),
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    expect(res.json().id).toBeDefined();
  });

  it("lets an hr_admin file a claim on behalf of another employee unchanged (202)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/reimbursements",
      headers: { authorization: `Bearer ${token(ADMIN_ACTOR, ["hr_admin"])}` },
      payload: payload(EMP_OTHER),
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    expect(res.json().id).toBeDefined();
  });
});
