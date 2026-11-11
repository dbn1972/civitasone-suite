/**
 * M6 — applying a sold plan to a tenant is maker-checker and audited. Real Postgres (own throwaway DB), RLS on.
 *
 *  - a request changes NOTHING; only a different admin's approval applies the plan's modules, through the existing applier;
 *  - the requester can never approve/reject (route 409, consumer re-check, DB CHECK);
 *  - every step leaves an audit event; a rejection changes nothing;
 *  - default behaviour is untouched: with PLAN_APPLY_MAKER_CHECKER unset the direct apply-plan route works exactly as before.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";

const { buildApp } = await import("../src/app.js");
const { sqlClient } = await import("../src/shared/db.js");
const { queue } = await import("../src/shared/infra.js");
const { registerCompositionConsumers } = await import("../src/modules/composition/consumer.js");
const { COMMANDS } = await import("../src/topics.js");

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const T = "cccccccc-dddd-4000-8000-0000000000c6";
const MAKER = "c6000000-eeee-4000-8000-0000000000a1";
const CHECKER = "c6000000-eeee-4000-8000-0000000000b2";
const bearer = (actor: string, roles = ["platform_admin"]) => ({ authorization: `Bearer ${signToken({ sub: actor, tid: "c6000000-0000-4000-8000-000000000999", roles, sid: "m6" }, SECRET, 3600)}` });

async function drain() { await (queue as unknown as { drain: () => Promise<void> }).drain(); }
async function inTenant<R>(fn: (tx: typeof sqlClient) => Promise<R>): Promise<R> {
  return sqlClient.begin(async (tx) => { await tx`SELECT set_config('app.tenant_id', ${T}, true)`; return fn(tx as unknown as typeof sqlClient); }) as Promise<R>;
}
const userModules = async () => (await inTenant((tx) => tx`SELECT module_id FROM composition.tenant_entitlement WHERE tenant_id = ${T} AND source = 'user' ORDER BY module_id`)).map((r) => r.module_id as string);
const requests = async () => inTenant((tx) => tx`SELECT * FROM composition.plan_apply_requests WHERE tenant_id = ${T} ORDER BY requested_at`);
const auditActions = async () => (await inTenant((tx) => tx`SELECT payload->>'action' AS a FROM _outbox.messages WHERE tenant_id = ${T} AND event_type = 'audit.event.record'`)).map((r) => r.a as string);
async function wipe() {
  await inTenant(async (tx) => {
    await tx`DELETE FROM composition.plan_apply_requests WHERE tenant_id = ${T}`;
    await tx`DELETE FROM composition.tenant_entitlement WHERE tenant_id = ${T}`;
    await tx`DELETE FROM composition.tenant_profile WHERE tenant_id = ${T}`;
    await tx`DELETE FROM _outbox.messages WHERE tenant_id = ${T}`;
  });
}

let app: FastifyInstance;
beforeAll(async () => {
  registerCompositionConsumers(queue);
  await queue.start();
  app = await buildApp();
  await wipe();
});
afterAll(async () => {
  delete process.env.PLAN_APPLY_MAKER_CHECKER;
  await wipe();
  await app.close();
  await queue.stop();
  await sqlClient.end();
});

const post = (url: string, actor: string, payload: unknown, roles?: string[]) => app.inject({ method: "POST", url, headers: bearer(actor, roles), payload: payload as object });

describe("M6 plan application: maker-checker + audit", () => {
  it("default (flag off): the direct apply-plan route behaves exactly as before and sets the baseline", async () => {
    const r = await post("/v1/admin/composition/apply-plan", MAKER, { tenantId: T, moduleIds: ["finance"] });
    expect(r.statusCode).toBe(202);
    await drain();
    expect(await userModules()).toEqual(["finance"]);
  });

  it("a request changes nothing; the requester cannot approve; only another admin's approval applies the plan", async () => {
    const req = await post("/v1/admin/composition/plan-applications", MAKER, { tenantId: T, planCode: "hr_payroll", moduleIds: ["payroll"] });
    expect(req.statusCode).toBe(202);
    const id = req.json().id as string;
    await drain();
    expect(await userModules()).toEqual(["finance"]); // untouched
    const [row] = await requests();
    expect(row).toMatchObject({ id, status: "pending", plan_code: "hr_payroll", requested_by: MAKER });
    expect(row!.user_module_ids).toEqual(["payroll"]);

    // a second request while one is pending is refused
    const dup = await post("/v1/admin/composition/plan-applications", MAKER, { tenantId: T, planCode: "other", moduleIds: ["leave"] });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().code).toBe("PLAN_APPLY_PENDING");

    // maker cannot approve or reject
    const self = await post(`/v1/admin/composition/plan-applications/${id}/approve`, MAKER, { tenantId: T });
    expect(self.statusCode).toBe(409);
    expect(self.json().code).toBe("MAKER_CHECKER_VIOLATION");
    const selfReject = await post(`/v1/admin/composition/plan-applications/${id}/reject`, MAKER, { tenantId: T, reason: "changed my mind" });
    expect(selfReject.statusCode).toBe(409);

    // the consumer re-checks even if the route is bypassed (a decide command published with the maker as actor)
    await queue.publish(COMMANDS.compositionPlanApplyDecide, {
      messageId: "c6000000-aaaa-4000-8000-000000000001", type: COMMANDS.compositionPlanApplyDecide, tenantId: T, actorId: MAKER,
      correlationId: "c6-bypass", schemaVersion: "1.0", payload: { tenantId: T, requestId: id, decision: "approve" },
    });
    await drain();
    expect((await requests())[0]!.status).toBe("pending");
    expect(await userModules()).toEqual(["finance"]);

    // the DB CHECK is the last line
    await expect(inTenant((tx) => tx`UPDATE composition.plan_apply_requests SET status='applied', decided_by=requested_by WHERE id=${id}`)).rejects.toThrow(/chk_plan_apply_maker_checker/);

    // a different admin approves
    const ok = await post(`/v1/admin/composition/plan-applications/${id}/approve`, CHECKER, { tenantId: T });
    expect(ok.statusCode).toBe(202);
    await drain();
    expect(await userModules()).toEqual(["payroll"]);
    const [done] = await requests();
    expect(done).toMatchObject({ status: "applied", decided_by: CHECKER });
    expect(done!.previous_user_modules).toEqual(["finance"]);

    // the tenant now resolves payroll's hard dependency (employee) through the catalogue/composition read
    const comp = await app.inject({ method: "GET", url: "/v1/admin/composition/tenant", headers: bearer(MAKER, ["tenant_admin"]) });
    expect(comp.statusCode).toBe(200); // read path unchanged (tenant_admin of its own tenant)

    // audit trail: requested, approved, and the standard applier event
    const actions = await auditActions();
    expect(actions).toEqual(expect.arrayContaining(["composition_apply_plan", "composition_plan_apply_requested", "composition_plan_apply_approved"]));

    // a decided request cannot be decided again
    const again = await post(`/v1/admin/composition/plan-applications/${id}/approve`, CHECKER, { tenantId: T });
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe("NOT_PENDING");
  });

  it("a rejection changes nothing, needs a reason and is audited", async () => {
    const before = await userModules();
    const req = await post("/v1/admin/composition/plan-applications", MAKER, { tenantId: T, planCode: "hr_leave", moduleIds: ["employee", "leave"] });
    expect(req.statusCode).toBe(202);
    const id = req.json().id as string;
    await drain();
    const noReason = await post(`/v1/admin/composition/plan-applications/${id}/reject`, CHECKER, { tenantId: T, reason: "no" });
    expect(noReason.statusCode).toBe(400);
    const rej = await post(`/v1/admin/composition/plan-applications/${id}/reject`, CHECKER, { tenantId: T, reason: "customer has not signed the order" });
    expect(rej.statusCode).toBe(202);
    await drain();
    expect(await userModules()).toEqual(before);
    const last = (await requests()).find((r) => r.id === id)!;
    expect(last).toMatchObject({ status: "rejected", decided_by: CHECKER, decision_reason: "customer has not signed the order" });
    expect(await auditActions()).toContain("composition_plan_apply_rejected");
  });

  it("validates the module set and the caller", async () => {
    const bad = await post("/v1/admin/composition/plan-applications", MAKER, { tenantId: T, planCode: "x", moduleIds: ["not_a_module"] });
    expect(bad.statusCode).toBe(404);
    expect(bad.json().code).toBe("UNKNOWN_MODULE");
    const forbidden = await post("/v1/admin/composition/plan-applications", MAKER, { tenantId: T, planCode: "x", moduleIds: ["leave"] }, ["tenant_admin"]);
    expect(forbidden.statusCode).toBe(403);
    const list = await app.inject({ method: "GET", url: `/v1/admin/composition/plan-applications?tenantId=${T}`, headers: bearer(MAKER) });
    expect(list.statusCode).toBe(200);
    expect(list.json().requests.length).toBe(2);
  });

  it("PLAN_APPLY_MAKER_CHECKER=on closes the direct apply route; off reopens it", async () => {
    process.env.PLAN_APPLY_MAKER_CHECKER = "on";
    const blocked = await post("/v1/admin/composition/apply-plan", MAKER, { tenantId: T, moduleIds: ["finance"] });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().code).toBe("PLAN_APPLY_REQUIRES_APPROVAL");
    delete process.env.PLAN_APPLY_MAKER_CHECKER;
    const open = await post("/v1/admin/composition/apply-plan", MAKER, { tenantId: T, moduleIds: ["payroll"] });
    expect(open.statusCode).toBe(202);
    await drain();
  });
});
