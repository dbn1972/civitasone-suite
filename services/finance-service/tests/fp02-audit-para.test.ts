/**
 * GAP-FINANCE-AUDIT-PARAS-DETAIL-04 (fp-finance-02): respond / escalate / settle on a CAG / AG /
 * internal audit para -- status machine, maker != checker on settle, race safety, event trail.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { scoped } from "./_tenant.js";
import { financeAuditParas, financeAuditParaEvents } from "../src/modules/audit/schema.js";
import { financePolicy, financePolicyChanges } from "../src/modules/masters/schema.js";
import { bearer, auditRows, wipeOutbox, startConsumers, drain } from "./_fp02.js";

const T = "aaaaaaaa-0f02-4000-8000-000000000021";
const OFFICER = "00000000-0f02-4000-8000-0000000000e1";
const ADMIN_A = "00000000-0f02-4000-8000-0000000000e2";
const ADMIN_B = "00000000-0f02-4000-8000-0000000000e3";
const AUDITOR = "00000000-0f02-4000-8000-0000000000e4";

const as = (a: string, roles: string[]) => bearer(T, a, roles);
let app: Awaited<ReturnType<typeof buildApp>>;
let n = 0;
async function para(status = "open"): Promise<string> {
  const id = `0f020000-0000-4000-8000-0000000002${String(10 + ++n)}`;
  await scoped(T, (tx) => tx.insert(financeAuditParas).values({
    id, tenantId: T, paraNo: `FP02-CAG-${n}`, source: "CAG", dept: "Public Works", moneyValueMinor: 5_00_000n, status, createdBy: OFFICER, updatedBy: OFFICER,
  }));
  return id;
}
const act = async (id: string, action: string, who: string, roles: string[], payload: object = { note: "Reply recorded per file noting" }) => {
  const res = await app.inject({ method: "POST", url: `/v1/finance/audit-paras/${id}/${action}`, headers: as(who, roles), payload });
  await drain(); // respond / escalate / settle are commands: wait for the consumer
  return res;
};
const statusOf = async (id: string) => (await scoped(T, (tx) => tx.select().from(financeAuditParas).where(eq(financeAuditParas.id, id))))[0]!.status;

async function cleanup() {
  await scoped(T, (tx) => tx.delete(financeAuditParaEvents).where(eq(financeAuditParaEvents.tenantId, T)));
  await scoped(T, (tx) => tx.delete(financeAuditParas).where(eq(financeAuditParas.tenantId, T)));
  await scoped(T, (tx) => tx.delete(financePolicyChanges).where(eq(financePolicyChanges.tenantId, T)));
  await scoped(T, (tx) => tx.delete(financePolicy).where(eq(financePolicy.tenantId, T)));
  await wipeOutbox(T);
}
beforeAll(async () => { await cleanup(); app = await buildApp(); await startConsumers(); });
afterAll(async () => { await cleanup(); await app.close(); await sqlClient.end(); });

describe("audit para workflow", () => {
  it("respond moves open -> responded, stores the reply and audits it; the trail lists it", async () => {
    const id = await para();
    const res = await act(id, "respond", OFFICER, ["finance_officer"], { note: "Department reply dated 12/09 attached" });
    expect(res.statusCode).toBe(202);
    expect(await statusOf(id)).toBe("responded");
    const events = (await app.inject({ method: "GET", url: `/v1/finance/audit-paras/${id}/events`, headers: as(AUDITOR, ["audit_officer"]) })).json().data;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ action: "respond", fromStatus: "open", toStatus: "responded", actorId: OFFICER, note: "Department reply dated 12/09 attached" });
    expect(await auditRows(T, "audit_para_respond", id)).toHaveLength(1);
  });

  it("a note is mandatory and audit_officer cannot act", async () => {
    const id = await para();
    expect((await act(id, "respond", OFFICER, ["finance_officer"], {})).statusCode).toBe(400);
    expect((await act(id, "respond", OFFICER, ["finance_officer"], { note: "abc" })).statusCode).toBe(400);
    expect((await act(id, "respond", AUDITOR, ["audit_officer"])).statusCode).toBe(403);
  });

  it("illegal transitions are 409: cannot settle an open para, cannot respond to a settled one", async () => {
    const id = await para();
    const early = await act(id, "settle", ADMIN_A, ["finance_admin"]);
    expect(early.statusCode).toBe(409);
    expect(early.json().code).toBe("ILLEGAL_TRANSITION");
    await act(id, "respond", OFFICER, ["finance_officer"]);
    expect((await act(id, "settle", ADMIN_A, ["finance_admin"])).statusCode).toBe(202);
    expect(await statusOf(id)).toBe("settled");
    expect((await act(id, "respond", OFFICER, ["finance_officer"])).statusCode).toBe(409);
  });

  it("settle is admin-only", async () => {
    const id = await para("responded");
    expect((await act(id, "settle", OFFICER, ["finance_officer"])).statusCode).toBe(403);
  });

  it("the user who recorded the reply cannot settle it (maker != checker); a different admin can", async () => {
    const id = await para();
    await act(id, "respond", ADMIN_A, ["finance_admin"]);
    const self = await act(id, "settle", ADMIN_A, ["finance_admin"]);
    expect(self.statusCode).toBe(409);
    expect(self.json().code).toBe("MAKER_CHECKER_VIOLATION");
    expect((await act(id, "settle", ADMIN_B, ["finance_admin"])).statusCode).toBe(202);
    expect(await statusOf(id)).toBe("settled");
  });

  it("the consumer is authoritative: a settle by the replier published past the route pre-check is refused", async () => {
    const id = await para();
    await act(id, "respond", ADMIN_A, ["finance_admin"]);
    const { queue } = await import("../src/shared/infra.js");
    await queue.publish("finance.audit_para.transition", {
      messageId: crypto.randomUUID(), type: "finance.audit_para.transition", tenantId: T, actorId: ADMIN_A, correlationId: "c", schemaVersion: "1.0",
      payload: { tenantId: T, id, action: "settle", note: "Closing it myself" },
    });
    await drain();
    expect(await statusOf(id)).toBe("responded");
    expect(await auditRows(T, "audit_para_settle", id)).toHaveLength(0);
  });

  // A para that was already 'responded' before migration 0085 has no recorded replier (responded_by IS NULL).
  // `responded_by <> actor` is NULL for it, which used to match no row and refuse every settle forever.
  it("a legacy 'responded' para with NO recorded replier can still be settled", async () => {
    const id = await para("responded");
    const before = (await scoped(T, (tx) => tx.select().from(financeAuditParas).where(eq(financeAuditParas.id, id))))[0]!;
    expect(before.respondedBy).toBeNull();
    expect((await act(id, "settle", ADMIN_A, ["finance_admin"])).statusCode).toBe(202);
    expect(await statusOf(id)).toBe("settled");
    expect(await auditRows(T, "audit_para_settle", id)).toHaveLength(1);
  });

  it("with the policy off the same admin may settle their own reply; turning it off takes a SECOND admin's approval", async () => {
    const put = await app.inject({ method: "PUT", url: "/v1/finance/policy", headers: as(ADMIN_A, ["finance_admin"]), payload: { auditParaMakerChecker: false } });
    expect(put.statusCode).toBe(202);
    expect(put.json().data.requiresApproval).toBe(true);
    await drain();
    // not yet applied: the replier still cannot settle their own reply
    const early = await para();
    await act(early, "respond", ADMIN_A, ["finance_admin"]);
    expect((await act(early, "settle", ADMIN_A, ["finance_admin"])).statusCode).toBe(409);
    const changeId = put.json().data.changeId as string;
    const self = await app.inject({ method: "POST", url: `/v1/finance/policy/changes/${changeId}/approve`, headers: as(ADMIN_A, ["finance_admin"]), payload: {} });
    expect(self.statusCode).toBe(409);
    expect((await app.inject({ method: "POST", url: `/v1/finance/policy/changes/${changeId}/approve`, headers: as(ADMIN_B, ["finance_admin"]), payload: {} })).statusCode).toBe(202);
    await drain();
    const id = await para();
    await act(id, "respond", ADMIN_A, ["finance_admin"]);
    expect((await act(id, "settle", ADMIN_A, ["finance_admin"])).statusCode).toBe(202);
    expect(await statusOf(id)).toBe("settled");
    await scoped(T, (tx) => tx.delete(financePolicy).where(eq(financePolicy.tenantId, T)));
  });

  it("escalate from open or responded; an escalated para can be answered again", async () => {
    const id = await para();
    expect((await act(id, "escalate", OFFICER, ["finance_officer"], { note: "No reply from department in 30 days" })).statusCode).toBe(202);
    expect(await statusOf(id)).toBe("escalated");
    expect((await act(id, "respond", OFFICER, ["finance_officer"])).statusCode).toBe(202);
    expect(await statusOf(id)).toBe("responded");
  });

  it("two admins settling at once: exactly one settles, one event, one audit", async () => {
    const id = await para();
    await act(id, "respond", OFFICER, ["finance_officer"]);
    const [a, b] = await Promise.all([act(id, "settle", ADMIN_A, ["finance_admin"]), act(id, "settle", ADMIN_B, ["finance_admin"])]);
    const codes = [a.statusCode, b.statusCode];
    expect(codes).toContain(202);
    for (const c of codes) expect([202, 409]).toContain(c); // 409 if the first settle had already committed
    expect(await statusOf(id)).toBe("settled");
    const events = await scoped(T, (tx) => tx.select().from(financeAuditParaEvents).where(eq(financeAuditParaEvents.paraId, id)));
    expect(events.filter((e) => e.action === "settle")).toHaveLength(1);
    expect(await auditRows(T, "audit_para_settle", id)).toHaveLength(1);
  });
});
