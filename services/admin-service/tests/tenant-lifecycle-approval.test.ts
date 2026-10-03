/**
 * GAP-ADMIN-TENANTS-DETAIL-05 -- tenant lifecycle maker-checker, against a real
 * Postgres (FORCE RLS on, NOBYPASSRLS service role) and the real routes.
 *
 * Flow under test: HTTP route -> command on the queue -> consumer transaction
 * -> request row + audit outbox event. Several cases also publish the command
 * straight at the consumer, because the route's pre-check is only a courtesy:
 * the consumer must refuse on its own.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import type { FastifyInstance } from "fastify";

const { buildApp } = await import("../src/app.js");
const { db, sqlClient } = await import("../src/shared/db.js");
const { queue } = await import("../src/shared/infra.js");
const { tenantScoped } = await import("../src/shared/tenant-queue.js");
const { outboxMessages } = await import("../src/shared/outbox.js");
const { adminTenants, tenantLifecycleRequests: R, tenantLifecycleApprovals: A } = await import("../src/modules/tenants/schema.js");
const consumer = await import("../src/modules/tenants/lifecycle-consumer.js");
const { COMMANDS } = await import("../src/topics.js");
const commands = await import("../src/modules/tenants/lifecycle-commands.js");

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const PLAT = "0a000000-0000-4000-8000-0000000000a1";
const REQ_USER = "0a111111-0000-4000-8000-000000000001"; // platform_admin
const APPR_SA = "0a222222-0000-4000-8000-000000000002"; // super_admin
const APPR_PA = "0a333333-0000-4000-8000-000000000003"; // platform_admin
const TENANT_ADMIN = "0a444444-0000-4000-8000-000000000004";
const T = "0a000000-0000-4000-8000-0000000000b1";

function bearer(sub: string, roles: string[], tid = PLAT): { authorization: string } {
  return { authorization: `Bearer ${signToken({ sub, tid, roles, sid: "s" }, SECRET, 3600)}` };
}

function seedRow(id: string, status: string, settings: Record<string, unknown> = {}) {
  return {
    id, tenantId: id, name: "Lifecycle Office", domain: `lc-${id}.example`, edition: "psu", status,
    region: "ap-south-1", residency: "IN", settings, createdBy: REQ_USER, updatedBy: REQ_USER, version: 1,
  };
}

async function wipe(id: string): Promise<void> {
  await runWithTenant(id, () => db.transaction(async (tx) => {
    await tx.delete(A).where(eq(A.tenantId, id));
    await tx.delete(R).where(eq(R.tenantId, id));
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, id));
    await tx.delete(adminTenants).where(eq(adminTenants.id, id));
  }));
}

async function seedTenant(status: string, settings: Record<string, unknown> = {}): Promise<void> {
  await wipe(T);
  await runWithTenant(T, () => db.transaction(async (tx) => { await tx.insert(adminTenants).values(seedRow(T, status, settings)); }));
}

const tenantRow = () => runWithTenant(T, () => db.transaction(async (tx) =>
  (await tx.select().from(adminTenants).where(eq(adminTenants.id, T)))[0]!));
const requests = () => runWithTenant(T, () => db.transaction((tx) => tx.select().from(R).where(eq(R.tenantId, T))));
const approvals = () => runWithTenant(T, () => db.transaction((tx) => tx.select().from(A).where(eq(A.tenantId, T))));
async function auditRows(action: string) {
  const rows = await runWithTenant(T, () => db.transaction((tx) =>
    tx.select().from(outboxMessages).where(and(eq(outboxMessages.tenantId, T), eq(outboxMessages.eventType, "audit.event.record")))));
  return rows.filter((r) => (r.payload as { action?: string }).action === action);
}
async function eventRows(eventType: string) {
  return runWithTenant(T, () => db.transaction((tx) =>
    tx.select().from(outboxMessages).where(and(eq(outboxMessages.tenantId, T), eq(outboxMessages.eventType, eventType)))));
}

async function waitFor<V>(read: () => Promise<V>, ok: (v: V) => boolean, ms = 4000): Promise<V> {
  const t0 = Date.now();
  for (;;) {
    const v = await read();
    if (ok(v)) return v;
    if (Date.now() - t0 > ms) return v;
    await new Promise((r) => setTimeout(r, 40));
  }
}

let app: FastifyInstance;
beforeAll(async () => {
  consumer.registerTenantLifecycleConsumers(tenantScoped(queue));
  await queue.start();
  app = await buildApp();
});
afterEach(async () => { await wipe(T); });
afterAll(async () => { await wipe(T); await app.close(); await queue.stop(); await sqlClient.end(); });

async function post(path: string, who: { authorization: string }, payload: unknown) {
  return app.inject({ method: "POST", url: `/v1/admin/tenants/${T}${path}`, headers: who, payload: payload as object });
}
const requestSuspend = (who = bearer(REQ_USER, ["platform_admin"]), extra: Record<string, unknown> = {}) =>
  post("/lifecycle-requests", who, { kind: "suspend", reason: "Non-payment of dues", ...extra });

async function decideMsg(requestId: string, actorId: string, roles: string[], decision: "approve" | "reject", tid = PLAT) {
  return {
    messageId: randomUUID(), tenantId: T, actorId, correlationId: randomUUID(),
    payload: { requestId, decision, comment: null, actorTenantId: tid, actorRoles: roles },
  };
}

describe("approval policy resolution (pure)", () => {
  it("defaults, invalid stored value falls back to the strict default", async () => {
    const { resolvePolicy, requirementsFor, DEFAULT_APPROVAL_POLICY } = await import("../src/modules/tenants/lifecycle-domain.js");
    expect(resolvePolicy({})).toEqual(DEFAULT_APPROVAL_POLICY);
    expect(resolvePolicy({ approvalPolicy: { minApprovals: 99 } })).toEqual(DEFAULT_APPROVAL_POLICY);
    expect(resolvePolicy({ approvalPolicy: { requiresSecondApprover: false } }).requiresSecondApprover).toBe(false);
    const off = resolvePolicy({ approvalPolicy: { requiresSecondApprover: false } });
    expect(requirementsFor("suspend", off).direct).toBe(true);
    // the policy itself is never directly editable
    expect(requirementsFor("policy_change", off)).toMatchObject({ direct: false, requiredApprovals: 1 });
  });
});

describe("maker-checker on suspend (real DB)", () => {
  it("the requester cannot approve their own request (route 403 and consumer refusal)", async () => {
    await seedTenant("active");
    const res = await requestSuspend();
    expect(res.statusCode).toBe(202);
    const id = (res.json() as { id: string }).id;
    const [row] = await waitFor(requests, (r) => r.length === 1);
    expect(row).toMatchObject({ id, status: "pending", kind: "suspend", requestedBy: REQ_USER });

    const viaRoute = await post(`/lifecycle-requests/${id}/decision`, bearer(REQ_USER, ["platform_admin"]), { decision: "approve" });
    expect(viaRoute.statusCode).toBe(403);
    expect((viaRoute.json() as { code: string }).code).toBe("MAKER_CHECKER_VIOLATION");

    // Bypass the route entirely: the consumer must still refuse.
    await runWithTenant(T, async () => consumer.handleDecision(await decideMsg(id, REQ_USER, ["platform_admin"], "approve") as never));
    expect((await tenantRow()).status).toBe("active");
    expect((await requests())[0]!.status).toBe("pending");
    expect(await approvals()).toHaveLength(0);
    expect(await auditRows("suspend_decision_denied")).toHaveLength(1);
  });

  it("a role outside approverRoles is refused; one inside it approves and the tenant is suspended", async () => {
    await seedTenant("active", { approvalPolicy: { approverRoles: ["super_admin"] } });
    const id = ((await requestSuspend()).json() as { id: string }).id;
    await waitFor(requests, (r) => r.length === 1);

    const refused = await post(`/lifecycle-requests/${id}/decision`, bearer(APPR_PA, ["platform_admin"]), { decision: "approve" });
    expect(refused.statusCode).toBe(403);
    expect((refused.json() as { code: string }).code).toBe("NOT_AN_APPROVER");
    await runWithTenant(T, async () => consumer.handleDecision(await decideMsg(id, APPR_PA, ["platform_admin"], "approve") as never));
    expect((await tenantRow()).status).toBe("active");

    const ok = await post(`/lifecycle-requests/${id}/decision`, bearer(APPR_SA, ["super_admin"]), { decision: "approve", comment: "confirmed" });
    expect(ok.statusCode).toBe(202);
    const [done] = await waitFor(requests, (r) => r[0]?.status === "executed");
    expect(done).toMatchObject({ status: "executed", decidedBy: APPR_SA });
    const t = await tenantRow();
    expect(t.status).toBe("suspended");
    expect(t.version).toBe(2);
    const [audit] = await auditRows("suspend");
    expect(audit!.payload).toMatchObject({
      requestId: id, requestedBy: REQ_USER, approvedBy: APPR_SA, oldValue: { status: "active" }, newValue: { status: "suspended" },
    });
    expect(await eventRows("admin.tenant.suspended")).toHaveLength(1);
  });

  it("two concurrent approvals produce exactly one execution and one audit event", async () => {
    await seedTenant("active");
    const id = ((await requestSuspend()).json() as { id: string }).id;
    await waitFor(requests, (r) => r.length === 1);

    const a = await decideMsg(id, APPR_SA, ["super_admin"], "approve");
    const b = await decideMsg(id, APPR_PA, ["platform_admin"], "approve");
    await Promise.all([
      runWithTenant(T, () => consumer.handleDecision(a as never)),
      runWithTenant(T, () => consumer.handleDecision(b as never)),
    ]);

    const t = await tenantRow();
    expect(t.status).toBe("suspended");
    expect(t.version).toBe(2); // bumped once, not twice
    expect(await auditRows("suspend")).toHaveLength(1);
    expect(await eventRows("admin.tenant.suspended")).toHaveLength(1);
    expect(await approvals()).toHaveLength(1); // the loser withdrew its vote
    expect((await requests())[0]!.approvalsCount).toBe(1);
  });

  it("an approve racing a reject decides the request exactly once", async () => {
    await seedTenant("active");
    const id = ((await requestSuspend()).json() as { id: string }).id;
    await waitFor(requests, (r) => r.length === 1);
    const a = await decideMsg(id, APPR_SA, ["super_admin"], "approve");
    const b = await decideMsg(id, APPR_PA, ["platform_admin"], "reject");
    await Promise.all([
      runWithTenant(T, () => consumer.handleDecision(a as never)),
      runWithTenant(T, () => consumer.handleDecision(b as never)),
    ]);
    const [r] = await requests();
    expect(["executed", "rejected"]).toContain(r!.status);
    const suspended = (await tenantRow()).status === "suspended";
    expect(suspended).toBe(r!.status === "executed");
    expect((await auditRows("suspend")).length + (await auditRows("suspend_rejected")).length).toBe(1);
  });

  it("minApprovals=2 needs two distinct approvers and a repeat vote does not count", async () => {
    await seedTenant("active", { approvalPolicy: { minApprovals: 2 } });
    const id = ((await requestSuspend()).json() as { id: string }).id;
    await waitFor(requests, (r) => r.length === 1);
    await runWithTenant(T, async () => consumer.handleDecision(await decideMsg(id, APPR_SA, ["super_admin"], "approve") as never));
    await runWithTenant(T, async () => consumer.handleDecision(await decideMsg(id, APPR_SA, ["super_admin"], "approve") as never));
    expect((await requests())[0]).toMatchObject({ status: "pending", approvalsCount: 1 });
    expect((await tenantRow()).status).toBe("active");
    await runWithTenant(T, async () => consumer.handleDecision(await decideMsg(id, APPR_PA, ["platform_admin"], "approve") as never));
    expect((await requests())[0]!.status).toBe("executed");
    expect((await tenantRow()).status).toBe("suspended");
    expect(await auditRows("suspend")).toHaveLength(1);
  });
});

describe("policy says no second approver", () => {
  it("the requester's action executes directly and is still audited", async () => {
    await seedTenant("active", { approvalPolicy: { requiresSecondApprover: false } });
    const res = await requestSuspend();
    expect(res.statusCode).toBe(202);
    const [row] = await waitFor(requests, (r) => r[0]?.status === "executed");
    expect(row).toMatchObject({ status: "executed", directExecution: true, requestedBy: REQ_USER });
    expect((await tenantRow()).status).toBe("suspended");
    const [audit] = await auditRows("suspend");
    expect(audit!.payload).toMatchObject({ directExecution: true, requestedBy: REQ_USER, approvedBy: REQ_USER });
  });

  it("an actor outside approverRoles still cannot act directly", async () => {
    await seedTenant("active", { approvalPolicy: { requiresSecondApprover: false, approverRoles: ["super_admin"] } });
    const res = await requestSuspend(bearer(REQ_USER, ["platform_admin"]));
    expect(res.statusCode).toBe(403);
    expect((await tenantRow()).status).toBe("active");
  });
});

describe("changing the policy itself", () => {
  const newPolicy = { requiresSecondApprover: false, approverRoles: ["super_admin", "platform_admin"], minApprovals: 1, reasonRequired: true, notifyTenantAdmins: true };

  it("always needs a second platform approver, even when the policy says none is needed", async () => {
    await seedTenant("active", { approvalPolicy: { requiresSecondApprover: false } });
    const put = await app.inject({ method: "PUT", url: `/v1/admin/tenants/${T}/approval-policy`, headers: bearer(REQ_USER, ["platform_admin"]),
      payload: { policy: newPolicy, reason: "Small office, one operator" } });
    expect(put.statusCode).toBe(202);
    const id = (put.json() as { id: string }).id;
    const [pending] = await waitFor(requests, (r) => r.length === 1);
    expect(pending).toMatchObject({ kind: "policy_change", status: "pending", requiredApprovals: 1 });
    expect((await tenantRow()).settings).toEqual({ approvalPolicy: { requiresSecondApprover: false } }); // untouched until approved

    const self = await post(`/lifecycle-requests/${id}/decision`, bearer(REQ_USER, ["platform_admin"]), { decision: "approve" });
    expect(self.statusCode).toBe(403);

    // The policy edit changed nothing yet; approve as a second operator.
    const ok = await post(`/lifecycle-requests/${id}/decision`, bearer(APPR_SA, ["super_admin"]), { decision: "approve" });
    expect(ok.statusCode).toBe(202);
    await waitFor(requests, (r) => r[0]?.status === "executed");
    const stored = (await tenantRow()).settings as { approvalPolicy: Record<string, unknown> };
    expect(stored.approvalPolicy).toMatchObject({ requiresSecondApprover: false, approverRoles: ["super_admin", "platform_admin"] });
    const [audit] = await auditRows("policy_change");
    expect(audit!.payload).toMatchObject({
      oldValue: { approvalPolicy: { requiresSecondApprover: false } },
      newValue: { approvalPolicy: { requiresSecondApprover: false, notifyTenantAdmins: true } },
    });
  });

  it("rejects an invalid policy and a missing reason", async () => {
    await seedTenant("active");
    const bad = await app.inject({ method: "PUT", url: `/v1/admin/tenants/${T}/approval-policy`, headers: bearer(REQ_USER, ["platform_admin"]),
      payload: { policy: { ...newPolicy, approverRoles: ["tenant_admin"] }, reason: "x y z" } });
    expect(bad.statusCode).toBe(400);
    const noReason = await app.inject({ method: "PUT", url: `/v1/admin/tenants/${T}/approval-policy`, headers: bearer(REQ_USER, ["platform_admin"]),
      payload: { policy: newPolicy } });
    expect(noReason.statusCode).toBe(400);
  });

  it("GET returns the effective policy with defaults filled in", async () => {
    await seedTenant("active");
    const res = await app.inject({ method: "GET", url: `/v1/admin/tenants/${T}/approval-policy`, headers: bearer(REQ_USER, ["platform_admin"]) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ isDefault: true, policy: { requiresSecondApprover: true, minApprovals: 1, reasonRequired: true } });
  });
});

describe("a tenant's own admin", () => {
  it("cannot suspend (route 403) and, with a forged platform role inside the tenant, is refused by both route and consumer", async () => {
    await seedTenant("active");
    const plain = await requestSuspend(bearer(TENANT_ADMIN, ["tenant_admin"], T));
    expect(plain.statusCode).toBe(403);

    const forged = await requestSuspend(bearer(TENANT_ADMIN, ["tenant_admin", "platform_admin"], T));
    expect(forged.statusCode).toBe(403);
    expect((forged.json() as { code: string }).code).toBe("TENANT_SELF_ACTION_FORBIDDEN");

    // Straight at the consumer, as if the route had let it through.
    const msg = {
      messageId: randomUUID(), tenantId: T, actorId: TENANT_ADMIN, correlationId: randomUUID(),
      payload: { requestId: randomUUID(), kind: "suspend", reason: "locking us out", effectiveAt: null, actorTenantId: T, actorRoles: ["tenant_admin", "platform_admin"] },
    };
    await runWithTenant(T, () => consumer.handleRequest(msg as never));
    expect((await tenantRow()).status).toBe("active");
    expect((await requests())[0]).toMatchObject({ status: "failed", failureCode: "TENANT_SELF_ACTION_FORBIDDEN" });
    expect(await auditRows("suspend_denied")).toHaveLength(1);
  });

  it("cannot approve a request against their own tenant", async () => {
    await seedTenant("active");
    const id = ((await requestSuspend()).json() as { id: string }).id;
    await waitFor(requests, (r) => r.length === 1);
    await runWithTenant(T, async () => consumer.handleDecision(
      await decideMsg(id, TENANT_ADMIN, ["tenant_admin", "super_admin"], "approve", T) as never));
    expect((await tenantRow()).status).toBe("active");
    expect((await requests())[0]!.status).toBe("pending");
    expect(await auditRows("suspend_decision_denied")).toHaveLength(1);
  });
});

describe("reactivate, edit, reject, scheduling", () => {
  it("reactivate restores the tenant to active after an approved suspension", async () => {
    await seedTenant("active");
    const sid = ((await requestSuspend()).json() as { id: string }).id;
    await waitFor(requests, (r) => r.length === 1);
    await post(`/lifecycle-requests/${sid}/decision`, bearer(APPR_SA, ["super_admin"]), { decision: "approve" });
    await waitFor(tenantRow, (t) => t.status === "suspended");

    // reactivating an active tenant is refused up front; this one is suspended
    const rid = ((await post("/lifecycle-requests", bearer(REQ_USER, ["platform_admin"]), { kind: "reactivate", reason: "Dues cleared" })).json() as { id: string }).id;
    await waitFor(requests, (r) => r.some((x) => x.id === rid));
    const ok = await post(`/lifecycle-requests/${rid}/decision`, bearer(APPR_PA, ["platform_admin"]), { decision: "approve" });
    expect(ok.statusCode).toBe(202);
    const t = await waitFor(tenantRow, (x) => x.status === "active");
    expect(t.status).toBe("active");
    expect(t.version).toBe(3);
    expect(await auditRows("reactivate")).toHaveLength(1);
    expect(await eventRows("admin.tenant.reactivated")).toHaveLength(1);
  });

  it("refuses to suspend a non-active tenant and to reactivate an active one", async () => {
    await seedTenant("suspended");
    expect((await requestSuspend()).statusCode).toBe(409);
    await seedTenant("active");
    const r = await post("/lifecycle-requests", bearer(REQ_USER, ["platform_admin"]), { kind: "reactivate", reason: "No need" });
    expect(r.statusCode).toBe(409);
  });

  it("a second open request of the same kind is refused", async () => {
    await seedTenant("active");
    expect((await requestSuspend()).statusCode).toBe(202);
    await waitFor(requests, (r) => r.length === 1);
    const again = await requestSuspend();
    expect(again.statusCode).toBe(409);
    expect((again.json() as { code: string }).code).toBe("REQUEST_ALREADY_OPEN");
  });

  it("requires a reason when the policy says so, and not when it does not", async () => {
    await seedTenant("active");
    const none = await post("/lifecycle-requests", bearer(REQ_USER, ["platform_admin"]), { kind: "suspend" });
    expect(none.statusCode).toBe(400);
    await seedTenant("active", { approvalPolicy: { reasonRequired: false } });
    const ok = await post("/lifecycle-requests", bearer(REQ_USER, ["platform_admin"]), { kind: "suspend" });
    expect(ok.statusCode).toBe(202);
  });

  it("edit applies name/domain after approval with before/after in the audit event", async () => {
    await seedTenant("active");
    const res = await post("/lifecycle-requests", bearer(REQ_USER, ["platform_admin"]), {
      kind: "edit", reason: "Office renamed", changes: { name: "Renamed Office" } });
    const id = (res.json() as { id: string }).id;
    await waitFor(requests, (r) => r.length === 1);
    expect((await tenantRow()).name).toBe("Lifecycle Office");
    await post(`/lifecycle-requests/${id}/decision`, bearer(APPR_SA, ["super_admin"]), { decision: "approve" });
    await waitFor(tenantRow, (t) => t.name === "Renamed Office");
    const [audit] = await auditRows("edit");
    expect(audit!.payload).toMatchObject({ oldValue: { name: "Lifecycle Office" }, newValue: { name: "Renamed Office" } });
  });

  it("an edit that collides on the unique domain fails the request and leaves the tenant untouched", async () => {
    await seedTenant("active");
    const other = "0a000000-0000-4000-8000-0000000000b2";
    await wipe(other);
    await runWithTenant(other, () => db.transaction(async (tx) => { await tx.insert(adminTenants).values(seedRow(other, "active")); }));
    try {
      const id = ((await post("/lifecycle-requests", bearer(REQ_USER, ["platform_admin"]), {
        kind: "edit", reason: "Take the other domain", changes: { domain: `lc-${other}.example` } })).json() as { id: string }).id;
      await waitFor(requests, (r) => r.length === 1);
      await post(`/lifecycle-requests/${id}/decision`, bearer(APPR_SA, ["super_admin"]), { decision: "approve" });
      const [r] = await waitFor(requests, (x) => x[0]?.status === "failed");
      expect(r).toMatchObject({ status: "failed", failureCode: "EXECUTION_FAILED" });
      expect((await tenantRow()).domain).toBe(`lc-${T}.example`);
    } finally { await wipe(other); }
  });

  it("reject closes the request without touching the tenant, and the decision is audited", async () => {
    await seedTenant("active");
    const id = ((await requestSuspend()).json() as { id: string }).id;
    await waitFor(requests, (r) => r.length === 1);
    await post(`/lifecycle-requests/${id}/decision`, bearer(APPR_SA, ["super_admin"]), { decision: "reject", comment: "Not justified" });
    const [r] = await waitFor(requests, (x) => x[0]?.status === "rejected");
    expect(r).toMatchObject({ status: "rejected", decisionReason: "Not justified" });
    expect((await tenantRow()).status).toBe("active");
    expect(await auditRows("suspend_rejected")).toHaveLength(1);
  });

  it("a suspension approved for a future time waits, then the due-sweep executes it", async () => {
    await seedTenant("active");
    const when = new Date(Date.now() + 3_600_000).toISOString();
    const id = ((await requestSuspend(undefined, { effectiveAt: when })).json() as { id: string }).id;
    await waitFor(requests, (r) => r.length === 1);
    await post(`/lifecycle-requests/${id}/decision`, bearer(APPR_SA, ["super_admin"]), { decision: "approve" });
    await waitFor(requests, (r) => r[0]?.status === "scheduled");
    expect((await tenantRow()).status).toBe("active");
    expect(await consumer.sweepDueLifecycle()).toBeGreaterThanOrEqual(0);

    // Make it due (as the platform owner would see time pass).
    await runWithTenant(T, () => db.transaction(async (tx) => {
      await tx.update(R).set({ effectiveAt: sql`now() - interval '1 minute'` }).where(eq(R.id, id));
    }));
    await consumer.sweepDueLifecycle();
    await waitFor(tenantRow, (t) => t.status === "suspended");
    expect((await tenantRow()).status).toBe("suspended");
    expect((await requests())[0]!.status).toBe("executed");
    expect(await auditRows("suspend")).toHaveLength(1);
  });

  it("legacy PATCH /suspend no longer bypasses the policy", async () => {
    await seedTenant("active");
    const res = await app.inject({ method: "PATCH", url: `/v1/admin/tenants/${T}/suspend`, headers: bearer(REQ_USER, ["platform_admin"]),
      payload: { reason: "Legacy caller" } });
    expect(res.statusCode).toBe(202);
    await waitFor(requests, (r) => r.length === 1);
    expect((await tenantRow()).status).toBe("active");
    expect((await requests())[0]!.status).toBe("pending");
  });

  it("the list shows who can decide and never exposes raw actor ids", async () => {
    await seedTenant("active");
    await requestSuspend();
    await waitFor(requests, (r) => r.length === 1);
    const mine = await app.inject({ method: "GET", url: `/v1/admin/tenants/${T}/lifecycle-requests?status=pending`, headers: bearer(REQ_USER, ["platform_admin"]) });
    const other = await app.inject({ method: "GET", url: `/v1/admin/tenants/${T}/lifecycle-requests?status=pending`, headers: bearer(APPR_SA, ["super_admin"]) });
    const m = (mine.json() as { items: Array<Record<string, unknown>> }).items[0]!;
    const o = (other.json() as { items: Array<Record<string, unknown>> }).items[0]!;
    expect(m).toMatchObject({ requestedByYou: true, canDecide: false });
    expect(o).toMatchObject({ requestedByYou: false, canDecide: true });
    expect(JSON.stringify(o)).not.toContain(REQ_USER);
  });
});

describe("message ids", () => {
  it("every lifecycle command carries a fresh random uuid, so a repeat decision is never dropped", async () => {
    const { vi } = await import("vitest");
    const spy = vi.spyOn(queue, "publish");
    try {
      await seedTenant("active");
      const id = ((await requestSuspend()).json() as { id: string }).id;
      await waitFor(requests, (r) => r.length === 1);
      const ctx = { tenantId: PLAT, actorId: APPR_PA, actorType: "user" as const, roles: ["platform_admin"], correlationId: "corr-1" };
      // The same decision twice: with a deterministic id the second would be dropped as "already processed".
      await commands.decideLifecycleRequest(ctx, T, id, "approve", null);
      await commands.decideLifecycleRequest(ctx, T, id, "approve", null);
      const ids = spy.mock.calls
        .filter((c) => String(c[0]).startsWith("admin.tenant_lifecycle."))
        .map((c) => (c[1] as { messageId: string }).messageId);
      expect(ids.length).toBeGreaterThanOrEqual(3); // request + two decisions
      expect(new Set(ids).size).toBe(ids.length);
      for (const m of ids) expect(m).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(spy.mock.calls.some((c) => c[0] === COMMANDS.tenantLifecycleDecide)).toBe(true);
    } finally { spy.mockRestore(); }
  });
});

describe("review follow-ups", () => {
  it("anyone acting from inside the target tenant is refused, even with only platform roles", async () => {
    await seedTenant("active");
    const insider = bearer(APPR_SA, ["platform_admin", "super_admin"], T);
    const res = await requestSuspend(insider);
    expect(res.statusCode).toBe(403);
    expect((res.json() as { code: string }).code).toBe("TENANT_SELF_ACTION_FORBIDDEN");

    // straight at the consumer
    const msg = {
      messageId: randomUUID(), tenantId: T, actorId: APPR_SA, correlationId: randomUUID(),
      payload: { requestId: randomUUID(), kind: "suspend", reason: "inside job", effectiveAt: null, actorTenantId: T, actorRoles: ["platform_admin"] },
    };
    await runWithTenant(T, () => consumer.handleRequest(msg as never));
    expect((await tenantRow()).status).toBe("active");
    expect((await requests())[0]).toMatchObject({ status: "failed", failureCode: "TENANT_SELF_ACTION_FORBIDDEN" });

    // and cannot approve a genuine request either
    await wipe(T);
    await seedTenant("active");
    const id = ((await requestSuspend()).json() as { id: string }).id;
    await waitFor(requests, (r) => r.length === 1);
    await runWithTenant(T, async () => consumer.handleDecision(await decideMsg(id, APPR_SA, ["platform_admin"], "approve", T) as never));
    expect((await requests())[0]!.status).toBe("pending");
    expect((await tenantRow()).status).toBe("active");
  });

  it("a transient database error is retried, not recorded as a permanent failure", async () => {
    await seedTenant("active");
    const id = ((await requestSuspend()).json() as { id: string }).id;
    await waitFor(requests, (r) => r.length === 1);
    const msg = await decideMsg(id, APPR_SA, ["super_admin"], "approve");
    await sqlClient.unsafe(`CREATE OR REPLACE FUNCTION tenants.dec02_transient() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'simulated serialization failure' USING ERRCODE = '40001'; END $$`);
    await sqlClient.unsafe(`CREATE TRIGGER dec02_transient BEFORE UPDATE ON tenants.admin_tenants FOR EACH ROW WHEN (NEW.id = '${T}') EXECUTE FUNCTION tenants.dec02_transient()`);
    try {
      await expect(runWithTenant(T, () => consumer.handleDecision(msg as never))).rejects.toThrow();
      const [r] = await requests();
      expect(r).toMatchObject({ status: "pending", approvalsCount: 0, failureCode: null });
      expect(await approvals()).toHaveLength(0);
      expect(await auditRows("suspend")).toHaveLength(0);
    } finally {
      await sqlClient.unsafe(`DROP TRIGGER IF EXISTS dec02_transient ON tenants.admin_tenants`);
      await sqlClient.unsafe(`DROP FUNCTION IF EXISTS tenants.dec02_transient()`);
    }
    // Redelivery of the SAME message now succeeds: the failed attempt was not marked processed.
    await runWithTenant(T, () => consumer.handleDecision(msg as never));
    expect((await requests())[0]!.status).toBe("executed");
    expect((await tenantRow()).status).toBe("suspended");
    expect(await auditRows("suspend")).toHaveLength(1);
  });

  it("a partial approval does not set decided_by / decided_at; the final one does", async () => {
    await seedTenant("active", { approvalPolicy: { minApprovals: 2 } });
    const id = ((await requestSuspend()).json() as { id: string }).id;
    await waitFor(requests, (r) => r.length === 1);
    await runWithTenant(T, async () => consumer.handleDecision(await decideMsg(id, APPR_SA, ["super_admin"], "approve") as never));
    expect((await requests())[0]).toMatchObject({ status: "pending", approvalsCount: 1, decidedBy: null, decidedAt: null, decisionReason: null });
    await runWithTenant(T, async () => consumer.handleDecision(await decideMsg(id, APPR_PA, ["platform_admin"], "approve") as never));
    const [done] = await requests();
    expect(done).toMatchObject({ status: "executed", decidedBy: APPR_PA });
    expect(done!.decidedAt).not.toBeNull();
  });
});

describe("cancelling a scheduled request", () => {
  const OTHER = "0a555555-0000-4000-8000-000000000005";
  async function scheduled(): Promise<string> {
    await seedTenant("active");
    const when = new Date(Date.now() + 3_600_000).toISOString();
    const id = ((await requestSuspend(undefined, { effectiveAt: when })).json() as { id: string }).id;
    await waitFor(requests, (r) => r.length === 1);
    await post(`/lifecycle-requests/${id}/decision`, bearer(APPR_SA, ["super_admin"]), { decision: "approve" });
    await waitFor(requests, (r) => r[0]?.status === "scheduled");
    return id;
  }
  const cancel = (id: string, who: { authorization: string }, reason: string | null = "Dues were paid") =>
    post(`/lifecycle-requests/${id}/cancel`, who, reason === null ? {} : { reason });

  it("the requester can cancel with a reason; it is audited and the tenant is never suspended", async () => {
    const id = await scheduled();
    expect((await cancel(id, bearer(REQ_USER, ["platform_admin"]))).statusCode).toBe(202);
    const [r] = await waitFor(requests, (x) => x[0]?.status === "cancelled");
    expect(r).toMatchObject({ status: "cancelled", cancelledBy: REQ_USER, cancelReason: "Dues were paid" });
    const [audit] = await auditRows("suspend_cancelled");
    expect(audit!.payload).toMatchObject({ requestId: id, requestedBy: REQ_USER, approvers: [APPR_SA], reason: "Dues were paid" });
    await consumer.sweepDueLifecycle();
    expect((await tenantRow()).status).toBe("active");
  });

  it("an approver can cancel; an unrelated platform admin cannot", async () => {
    const id = await scheduled();
    const stranger = await cancel(id, bearer(OTHER, ["platform_admin"]));
    expect(stranger.statusCode).toBe(403);
    expect((stranger.json() as { code: string }).code).toBe("NOT_PARTY_TO_REQUEST");
    // consumer refuses on its own too
    await runWithTenant(T, () => consumer.handleCancel({
      messageId: randomUUID(), tenantId: T, actorId: OTHER, correlationId: randomUUID(),
      payload: { requestId: id, reason: "sneaky", actorTenantId: PLAT, actorRoles: ["platform_admin"] },
    } as never));
    expect((await requests())[0]!.status).toBe("scheduled");
    expect(await auditRows("suspend_cancel_denied")).toHaveLength(1);

    expect((await cancel(id, bearer(APPR_SA, ["super_admin"]))).statusCode).toBe(202);
    await waitFor(requests, (x) => x[0]?.status === "cancelled");
  });

  it("needs a reason, and only a scheduled request can be cancelled", async () => {
    const id = await scheduled();
    expect((await cancel(id, bearer(REQ_USER, ["platform_admin"]), null)).statusCode).toBe(400);
    await wipe(T);
    await seedTenant("active");
    const pid = ((await requestSuspend()).json() as { id: string }).id;
    await waitFor(requests, (r) => r.length === 1);
    const res = await cancel(pid, bearer(REQ_USER, ["platform_admin"]));
    expect(res.statusCode).toBe(409);
    expect((res.json() as { code: string }).code).toBe("NOT_SCHEDULED");
  });

  it("cancel racing the due-sweep's execution has exactly one winner", async () => {
    const id = await scheduled();
    await runWithTenant(T, () => db.transaction(async (tx) => {
      await tx.update(R).set({ effectiveAt: sql`now() - interval '1 minute'` }).where(eq(R.id, id));
    }));
    await Promise.all([
      runWithTenant(T, () => consumer.handleCancel({
        messageId: randomUUID(), tenantId: T, actorId: REQ_USER, correlationId: randomUUID(),
        payload: { requestId: id, reason: "last moment", actorTenantId: PLAT, actorRoles: ["platform_admin"] },
      } as never)),
      runWithTenant(T, () => consumer.handleExecuteDue({
        messageId: randomUUID(), tenantId: T, actorId: APPR_SA, correlationId: randomUUID(), payload: { requestId: id },
      } as never)),
    ]);
    const [r] = await requests();
    const executed = (await tenantRow()).status === "suspended";
    expect(executed).toBe(r!.status === "executed");
    expect(["executed", "cancelled"]).toContain(r!.status);
    expect((await auditRows("suspend")).length + (await auditRows("suspend_cancelled")).length).toBe(1);
  });

  it("scheduled execution names its approvers explicitly in the audit event", async () => {
    const id = await scheduled();
    await runWithTenant(T, () => db.transaction(async (tx) => {
      await tx.update(R).set({ effectiveAt: sql`now() - interval '1 minute'` }).where(eq(R.id, id));
    }));
    await consumer.sweepDueLifecycle();
    await waitFor(tenantRow, (t) => t.status === "suspended");
    const [audit] = await auditRows("suspend");
    expect(audit!.payload).toMatchObject({ scheduled: true, approvers: [APPR_SA], approvedBy: APPR_SA, requestedBy: REQ_USER });
  });
});
