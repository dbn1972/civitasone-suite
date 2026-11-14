/**
 * M10 (procurement without Finance) over the real routes, consumers and
 * Postgres (RLS).
 *
 *   local tenant (no Finance module): a PO above Rs 1,000 needs no sanction and
 *     finance-service is never called; it is approved by a procurement approver
 *     whose role the threshold matrix allows for its value, never by its maker;
 *     refusals and approvals are audited; the matrix is configurable and audited.
 *   finance tenant (every current tenant): the sanction rule, the finance call
 *     and the workflow task are exactly as before, and the local route refuses.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import type { MemoryQueue, Queue, Handler } from "@civitasone/queue";
process.env.PII_ENC_KEY = process.env.PII_ENC_KEY ?? "test_pii_encryption_key_32chars!!";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { queue } from "../src/shared/infra.js";
import { procurementPos } from "../src/modules/po/schema.js";
import { procurementIndents } from "../src/modules/indent/schema.js";
import { registerPoConsumers } from "../src/modules/po/consumer.js";
import { registerPoApprovalConsumers } from "../src/modules/po-approval/consumer.js";
import { setModuleKeyFetcher } from "../src/shared/tenant-modules.js";
import { COMMANDS, EVENTS } from "../src/topics.js";

const memQueue = queue as unknown as MemoryQueue;
const SECRET = process.env.JWT_SECRET as string;
const AUDIT = "audit.event.record";
const WORKFLOW_CREATE = "workflow.instance.create";

const LOCAL = randomUUID();   // a tenant without Finance
const FINANCE = randomUUID(); // a tenant with Finance
const hasFinance = new Map<string, boolean>([[LOCAL, false], [FINANCE, true]]);

const MAKER = randomUUID();
const OFFICER = randomUUID();
const ADMIN = randomUUID();
const SUPER = randomUUID();
const SUPER2 = randomUUID();

const headers = (tenantId: string, sub: string, roles: string[]) => ({
  authorization: `Bearer ${signToken({ sub, tid: tenantId, roles, sid: randomUUID() }, SECRET)}`, "content-type": "application/json",
});
const inTenant = <T>(tenantId: string, fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>) => runWithTenant(tenantId, () => db.transaction(fn));

type Captured = { topic: string; tenantId: string; actorId: string; payload: Record<string, unknown> };
const published: Captured[] = [];
const deniedAudits = (tenantId: string) => published.filter((e) => e.topic === AUDIT && e.tenantId === tenantId && e.payload.outcome === "denied");

async function outbox(tenantId: string, topic: string): Promise<Array<Record<string, unknown>>> {
  const rows = await inTenant(tenantId, (tx) => tx.select().from(outboxMessages).where(and(eq(outboxMessages.tenantId, tenantId), eq(outboxMessages.topic, topic))).orderBy(outboxMessages.createdAt));
  return rows.map((r) => (typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload) as Record<string, unknown>);
}
const auditRows = async (tenantId: string, action: string) => (await outbox(tenantId, AUDIT)).filter((p) => p.action === action);
const poRow = async (tenantId: string, id: string) => (await inTenant(tenantId, (tx) => tx.select().from(procurementPos).where(eq(procurementPos.id, id))))[0];

async function seedIndent(tenantId: string, totalMinor = 500_000_000n): Promise<string> {
  const id = randomUUID();
  await inTenant(tenantId, (tx) => tx.insert(procurementIndents).values({
    id, tenantId, indentNo: `IND-M10-${id.slice(-5)}`, department: "Stores", purpose: "M10", status: "approved", totalMinor, createdBy: MAKER, updatedBy: MAKER,
  }));
  return id;
}
async function seedPo(tenantId: string, totalMinor: bigint, createdBy = MAKER): Promise<string> {
  const id = randomUUID();
  await inTenant(tenantId, (tx) => tx.insert(procurementPos).values({
    id, tenantId, poNo: `PO-M10-${id.slice(-5)}`, vendorId: randomUUID(), indentRef: "procurement_indent:seed", totalMinor, status: "draft", createdBy, updatedBy: createdBy,
  }));
  return id;
}
const payloadFor = (indentId: string, unitPriceMinor: number, quantity = 1, extra: Record<string, unknown> = {}) => ({
  vendorId: randomUUID(), indentRef: `procurement_indent:${indentId}`, gemOrderRef: "GEM/2026/M10",
  items: [{ itemCode: "STN-01", description: "A4 copier paper", quantity, unit: "ream", unitPriceMinor }], ...extra,
});

let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  setModuleKeyFetcher(async (tid) => (hasFinance.get(tid) === false ? ["procurement", "hrms"] : ["procurement", "finance", "hrms"]));
  const raw = queue.subscribe.bind(queue);
  (queue as Queue).subscribe = ((t: string, h: Handler) => raw(t, withTenantConsumer(h) as Handler)) as typeof queue.subscribe;
  registerPoConsumers(queue as Queue);
  registerPoApprovalConsumers(queue as Queue);
  raw(AUDIT, (async (msg: { topic?: string; tenantId: string; actorId: string; payload: unknown }) => { published.push({ topic: AUDIT, tenantId: msg.tenantId, actorId: msg.actorId, payload: msg.payload as Record<string, unknown> }); }) as Handler);
  await queue.start();
  app = await buildApp();
});
afterAll(async () => {
  setModuleKeyFetcher();
  await app.close();
  await queue.stop();
  await sqlClient.end();
});
afterEach(() => { vi.restoreAllMocks(); });

const outbound = (spy: { mock: { calls: unknown[][] } }) => spy.mock.calls.map((c) => String(c[0]));

describe("local approval mode (tenant without Finance): creating a PO", () => {
  it("reports the mode and the default matrix", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/procurement/po-approval-settings", headers: headers(LOCAL, OFFICER, ["procurement_officer"]) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      mode: "local", source: "derived", override: null, hasFinance: false, isDefaultMatrix: true,
      matrix: [
        { upToMinor: "5000000", approverRoles: ["procurement_officer", "procurement_admin"] },
        { upToMinor: "100000000", approverRoles: ["procurement_admin"] },
        { upToMinor: null, approverRoles: ["super_admin"] },
      ],
    });
  });

  it("a PO above Rs 1,000 with no sanction is accepted, finance-service and the PO workflow are never called, and no workflow task is raised", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("{}", { status: 503 }));
    const indentId = await seedIndent(LOCAL);
    // Rs 60,000: far above the Rs 1,000 sanction threshold.
    const res = await app.inject({ method: "POST", url: "/v1/procurement/pos", headers: headers(LOCAL, MAKER, ["procurement_officer"]), payload: payloadFor(indentId, 6_000_000) });
    await memQueue.drain();
    expect(res.statusCode).toBe(202);
    const id = res.json().id as string;
    const po = await poRow(LOCAL, id);
    expect(po).toMatchObject({ status: "draft", sanctionRef: null, totalMinor: 6_000_000n, createdBy: MAKER });
    expect(outbound(fetchSpy).filter((u) => u.includes("127.0.0.1:9"))).toEqual([]);
    expect((await outbox(LOCAL, WORKFLOW_CREATE)).filter((p) => p.refId === id)).toEqual([]);
  });

  it("a sanction reference, if the user types one, is kept as a reference and is not checked", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("{}", { status: 503 }));
    const indentId = await seedIndent(LOCAL);
    const res = await app.inject({ method: "POST", url: "/v1/procurement/purchase-orders", headers: headers(LOCAL, MAKER, ["procurement_officer"]), payload: payloadFor(indentId, 200_000, 1, { sanctionRef: "FILE/2026/77" }) });
    await memQueue.drain();
    expect(res.statusCode).toBe(202);
    expect((await poRow(LOCAL, res.json().id))?.sanctionRef).toBe("FILE/2026/77");
    expect(outbound(fetchSpy).filter((u) => u.includes("sanctions"))).toEqual([]);
  });
});

describe("local approval mode: approving a PO under the matrix", () => {
  let po60k: string;
  beforeAll(async () => { po60k = await seedPo(LOCAL, 6_000_000n); });

  it("maker-checker: the PO's creator cannot approve it (403 SOD_VIOLATION) even with a role the band allows; the refusal is audited", async () => {
    const res = await app.inject({ method: "PATCH", url: `/v1/procurement/pos/${po60k}/approve`, headers: headers(LOCAL, MAKER, ["procurement_admin"]), payload: { reason: "approving my own order" } });
    await memQueue.drain();
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("SOD_VIOLATION");
    expect((await poRow(LOCAL, po60k))?.status).toBe("draft");
    expect(deniedAudits(LOCAL).at(-1)).toMatchObject({ actorId: MAKER, payload: { action: "approve", resourceType: "po", resourceId: po60k, denialCode: "SOD_VIOLATION", path: "local" } });
  });

  it("the matrix: an officer cannot approve a Rs 60,000 PO (403 APPROVAL_LEVEL_INSUFFICIENT) and the refusal names the roles that can", async () => {
    const res = await app.inject({ method: "PATCH", url: `/v1/procurement/pos/${po60k}/approve`, headers: headers(LOCAL, OFFICER, ["procurement_officer"]), payload: {} });
    await memQueue.drain();
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("APPROVAL_LEVEL_INSUFFICIENT");
    expect(res.json().message).toContain("procurement_admin");
    expect((await poRow(LOCAL, po60k))?.status).toBe("draft");
    expect(deniedAudits(LOCAL).at(-1)?.payload).toMatchObject({ denialCode: "APPROVAL_LEVEL_INSUFFICIENT", requiredRoles: ["procurement_admin", "super_admin"], totalMinor: "6000000" });
  });

  it("the consumer re-checks the matrix: a command that bypasses the route with an officer's roles is rejected and the PO stays draft", async () => {
    await queue.publish(COMMANDS.poApprove, {
      messageId: randomUUID(), type: COMMANDS.poApprove, tenantId: LOCAL, actorId: OFFICER, correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { id: po60k, tenantId: LOCAL, localApproval: { approverRoles: ["procurement_officer"] } },
    });
    await memQueue.drain();
    expect((await poRow(LOCAL, po60k))?.status).toBe("draft");
    expect((await outbox(LOCAL, EVENTS.poApprovalRejected)).some((p) => p.poId === po60k && p.code === "APPROVAL_LEVEL_INSUFFICIENT")).toBe(true);
    expect((await auditRows(LOCAL, "approval_rejected_matrix")).some((p) => p.resourceId === po60k)).toBe(true);
  });

  it("and the creator cannot approve through a bypassing command either (the existing maker-checker rule)", async () => {
    await queue.publish(COMMANDS.poApprove, {
      messageId: randomUUID(), type: COMMANDS.poApprove, tenantId: LOCAL, actorId: MAKER, correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { id: po60k, tenantId: LOCAL, localApproval: { approverRoles: ["super_admin"] } },
    });
    await memQueue.drain();
    expect((await poRow(LOCAL, po60k))?.status).toBe("draft");
    expect((await outbox(LOCAL, EVENTS.poApprovalRejected)).some((p) => p.poId === po60k && p.code === "SOD_VIOLATION")).toBe(true);
  });

  it("an admin approves it: 202, the PO is approved, and the approval is audited with the path, the reason, the roles and the band", async () => {
    const res = await app.inject({ method: "PATCH", url: `/v1/procurement/pos/${po60k}/approve`, headers: headers(LOCAL, ADMIN, ["procurement_admin"]), payload: { reason: "Within the delegated limit" } });
    await memQueue.drain();
    expect(res.statusCode).toBe(202);
    expect((await poRow(LOCAL, po60k))?.status).toBe("approved");
    expect((await outbox(LOCAL, EVENTS.poApproved)).some((p) => p.poId === po60k)).toBe(true);
    const a = (await auditRows(LOCAL, "approve")).find((p) => p.resourceId === po60k)!;
    expect(a.details).toMatchObject({
      path: "local", reason: "Within the delegated limit", approverRoles: ["procurement_admin"], totalMinor: "6000000",
      band: { upToMinor: "100000000", approverRoles: ["procurement_admin"] },
    });
  });

  it("an approved PO cannot be approved again (409); an unknown PO is 404; a role outside procurement is 403", async () => {
    expect((await app.inject({ method: "PATCH", url: `/v1/procurement/pos/${po60k}/approve`, headers: headers(LOCAL, SUPER, ["super_admin"]), payload: {} })).statusCode).toBe(409);
    expect((await app.inject({ method: "PATCH", url: `/v1/procurement/pos/${randomUUID()}/approve`, headers: headers(LOCAL, SUPER, ["super_admin"]), payload: {} })).statusCode).toBe(404);
    const other = await seedPo(LOCAL, 1000n);
    expect((await app.inject({ method: "PATCH", url: `/v1/procurement/pos/${other}/approve`, headers: headers(LOCAL, OFFICER, ["audit_officer"]), payload: {} })).statusCode).toBe(403);
  });

  it("the top band needs a super admin; an admin is refused, a super admin approves", async () => {
    const big = await seedPo(LOCAL, 250_000_000n); // Rs 25 lakh
    expect((await app.inject({ method: "PATCH", url: `/v1/procurement/pos/${big}/approve`, headers: headers(LOCAL, ADMIN, ["procurement_admin"]), payload: {} })).json().code).toBe("APPROVAL_LEVEL_INSUFFICIENT");
    const ok = await app.inject({ method: "PATCH", url: `/v1/procurement/pos/${big}/approve`, headers: headers(LOCAL, SUPER, ["super_admin"]), payload: {} });
    await memQueue.drain();
    expect(ok.statusCode).toBe(202);
    expect((await poRow(LOCAL, big))?.status).toBe("approved");
  });

  it("an officer approves a PO at the exact limit of the lowest band (Rs 50,000.00)", async () => {
    const edge = await seedPo(LOCAL, 5_000_000n);
    const ok = await app.inject({ method: "PATCH", url: `/v1/procurement/pos/${edge}/approve`, headers: headers(LOCAL, OFFICER, ["procurement_officer"]), payload: {} });
    await memQueue.drain();
    expect(ok.statusCode).toBe(202);
    expect((await poRow(LOCAL, edge))?.status).toBe("approved");
    const over = await seedPo(LOCAL, 5_000_001n);
    expect((await app.inject({ method: "PATCH", url: `/v1/procurement/pos/${over}/approve`, headers: headers(LOCAL, OFFICER, ["procurement_officer"]), payload: {} })).statusCode).toBe(403);
  });
});

describe("local approval mode: configuring the matrix and the mode", () => {
  it("only procurement admins configure it; an invalid matrix is a 400 and changes nothing", async () => {
    const officer = await app.inject({ method: "PUT", url: "/v1/procurement/po-approval-settings", headers: headers(LOCAL, OFFICER, ["procurement_officer"]), payload: { modeOverride: null } });
    expect(officer.statusCode).toBe(403);
    for (const matrix of [
      [{ upToMinor: "100", approverRoles: ["procurement_admin"] }],
      [{ upToMinor: "500", approverRoles: ["procurement_admin"] }, { upToMinor: "400", approverRoles: ["procurement_admin"] }, { upToMinor: null, approverRoles: ["super_admin"] }],
      [{ upToMinor: null, approverRoles: ["finance_officer"] }],
    ]) {
      const bad = await app.inject({ method: "PUT", url: "/v1/procurement/po-approval-settings", headers: headers(LOCAL, ADMIN, ["procurement_admin"]), payload: { matrix } });
      expect(bad.statusCode).toBe(400);
      expect(bad.json().code).toBe("INVALID_MATRIX");
    }
    expect((await app.inject({ method: "PUT", url: "/v1/procurement/po-approval-settings", headers: headers(LOCAL, ADMIN, ["procurement_admin"]), payload: {} })).statusCode).toBe(400);
    const get = await app.inject({ method: "GET", url: "/v1/procurement/po-approval-settings", headers: headers(LOCAL, ADMIN, ["procurement_admin"]) });
    expect(get.json().isDefaultMatrix).toBe(true);
  });

  it("a new matrix takes effect and is audited with before and after", async () => {
    const put = await app.inject({
      method: "PUT", url: "/v1/procurement/po-approval-settings", headers: headers(LOCAL, ADMIN, ["procurement_admin"]),
      payload: { matrix: [{ upToMinor: "20000000", approverRoles: ["procurement_officer"] }, { upToMinor: null, approverRoles: ["procurement_admin"] }] },
    });
    await memQueue.drain();
    expect(put.statusCode).toBe(202);
    const get = await app.inject({ method: "GET", url: "/v1/procurement/po-approval-settings", headers: headers(LOCAL, OFFICER, ["procurement_officer"]) });
    expect(get.json()).toMatchObject({ isDefaultMatrix: false, matrix: [{ upToMinor: "20000000", approverRoles: ["procurement_officer"] }, { upToMinor: null, approverRoles: ["procurement_admin"] }] });
    const a = (await auditRows(LOCAL, "update")).find((p) => p.resourceType === "po_approval_settings")!;
    expect(a.details).toMatchObject({ before: { matrix: "default" }, after: { matrix: [{ upToMinor: "20000000" }, { upToMinor: null }] } });

    const po = await seedPo(LOCAL, 15_000_000n); // Rs 1.5 lakh: an officer may now approve it
    const ok = await app.inject({ method: "PATCH", url: `/v1/procurement/pos/${po}/approve`, headers: headers(LOCAL, OFFICER, ["procurement_officer"]), payload: {} });
    await memQueue.drain();
    expect(ok.statusCode).toBe(202);
    expect((await poRow(LOCAL, po))?.status).toBe("approved");
  });

  it("the mode can be forced either way and cleared; each change is audited", async () => {
    const h = headers(LOCAL, ADMIN, ["procurement_admin"]);
    await app.inject({ method: "PUT", url: "/v1/procurement/po-approval-settings", headers: h, payload: { modeOverride: "finance_sanction" } });
    await memQueue.drain();
    expect((await app.inject({ method: "GET", url: "/v1/procurement/po-approval-settings", headers: h })).json()).toMatchObject({ mode: "finance_sanction", source: "override", override: "finance_sanction", hasFinance: null });
    const po = await seedPo(LOCAL, 1000n);
    expect((await app.inject({ method: "PATCH", url: `/v1/procurement/pos/${po}/approve`, headers: headers(LOCAL, SUPER, ["super_admin"]), payload: {} })).json().code).toBe("LOCAL_APPROVAL_NOT_ENABLED");

    await app.inject({ method: "PUT", url: "/v1/procurement/po-approval-settings", headers: h, payload: { modeOverride: null } });
    await memQueue.drain();
    expect((await app.inject({ method: "GET", url: "/v1/procurement/po-approval-settings", headers: h })).json()).toMatchObject({ mode: "local", source: "derived", override: null });
    const changes = (await auditRows(LOCAL, "update")).filter((p) => p.resourceType === "po_approval_settings").map((p) => (p.details as { after: { modeOverride: unknown } }).after.modeOverride);
    expect(changes).toContain("finance_sanction");
    expect(changes.at(-1)).toBeNull();
  });
});

describe("finance tenant (every current tenant): behaviour is unchanged", () => {
  it("a PO above Rs 1,000 without a sanction is still refused up front (422 SANCTION_REF_REQUIRED)", async () => {
    const indentId = await seedIndent(FINANCE);
    const res = await app.inject({ method: "POST", url: "/v1/procurement/pos", headers: headers(FINANCE, MAKER, ["procurement_officer"]), payload: payloadFor(indentId, 6_000_000) });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("SANCTION_REF_REQUIRED");
  });

  it("with a sanction, finance-service is asked for the balance and the PO workflow task is raised", async () => {
    const sanction = randomUUID();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) =>
      String(url).includes("/sanctions/") ? new Response(JSON.stringify({ available: "999999999" }), { status: 200, headers: { "content-type": "application/json" } }) : new Response("{}", { status: 503 }));
    const indentId = await seedIndent(FINANCE);
    const res = await app.inject({ method: "POST", url: "/v1/procurement/pos", headers: headers(FINANCE, MAKER, ["procurement_officer"]), payload: payloadFor(indentId, 6_000_000, 1, { sanctionRef: `finance_sanction:${sanction}` }) });
    await memQueue.drain();
    expect(res.statusCode).toBe(202);
    const id = res.json().id as string;
    expect(outbound(fetchSpy).some((u) => u.includes(`/sanctions/${sanction}/available`))).toBe(true);
    expect((await poRow(FINANCE, id))?.sanctionRef).toBe(`finance_sanction:${sanction}`);
    expect((await outbox(FINANCE, WORKFLOW_CREATE)).some((p) => p.refId === id && p.definitionCode === "procurement_po_approval")).toBe(true);
  });

  it("the worker still rejects a high-value PO that carries no sanction (po.budget_exceeded SANCTION_REF_REQUIRED) and writes no PO", async () => {
    const id = randomUUID();
    await queue.publish(COMMANDS.poCreate, {
      messageId: id, type: COMMANDS.poCreate, tenantId: FINANCE, actorId: MAKER, correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { id, tenantId: FINANCE, poNo: "AUTO", ...payloadFor(randomUUID(), 6_000_000) },
    });
    await memQueue.drain();
    expect(await poRow(FINANCE, id)).toBeUndefined();
    expect((await outbox(FINANCE, EVENTS.poBudgetExceeded)).some((p) => p.poId === id && p.code === "SANCTION_REF_REQUIRED")).toBe(true);
  });

  it("the local approve route and a local-approval command are refused; the settings say finance_sanction", async () => {
    const po = await seedPo(FINANCE, 1000n);
    const res = await app.inject({ method: "PATCH", url: `/v1/procurement/pos/${po}/approve`, headers: headers(FINANCE, SUPER, ["super_admin"]), payload: {} });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("LOCAL_APPROVAL_NOT_ENABLED");
    const dlqBefore = memQueue.dlq.length;
    await queue.publish(COMMANDS.poApprove, {
      messageId: randomUUID(), type: COMMANDS.poApprove, tenantId: FINANCE, actorId: SUPER, correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { id: po, tenantId: FINANCE, localApproval: { approverRoles: ["super_admin"] } },
    });
    await memQueue.drain();
    expect((await poRow(FINANCE, po))?.status).toBe("draft");
    expect(memQueue.dlq.slice(dlqBefore).some((d) => d.topic === COMMANDS.poApprove && String(d.error).includes("LOCAL_APPROVAL_NOT_ENABLED"))).toBe(true);
    const get = await app.inject({ method: "GET", url: "/v1/procurement/po-approval-settings", headers: headers(FINANCE, SUPER, ["super_admin"]) });
    expect(get.json()).toMatchObject({ mode: "finance_sanction", source: "derived", hasFinance: true });
  });

  it("an approval from the workflow task (no local marker) works exactly as it did", async () => {
    const po = await seedPo(FINANCE, 6_000_000n);
    await queue.publish(COMMANDS.poApprove, {
      messageId: randomUUID(), type: COMMANDS.poApprove, tenantId: FINANCE, actorId: SUPER, correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { id: po, tenantId: FINANCE },
    });
    await memQueue.drain();
    expect((await poRow(FINANCE, po))?.status).toBe("approved");
    const a = (await auditRows(FINANCE, "approve")).find((p) => p.resourceId === po)!;
    expect(a).toMatchObject({ service: "procurement", action: "approve", resourceType: "po", outcome: "success" });
    expect(a).not.toHaveProperty("details");
  });

  it("an unreachable module source does not move a finance tenant onto local approval", async () => {
    setModuleKeyFetcher(async () => { throw new Error("admin-service down"); });
    try {
      const unknown = randomUUID();
      const indentId = await seedIndent(unknown);
      const res = await app.inject({ method: "POST", url: "/v1/procurement/pos", headers: headers(unknown, MAKER, ["procurement_officer"]), payload: payloadFor(indentId, 6_000_000) });
      expect(res.statusCode).toBe(422);
      expect(res.json().code).toBe("SANCTION_REF_REQUIRED");
    } finally {
      setModuleKeyFetcher(async (tid) => (hasFinance.get(tid) === false ? ["procurement", "hrms"] : ["procurement", "finance", "hrms"]));
    }
  });
});

const putSettings = (tenantId: string, sub: string, roles: string[], payload: Record<string, unknown>) =>
  app.inject({ method: "PUT", url: "/v1/procurement/po-approval-settings", headers: headers(tenantId, sub, roles), payload });
const getSettings = async (tenantId: string) => (await app.inject({ method: "GET", url: "/v1/procurement/po-approval-settings", headers: headers(tenantId, SUPER, ["super_admin"]) })).json();

describe("forcing local approval on a tenant that HAS Finance: a super admin, confirmed by a second super admin", () => {
  const T = randomUUID();
  beforeAll(() => { hasFinance.set(T, true); });

  it("a procurement admin is refused (403) and nothing is recorded", async () => {
    const res = await putSettings(T, ADMIN, ["procurement_admin"], { modeOverride: "local" });
    await memQueue.drain();
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("LOCAL_OVERRIDE_REQUIRES_SUPER_ADMIN");
    expect(await getSettings(T)).toMatchObject({ mode: "finance_sanction", override: null, pendingOverride: null });
  });

  it("a super admin's request is held pending: the tenant stays on the sanction path, the request is visible and audited", async () => {
    const res = await putSettings(T, SUPER, ["super_admin"], { modeOverride: "local" });
    await memQueue.drain();
    expect(res.statusCode).toBe(202);
    const g = await getSettings(T);
    expect(g).toMatchObject({ mode: "finance_sanction", source: "derived", override: null });
    expect(g.pendingOverride).toMatchObject({ mode: "local", requestedBy: SUPER });
    const a = (await auditRows(T, "update")).find((p) => (p.details as { modeChange?: string }).modeChange === "requested")!;
    expect(a.details).toMatchObject({ requestedOverride: "local", awaitingSecondSuperAdmin: true, after: { modeOverride: null } });
    // still the sanction rule
    const indentId = await seedIndent(T);
    const po = await app.inject({ method: "POST", url: "/v1/procurement/pos", headers: headers(T, MAKER, ["procurement_officer"]), payload: payloadFor(indentId, 6_000_000) });
    expect(po.json().code).toBe("SANCTION_REF_REQUIRED");
  });

  it("the same super admin asking again does not confirm their own request", async () => {
    await putSettings(T, SUPER, ["super_admin"], { modeOverride: "local" });
    await memQueue.drain();
    expect(await getSettings(T)).toMatchObject({ mode: "finance_sanction", override: null, pendingOverride: { requestedBy: SUPER } });
  });

  it("a different super admin saving the same choice confirms it: local approval is on, the request is cleared, both people are in the audit row", async () => {
    const res = await putSettings(T, SUPER2, ["super_admin"], { modeOverride: "local" });
    await memQueue.drain();
    expect(res.statusCode).toBe(202);
    expect(await getSettings(T)).toMatchObject({ mode: "local", source: "override", override: "local", pendingOverride: null });
    const a = (await auditRows(T, "update")).find((p) => (p.details as { modeChange?: string }).modeChange === "confirmed")!;
    expect(a.details).toMatchObject({ requestedBy: SUPER, confirmedBy: SUPER2, after: { modeOverride: "local" } });
    const indentId = await seedIndent(T);
    const po = await app.inject({ method: "POST", url: "/v1/procurement/pos", headers: headers(T, MAKER, ["procurement_officer"]), payload: payloadFor(indentId, 6_000_000) });
    await memQueue.drain();
    expect(po.statusCode).toBe(202);
  });

  it("going back to the sanction path needs no second person, from a procurement admin, and clears a pending request", async () => {
    const back = await putSettings(T, ADMIN, ["procurement_admin"], { modeOverride: "finance_sanction" });
    await memQueue.drain();
    expect(back.statusCode).toBe(202);
    expect(await getSettings(T)).toMatchObject({ mode: "finance_sanction", override: "finance_sanction" });
    await putSettings(T, SUPER, ["super_admin"], { modeOverride: "local" });
    await memQueue.drain();
    expect((await getSettings(T)).pendingOverride).toMatchObject({ requestedBy: SUPER });
    await putSettings(T, ADMIN, ["procurement_admin"], { modeOverride: null });
    await memQueue.drain();
    expect(await getSettings(T)).toMatchObject({ mode: "finance_sanction", override: null, pendingOverride: null });
  });

  it("the consumer re-checks: an unstamped command that skips the route is dropped and records nothing", async () => {
    const dlqBefore = memQueue.dlq.length;
    await queue.publish(COMMANDS.poApprovalSettingsUpdate, {
      messageId: randomUUID(), type: COMMANDS.poApprovalSettingsUpdate, tenantId: T, actorId: ADMIN, correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { tenantId: T, modeOverride: "local" },
    });
    await memQueue.drain();
    expect(memQueue.dlq.slice(dlqBefore).some((d) => d.topic === COMMANDS.poApprovalSettingsUpdate && String(d.error).includes("LOCAL_OVERRIDE_REQUIRES_SUPER_ADMIN"))).toBe(true);
    expect(await getSettings(T)).toMatchObject({ override: null, pendingOverride: null });
  });

  it("a tenant without Finance is already local: a procurement admin may set it, with no second person", async () => {
    const res = await putSettings(LOCAL, ADMIN, ["procurement_admin"], { modeOverride: "local" });
    await memQueue.drain();
    expect(res.statusCode).toBe(202);
    expect(await getSettings(LOCAL)).toMatchObject({ mode: "local", source: "override", override: "local", pendingOverride: null });
    await putSettings(LOCAL, ADMIN, ["procurement_admin"], { modeOverride: null });
    await memQueue.drain();
  });
});

describe("local approval mode: an approval without the local marker is refused", () => {
  it("a marker-less procurement.po.approve (a workflow task raised before the switch, or any other publisher) does not approve the PO; the maker is told", async () => {
    const po = await seedPo(LOCAL, 6_000_000n);
    await queue.publish(COMMANDS.poApprove, {
      messageId: randomUUID(), type: COMMANDS.poApprove, tenantId: LOCAL, actorId: SUPER, correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { id: po, tenantId: LOCAL },
    });
    await memQueue.drain();
    expect((await poRow(LOCAL, po))?.status).toBe("draft");
    expect((await outbox(LOCAL, EVENTS.poApprovalRejected)).some((p) => p.poId === po && p.code === "LOCAL_APPROVAL_REQUIRED")).toBe(true);
    expect((await auditRows(LOCAL, "approval_rejected_local_mode")).some((p) => p.resourceId === po)).toBe(true);
    // ... and the same PO is approved through the route, under the matrix
    const ok = await app.inject({ method: "PATCH", url: `/v1/procurement/pos/${po}/approve`, headers: headers(LOCAL, SUPER2, ["super_admin"]), payload: {} });
    await memQueue.drain();
    expect(ok.statusCode).toBe(202);
    expect((await poRow(LOCAL, po))?.status).toBe("approved");
  });
});
