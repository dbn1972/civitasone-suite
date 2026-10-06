/**
 * GAP-ESTAB-APPROVAL-MATRIX-02 — authorization on the approval-rules routes.
 *
 * Approval rules decide who signs sanctions, payments and disciplinary
 * actions, so creating/toggling them must be restricted to establishment
 * admins (not any authenticated user). estab-service enforces this in
 * modules/approval-rules/routes.ts (ADMIN_ROLES on POST/PATCH); this test pins
 * that: a plain clerk is 403'd on write, an estab_admin is accepted (202), and
 * the create command is auditable (emits approval_rule.create — asserted at the
 * command/consumer level in approval-rules.test.ts).
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr"; // gitleaks:allow
const TENANT = "0f1a5e00-4000-4000-8000-0000000007a2";
const ACTOR = "0f1a5e00-5000-4000-8000-0000000007a2";

function authHeader(roles: string[]) {
  const token = signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-am02" }, SECRET, 3600);
  return { authorization: `Bearer ${token}` };
}

const validRule = {
  module: "finance",
  sourceType: "finance_sanction",
  label: "AM02 sanction band",
  minAmountMinor: 0,
  maxAmountMinor: 500_000,
  workflowDefinitionCode: "finance.sanction.am02",
  startNodeKey: "start",
  steps: [{ role: "director", label: "Director" }],
  priority: 100,
};

afterAll(async () => { await sqlClient.end(); });

describe("approval-rules write authorization (GAP-ESTAB-APPROVAL-MATRIX-02)", () => {
  it("rejects POST from a plain clerk with 403 (no rule created)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/estab/approval-rules",
      headers: authHeader(["estab_officer"]),
      payload: validRule,
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("rejects PATCH from a plain clerk with 403", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/estab/approval-rules/${randomUUID()}`,
      headers: authHeader(["estab_officer"]),
      payload: { active: false },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("accepts POST from an estab_admin (202 Accepted)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/estab/approval-rules",
      headers: authHeader(["estab_admin"]),
      payload: { ...validRule, label: `AM02 ${randomUUID()}`, workflowDefinitionCode: `finance.sanction.${randomUUID().slice(0, 8)}` },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe("accepted");
  });

  it("rejects an unauthenticated POST with 401", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/estab/approval-rules", payload: validRule });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
});
