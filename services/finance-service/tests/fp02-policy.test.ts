/**
 * Two-person policy loosening (fp-finance-02 review): tightening is immediate; turning a maker != checker switch
 * OFF or raising the cheque validity above the RBI 3 months is a pending request a DIFFERENT admin approves.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { scoped } from "./_tenant.js";
import { financePolicy, financePolicyChanges } from "../src/modules/masters/schema.js";
import { splitPolicyPatch, DEFAULT_POLICY } from "../src/modules/masters/policy.js";
import { bearer, auditRows, wipeOutbox, startConsumers, drain } from "./_fp02.js";

const T = "aaaaaaaa-0f02-4000-8000-000000000051";
const A = "00000000-0f02-4000-8000-0000000000f1";
const B = "00000000-0f02-4000-8000-0000000000f2";
const OFFICER = "00000000-0f02-4000-8000-0000000000f3";
const as = (a: string, roles = ["finance_admin"]) => bearer(T, a, roles);
let app: Awaited<ReturnType<typeof buildApp>>;

const policy = async () => (await app.inject({ method: "GET", url: "/v1/finance/policy", headers: as(OFFICER, ["finance_officer"]) })).json();
const put = async (who: string, body: object) => { const r = await app.inject({ method: "PUT", url: "/v1/finance/policy", headers: as(who), payload: body }); await drain(); return r; };
const decide = async (who: string, id: string, action: "approve" | "reject", payload: object = {}) => {
  const r = await app.inject({ method: "POST", url: `/v1/finance/policy/changes/${id}/${action}`, headers: as(who), payload }); await drain(); return r;
};
async function cleanup() {
  await scoped(T, (tx) => tx.delete(financePolicyChanges).where(eq(financePolicyChanges.tenantId, T)));
  await scoped(T, (tx) => tx.delete(financePolicy).where(eq(financePolicy.tenantId, T)));
  await wipeOutbox(T);
}
beforeAll(async () => { await cleanup(); app = await buildApp(); await startConsumers(); });
afterAll(async () => { await cleanup(); await app.close(); await sqlClient.end(); });

describe("splitPolicyPatch (pure)", () => {
  it("OFF and validity above 3 loosen; ON, equal and lower tighten", () => {
    expect(splitPolicyPatch(DEFAULT_POLICY, { vendorMakerChecker: false, auditParaMakerChecker: false, chequeValidityMonths: 6 }))
      .toEqual({ immediate: {}, needsApproval: { vendorMakerChecker: false, auditParaMakerChecker: false, chequeValidityMonths: 6 } });
    expect(splitPolicyPatch(DEFAULT_POLICY, { vendorMakerChecker: true, chequeValidityMonths: 2 }))
      .toEqual({ immediate: { vendorMakerChecker: true, chequeValidityMonths: 2 }, needsApproval: {} });
    expect(splitPolicyPatch(DEFAULT_POLICY, { chequeValidityMonths: 3 }).immediate).toEqual({ chequeValidityMonths: 3 });
    // already off: staying off is not a new loosening; lowering from 6 to 4 is a tightening
    expect(splitPolicyPatch({ ...DEFAULT_POLICY, vendorMakerChecker: false, chequeValidityMonths: 6 }, { vendorMakerChecker: false, chequeValidityMonths: 4 }).needsApproval).toEqual({});
  });
});

describe("policy changes", () => {
  it("tightening (and an unchanged value) applies immediately with no second admin, audited", async () => {
    const r = await put(A, { chequeValidityMonths: 2 });
    expect(r.statusCode).toBe(202);
    expect(r.json().data.requiresApproval).toBe(false);
    expect((await policy()).chequeValidityMonths).toBe(2);
    expect((await auditRows(T, "policy_update")).length).toBeGreaterThan(0);
    await put(A, { chequeValidityMonths: 3 });
    expect((await policy()).chequeValidityMonths).toBe(3);
  });

  it("raising the cheque validity above 3 is a pending request: nothing changes until a different admin approves", async () => {
    const r = await put(A, { chequeValidityMonths: 6 });
    expect(r.json().data.requiresApproval).toBe(true);
    expect((await policy()).chequeValidityMonths).toBe(3);
    const pending = (await app.inject({ method: "GET", url: "/v1/finance/policy/changes", headers: as(OFFICER, ["finance_officer"]) })).json().data;
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ proposedBy: A, patch: { chequeValidityMonths: 6 } });
    const changeId = r.json().data.changeId as string;
    const self = await decide(A, changeId, "approve");
    expect(self.statusCode).toBe(409);
    expect(self.json().code).toBe("MAKER_CHECKER_VIOLATION");
    expect((await policy()).chequeValidityMonths).toBe(3);
    expect((await decide(B, changeId, "approve")).statusCode).toBe(202);
    expect((await policy()).chequeValidityMonths).toBe(6);
    expect(await auditRows(T, "policy_change_approve", changeId)).toHaveLength(1);
    const replay = await decide(B, changeId, "approve");
    expect(replay.statusCode).toBe(409);
    expect(replay.json().code).toBe("POLICY_CHANGE_NOT_PENDING");
    // lowering it again is immediate
    await put(A, { chequeValidityMonths: 3 });
    expect((await policy()).chequeValidityMonths).toBe(3);
  });

  it("a mixed patch applies its tightening at once and holds only the loosening back", async () => {
    const r = await put(A, { chequeValidityMonths: 2, auditParaMakerChecker: false });
    expect(r.json().data.requiresApproval).toBe(true);
    const p = await policy();
    expect(p.chequeValidityMonths).toBe(2);
    expect(p.auditParaMakerChecker).toBe(true);
    await decide(B, r.json().data.changeId, "reject", { reason: "Not justified" });
    expect((await policy()).auditParaMakerChecker).toBe(true);
    await put(A, { chequeValidityMonths: 3 });
  });

  it("the consumer is authoritative: an approve published by the proposer past the route pre-check changes nothing", async () => {
    const r = await put(A, { vendorMakerChecker: false });
    const { queue } = await import("../src/shared/infra.js");
    await queue.publish("finance.policy.change_decide", {
      messageId: crypto.randomUUID(), type: "finance.policy.change_decide", tenantId: T, actorId: A, correlationId: "c", schemaVersion: "1.0",
      payload: { tenantId: T, changeId: r.json().data.changeId, decision: "approve" },
    });
    await drain();
    expect((await policy()).vendorMakerChecker).toBe(true);
    await decide(B, r.json().data.changeId, "reject", { reason: "Not now, thanks" });
  });

  it("the proposer may withdraw their own request; an unknown request is 404; non-admins are refused", async () => {
    const r = await put(A, { vendorMakerChecker: false });
    expect((await decide(A, r.json().data.changeId, "reject", { reason: "Withdrawn by me" })).statusCode).toBe(202);
    expect((await decide(B, "11111111-1111-4111-8111-111111111111", "approve")).statusCode).toBe(404);
    const denied = await app.inject({ method: "PUT", url: "/v1/finance/policy", headers: as(OFFICER, ["finance_officer"]), payload: { vendorMakerChecker: true } });
    expect(denied.statusCode).toBe(403);
    expect((await app.inject({ method: "PUT", url: "/v1/finance/policy", headers: as(A), payload: {} })).statusCode).toBe(400);
  });
});
