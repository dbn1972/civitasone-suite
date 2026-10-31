/**
 * F102 (UAT T4): the procurement half of indent / PO inbox decisions.
 *  - workflow's inbox reject dispatches procurement.indent.reject { id, reason }
 *    and (new) procurement.po.reject { id, reason }: the indent becomes
 *    rejected and the PO cancelled (there was no PO reject path at all).
 *  - every indent / PO approve or reject enqueues workflow.instance.close_by_ref,
 *    so a direct decision closes the inbox task.
 *  - PATCH /v1/procurement/pos/:id/reject: direct reject of a PO awaiting approval.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { MemoryQueue } from "@civitasone/queue";
import type { Queue, Handler } from "@civitasone/queue";
import { and, eq } from "drizzle-orm";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { randomUUID } from "node:crypto";
process.env.PII_ENC_KEY = process.env.PII_ENC_KEY ?? "test_pii_encryption_key_32chars!!";
import { signToken } from "@civitasone/auth";
import { db, sqlClient } from "../src/shared/db.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { queue } from "../src/shared/infra.js";
import { buildApp } from "../src/app.js";
import { procurementIndents } from "../src/modules/indent/schema.js";
import { procurementPos } from "../src/modules/po/schema.js";
import { registerIndentConsumers } from "../src/modules/indent/consumer.js";
import { registerPoConsumers } from "../src/modules/po/consumer.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "7c7c7c7c-f102-4000-8000-000000000102";
const MAKER = randomUUID();
const CHECKER = randomUUID();
const CLOSE = "workflow.instance.close_by_ref";
const SECRET = process.env.JWT_SECRET as string;

function wire(q: Queue): Queue {
  const raw = q.subscribe.bind(q);
  q.subscribe = ((t: string, h: Handler) => raw(t, withTenantConsumer(h) as Handler)) as typeof q.subscribe;
  return q;
}
async function deliver(type: string, payload: Record<string, unknown>, actorId = CHECKER): Promise<void> {
  const q = wire(new MemoryQueue());
  registerIndentConsumers(q);
  registerPoConsumers(q);
  await q.start();
  await q.publish(type, { messageId: randomUUID(), type, tenantId: TENANT, actorId, correlationId: `corr-${type}`, schemaVersion: "1.0", payload });
  await new Promise<void>((r) => setTimeout(r, 400));
  await q.stop();
}
const inTenant = <T>(fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>) =>
  runWithTenant(TENANT, () => db.transaction(fn));

async function seedIndent(status = "pending"): Promise<string> {
  const id = randomUUID();
  await inTenant((tx) => tx.insert(procurementIndents).values({
    id, tenantId: TENANT, indentNo: `IND-F102-${id.slice(-4)}`, department: "Stores", purpose: "F102",
    status, createdBy: MAKER, updatedBy: MAKER,
  }));
  return id;
}
async function seedPo(status = "draft"): Promise<string> {
  const id = randomUUID();
  await inTenant((tx) => tx.insert(procurementPos).values({
    id, tenantId: TENANT, poNo: `PO-F102-${id.slice(-4)}`, vendorId: randomUUID(), indentRef: "procurement_indent:seed",
    totalMinor: 1000n, status, createdBy: MAKER, updatedBy: MAKER,
  }));
  return id;
}
async function closeMessages(refId: string): Promise<Array<Record<string, unknown>>> {
  const rows = await inTenant((tx) => tx.select().from(outboxMessages)
    .where(and(eq(outboxMessages.tenantId, TENANT), eq(outboxMessages.topic, CLOSE))));
  return rows.map((r) => (typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload) as Record<string, unknown>)
    .filter((p) => p.refId === refId);
}
const indent = async (id: string) => (await inTenant((tx) => tx.select().from(procurementIndents).where(eq(procurementIndents.id, id))))[0];
const po = async (id: string) => (await inTenant((tx) => tx.select().from(procurementPos).where(eq(procurementPos.id, id))))[0];

async function wipe(): Promise<void> {
  await inTenant(async (tx) => {
    await tx.delete(procurementPos).where(eq(procurementPos.tenantId, TENANT));
    await tx.delete(procurementIndents).where(eq(procurementIndents.tenantId, TENANT));
  });
}
beforeAll(async () => { await wipe(); });
afterEach(() => { vi.restoreAllMocks(); });
afterAll(async () => { await wipe(); await sqlClient.end(); });

describe("F102 — inbox reject reaches the indent / PO", () => {
  it("indent: the workflow reject dispatch rejects it and asks workflow to close the approval", async () => {
    const id = await seedIndent();
    await deliver(COMMANDS.indentReject, { id, tenantId: TENANT, rejectedBy: CHECKER, reason: "not justified" });
    expect((await indent(id))?.status).toBe("rejected");
    expect(await closeMessages(id)).toEqual([{ tenantId: TENANT, refType: "procurement_indent", refId: id, decision: "reject", reason: "not justified" }]);
  });

  it("PO: the workflow reject dispatch cancels a draft PO (previously no reject path existed)", async () => {
    const id = await seedPo("draft");
    await deliver(COMMANDS.poReject, { id, tenantId: TENANT, rejectedBy: CHECKER, reason: "vendor not eligible" });
    expect((await po(id))?.status).toBe("cancelled");
    expect(await closeMessages(id)).toEqual([{ tenantId: TENANT, refType: "procurement_po", refId: id, decision: "reject", reason: "vendor not eligible" }]);
  });

  it("PO: an approved PO is never cancelled by a reject", async () => {
    const id = await seedPo("approved");
    await deliver(COMMANDS.poReject, { id, tenantId: TENANT, rejectedBy: CHECKER, reason: "late" });
    expect((await po(id))?.status).toBe("approved");
    expect(await closeMessages(id)).toEqual([]);
  });
});

describe("F102 — a direct indent / PO approve closes the inbox task", () => {
  it("indent approve enqueues close_by_ref(approve)", async () => {
    const id = await seedIndent();
    await deliver(COMMANDS.indentApprove, { id, tenantId: TENANT });
    expect((await indent(id))?.status).toBe("approved");
    expect(await closeMessages(id)).toEqual([{ tenantId: TENANT, refType: "procurement_indent", refId: id, decision: "approve" }]);
  });

  it("PO approve enqueues close_by_ref(approve); a refused self-approval closes nothing", async () => {
    const id = await seedPo("draft");
    await deliver(COMMANDS.poApprove, { id, tenantId: TENANT });
    expect((await po(id))?.status).toBe("approved");
    expect(await closeMessages(id)).toEqual([{ tenantId: TENANT, refType: "procurement_po", refId: id, decision: "approve" }]);

    const self = await seedPo("draft");
    await deliver(COMMANDS.poApprove, { id: self, tenantId: TENANT }, MAKER);
    expect((await po(self))?.status).toBe("draft");
    expect(await closeMessages(self)).toEqual([]);
  });
});

describe("F102 — PATCH /v1/procurement/pos/:id/reject", () => {
  const tok = (roles: string[]) => ({ authorization: `Bearer ${signToken({ sub: CHECKER, tid: TENANT, roles, sid: "s-f102" }, SECRET)}` });

  it("202 and procurement.po.reject enqueued for a draft PO", async () => {
    const id = await seedPo("draft");
    const publish = vi.spyOn(queue, "publish").mockResolvedValue(undefined as never);
    const app = await buildApp();
    const res = await app.inject({ method: "PATCH", url: `/v1/procurement/pos/${id}/reject`, headers: tok(["procurement_admin"]), payload: { reason: "duplicate order" } });
    await app.close();
    expect(res.statusCode).toBe(202);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish.mock.calls[0]![0]).toBe("procurement.po.reject");
    expect((publish.mock.calls[0]![1] as { payload: unknown }).payload).toEqual({ id, tenantId: TENANT, reason: "duplicate order" });
  });

  it("409 PO_NOT_AWAITING_APPROVAL for an approved PO, 404 for an unknown one, 403 for an officer", async () => {
    const id = await seedPo("approved");
    const publish = vi.spyOn(queue, "publish").mockResolvedValue(undefined as never);
    const app = await buildApp();
    const approved = await app.inject({ method: "PATCH", url: `/v1/procurement/pos/${id}/reject`, headers: tok(["procurement_admin"]), payload: { reason: "x" } });
    const unknown = await app.inject({ method: "PATCH", url: `/v1/procurement/pos/${randomUUID()}/reject`, headers: tok(["procurement_admin"]), payload: { reason: "x" } });
    const officer = await app.inject({ method: "PATCH", url: `/v1/procurement/pos/${id}/reject`, headers: tok(["procurement_officer"]), payload: { reason: "x" } });
    await app.close();
    expect(approved.statusCode).toBe(409);
    expect(approved.json().code).toBe("PO_NOT_AWAITING_APPROVAL");
    expect(unknown.statusCode).toBe(404);
    expect(officer.statusCode).toBe(403);
    expect(publish).not.toHaveBeenCalled();
  });
});

describe("F102 review — a rejected PO releases its indent commitment exactly once", () => {
  async function seedApprovedIndent(totalMinor: bigint, committedMinor: bigint): Promise<string> {
    const id = randomUUID();
    await inTenant((tx) => tx.insert(procurementIndents).values({
      id, tenantId: TENANT, indentNo: `IND-F102C-${id.slice(-4)}`, department: "Stores", purpose: "F102 commit",
      status: "approved", totalMinor, committedMinor, createdBy: MAKER, updatedBy: MAKER,
    }));
    return id;
  }
  async function seedPoAgainst(indentId: string, totalMinor: bigint, status = "draft"): Promise<string> {
    const id = randomUUID();
    await inTenant((tx) => tx.insert(procurementPos).values({
      id, tenantId: TENANT, poNo: `PO-F102C-${id.slice(-4)}`, vendorId: randomUUID(), indentRef: `procurement_indent:${indentId}`,
      totalMinor, status, createdBy: MAKER, updatedBy: MAKER,
    }));
    return id;
  }

  it("reject -> cancelled gives the PO value back to the indent; a duplicate reject does not release again", async () => {
    const indentId = await seedApprovedIndent(10_000n, 7_000n);
    const poId = await seedPoAgainst(indentId, 4_000n);
    await deliver(COMMANDS.poReject, { id: poId, tenantId: TENANT, reason: "wrong vendor" });
    expect((await po(poId))?.status).toBe("cancelled");
    expect((await indent(indentId))?.committedMinor).toBe(3_000n);

    await deliver(COMMANDS.poReject, { id: poId, tenantId: TENANT, reason: "again" }); // new messageId, same PO
    expect((await indent(indentId))?.committedMinor).toBe(3_000n);
  });

  it("a refused reject (approved PO) releases nothing", async () => {
    const indentId = await seedApprovedIndent(10_000n, 4_000n);
    const poId = await seedPoAgainst(indentId, 4_000n, "approved");
    await deliver(COMMANDS.poReject, { id: poId, tenantId: TENANT, reason: "late" });
    expect((await indent(indentId))?.committedMinor).toBe(4_000n);
  });

  it("the release never drives committed_minor negative", async () => {
    const indentId = await seedApprovedIndent(10_000n, 1_000n);
    const poId = await seedPoAgainst(indentId, 4_000n);
    await deliver(COMMANDS.poReject, { id: poId, tenantId: TENANT, reason: "inconsistent" });
    expect((await po(poId))?.status).toBe("cancelled");
    expect((await indent(indentId))?.committedMinor).toBe(1_000n);
  });
});

describe("F102 review — PO state machine", () => {
  it("draft -> cancelled is a declared transition (reject goes through assertTransitionAllowed)", async () => {
    const { assertTransitionAllowed } = await import("../src/modules/po/domain.js");
    expect(() => assertTransitionAllowed("draft", "cancelled")).not.toThrow();
    expect(() => assertTransitionAllowed("cancelled", "draft")).toThrow();
  });
});
