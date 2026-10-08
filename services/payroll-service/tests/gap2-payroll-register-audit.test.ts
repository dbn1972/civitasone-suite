/**
 * GAP2-PAYROLL-REGISTER-01 (read-audit on the payroll register).
 *
 * GET /v1/payroll/register returns department-wise gross/net/deduction salary
 * totals (financial, DPDP-adjacent aggregate data exported client-side) but
 * used to emit no read-audit event, unlike the sibling salary-revisions
 * pay-history read in the same file. This asserts the register GET now
 * publishes a `read_payroll_register` audit event (fails on the old handler).
 */
import { describe, it, expect, afterAll, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { queue } from "../src/shared/infra.js";
import { buildApp } from "../src/app.js";
import { COMMANDS } from "../src/topics.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const ACTOR = randomUUID();

function token(roles: string[] = ["payroll_admin"]) {
  return signToken({ sub: ACTOR, tid: TENANT, roles, sid: "gap2-register-audit" }, SECRET);
}

afterEach(() => { vi.restoreAllMocks(); });
afterAll(async () => {
  const { sqlClient } = await import("../src/shared/db.js");
  await sqlClient.end();
});

async function getRegister(roles: string[], qs = ""): Promise<{ statusCode: number }> {
  const app = await buildApp();
  const res = await app.inject({
    method: "GET",
    url: `/v1/payroll/register${qs}`,
    headers: { authorization: `Bearer ${token(roles)}` },
  });
  await app.close();
  return res;
}

describe("GET /v1/payroll/register read-audit (GAP2-PAYROLL-REGISTER-01)", () => {
  it("publishes a read_payroll_register audit event on an authorized read", async () => {
    const publishSpy = vi.spyOn(queue, "publish");
    const res = await getRegister(["payroll_admin"], "?period=2026-07");
    expect(res.statusCode).toBe(200);
    const auditCall = publishSpy.mock.calls.find((c) => c[0] === COMMANDS.auditRecord);
    expect(auditCall).toBeDefined();
    expect((auditCall![1] as { payload: Record<string, unknown> }).payload).toMatchObject({
      tenantId: TENANT,
      action: "read_payroll_register",
      resourceType: "payroll_register",
      resourceId: "2026-07",
    });
    expect((auditCall![1] as { payload: { details: Record<string, unknown> } }).payload.details)
      .toMatchObject({ period: "2026-07", runId: null });
  });

  it("does NOT publish a register read-audit when the caller is unauthorized (403)", async () => {
    const publishSpy = vi.spyOn(queue, "publish");
    const res = await getRegister(["citizen"]);
    expect(res.statusCode).toBe(403);
    const auditCall = publishSpy.mock.calls.find(
      (c) => c[0] === COMMANDS.auditRecord
        && (c[1] as { payload?: Record<string, unknown> })?.payload?.action === "read_payroll_register",
    );
    expect(auditCall).toBeUndefined();
  });
});
