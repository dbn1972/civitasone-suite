/**
 * UAT bundle 22 (W1, W2, W5): procurement decision states.
 *
 *  W2  a PO rejected by its checker ends "rejected" (not "cancelled") and keeps the checker's reason,
 *      which the maker reads on the PO
 *  W1  an approved PO / indent is never changed by a later reject
 *  W5  an indent decision its state forbids is refused at the request (409 INVALID_STATE_TRANSITION),
 *      not accepted (202) and silently ignored; a legitimate decision is still accepted
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { MemoryQueue } from "@civitasone/queue";
import type { Queue, Handler } from "@civitasone/queue";
import { eq } from "drizzle-orm";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { randomUUID } from "node:crypto";
process.env.PII_ENC_KEY = process.env.PII_ENC_KEY ?? "test_pii_encryption_key_32chars!!";
import { signToken } from "@civitasone/auth";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { buildApp } from "../src/app.js";
import { procurementIndents } from "../src/modules/indent/schema.js";
import { procurementPos } from "../src/modules/po/schema.js";
import { registerIndentConsumers } from "../src/modules/indent/consumer.js";
import { registerPoConsumers } from "../src/modules/po/consumer.js";
import { getPo } from "../src/modules/po/queries.js";
import { COMMANDS } from "../src/topics.js";
import { drainAllQueues } from "../../../vitest.drain";

const TENANT = "7c7c7c7c-b220-4000-8000-000000000022";
const MAKER = randomUUID();
const CHECKER = randomUUID();
const SECRET = process.env.JWT_SECRET as string;
const REASON = "delivery date and rate differ from the rate contract RC/2026/114";

function wire(q: Queue): Queue {
  const raw = q.subscribe.bind(q);
  q.subscribe = ((t: string, h: Handler) => raw(t, withTenantConsumer(h) as Handler)) as typeof q.subscribe;
  return q;
}
async function deliver(type: string, payload: Record<string, unknown>, actorId = CHECKER): Promise<void> {
  const q = wire(new MemoryQueue({ maxAttempts: 1 }));
  registerIndentConsumers(q);
  registerPoConsumers(q);
  await q.start();
  await q.publish(type, { messageId: randomUUID(), type, tenantId: TENANT, actorId, correlationId: `corr-${type}`, schemaVersion: "1.0", payload });
  await drainAllQueues();
  await q.stop();
}
const inTenant = <T>(fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>) =>
  runWithTenant(TENANT, () => db.transaction(fn));

async function seedIndent(status: string): Promise<string> {
  const id = randomUUID();
  await inTenant((tx) => tx.insert(procurementIndents).values({
    id, tenantId: TENANT, indentNo: `IND-B22-${id.slice(-4)}`, department: "Stores", purpose: "Almirah for the record room",
    status, createdBy: MAKER, updatedBy: MAKER,
  }));
  return id;
}
async function seedPo(status: string): Promise<string> {
  const id = randomUUID();
  await inTenant((tx) => tx.insert(procurementPos).values({
    id, tenantId: TENANT, poNo: `PO/2026/B22-${id.slice(-4)}`, vendorId: randomUUID(), indentRef: "procurement_indent:seed",
    totalMinor: 1000n, status, createdBy: MAKER, updatedBy: MAKER,
  }));
  return id;
}
const indent = async (id: string) => (await inTenant((tx) => tx.select().from(procurementIndents).where(eq(procurementIndents.id, id))))[0];
const po = async (id: string) => (await inTenant((tx) => tx.select().from(procurementPos).where(eq(procurementPos.id, id))))[0];
async function wipe(): Promise<void> {
  await inTenant(async (tx) => {
    await tx.delete(procurementPos).where(eq(procurementPos.tenantId, TENANT));
    await tx.delete(procurementIndents).where(eq(procurementIndents.tenantId, TENANT));
  });
}
beforeAll(wipe);
afterEach(() => { vi.restoreAllMocks(); });
afterAll(async () => { await wipe(); await sqlClient.end(); });

describe("W2: a rejected PO is Rejected and carries the reason", () => {
  it("the checker's reject stores status rejected and the reason; the maker reads both on the PO", async () => {
    const id = await seedPo("draft");
    await deliver(COMMANDS.poReject, { id, tenantId: TENANT, rejectedBy: CHECKER, reason: REASON });
    const row = await po(id);
    expect(row?.status).toBe("rejected");
    expect(row?.rejectionReason).toBe(REASON);
    const view = await runWithTenant(TENANT, () => getPo(id, TENANT)); // a request carries its tenant context; RLS-scoped read
    expect(view?.status).toBe("rejected");
    expect(JSON.stringify(view)).toContain("RC/2026/114");
  });

  it("approve after reject leaves the PO rejected", async () => {
    const id = await seedPo("draft");
    await deliver(COMMANDS.poReject, { id, tenantId: TENANT, reason: REASON });
    await deliver(COMMANDS.poApprove, { id, tenantId: TENANT });
    expect((await po(id))?.status).toBe("rejected");
  });

  it("reject after reject changes nothing (reason is kept)", async () => {
    const id = await seedPo("draft");
    await deliver(COMMANDS.poReject, { id, tenantId: TENANT, reason: REASON });
    await deliver(COMMANDS.poReject, { id, tenantId: TENANT, reason: "second reject, different words" });
    const row = await po(id);
    expect(row?.status).toBe("rejected");
    expect(row?.rejectionReason).toBe(REASON);
  });
});

describe("W1: an approved item is not changed by a later reject", () => {
  it("PO: reject after approve leaves it approved", async () => {
    const id = await seedPo("approved");
    await deliver(COMMANDS.poReject, { id, tenantId: TENANT, reason: REASON });
    const row = await po(id);
    expect(row?.status).toBe("approved");
    expect(row?.rejectionReason ?? null).toBeNull();
  });
  it("indent: reject after approve leaves it approved", async () => {
    const id = await seedIndent("approved");
    await deliver(COMMANDS.indentReject, { id, tenantId: TENANT, reason: REASON });
    expect((await indent(id))?.status).toBe("approved");
  });
});

describe("W5: indent decisions the state forbids are refused at the request", () => {
  const tok = (roles: string[]) => ({ authorization: `Bearer ${signToken({ sub: CHECKER, tid: TENANT, roles, sid: "s-b22" }, SECRET)}` });
  const call = async (method: "approve" | "reject", id: string, payload: Record<string, unknown>) => {
    const publish = vi.spyOn(queue, "publish").mockResolvedValue(undefined as never);
    const app = await buildApp();
    const res = await app.inject({ method: "PATCH", url: `/v1/procurement/indents/${id}/${method}`, headers: tok(["super_admin"]), payload });
    await app.close();
    return { res, publish };
  };

  it("approve after reject: 409 INVALID_STATE_TRANSITION and nothing queued", async () => {
    const id = await seedIndent("rejected");
    const { res, publish } = await call("approve", id, {});
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("INVALID_STATE_TRANSITION");
    expect(publish).not.toHaveBeenCalled();
  });
  it("reject after approve: 409 INVALID_STATE_TRANSITION and nothing queued", async () => {
    const id = await seedIndent("approved");
    const { res, publish } = await call("reject", id, { reason: REASON });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("INVALID_STATE_TRANSITION");
    expect(publish).not.toHaveBeenCalled();
  });
  it("reject after reject: 409", async () => {
    const id = await seedIndent("rejected");
    const { res } = await call("reject", id, { reason: REASON });
    expect(res.statusCode).toBe(409);
  });
  it("a legitimate decision on a pending indent is still accepted (202) and queued", async () => {
    const id = await seedIndent("pending");
    const { res, publish } = await call("reject", id, { reason: REASON });
    expect(res.statusCode).toBe(202);
    expect(publish).toHaveBeenCalledTimes(1);
  });
});

describe("W5: PO routes refuse a decision the state forbids", () => {
  const tok = (roles: string[]) => ({ authorization: `Bearer ${signToken({ sub: CHECKER, tid: TENANT, roles, sid: "s-b22po" }, SECRET)}` });
  const call = async (url: string, method: "PATCH" | "POST", payload: Record<string, unknown>) => {
    const publish = vi.spyOn(queue, "publish").mockResolvedValue(undefined as never);
    const app = await buildApp();
    const res = await app.inject({ method, url, headers: tok(["procurement_admin"]), payload });
    await app.close();
    return { res, publish };
  };

  it("reject of an approved or an already rejected PO: 409, nothing queued", async () => {
    for (const status of ["approved", "rejected"]) {
      const id = await seedPo(status);
      const { res, publish } = await call(`/v1/procurement/pos/${id}/reject`, "PATCH", { reason: REASON });
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe("PO_NOT_AWAITING_APPROVAL");
      expect(publish).not.toHaveBeenCalled();
    }
  });
  it("submit-approval of a decided PO: 409 INVALID_STATE_TRANSITION, nothing queued", async () => {
    for (const status of ["approved", "rejected", "cancelled"]) {
      const id = await seedPo(status);
      const { res, publish } = await call(`/v1/procurement/pos/${id}/submit-approval`, "POST", {});
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe("INVALID_STATE_TRANSITION");
      expect(publish).not.toHaveBeenCalled();
    }
  });
  it("a legitimate submit-approval and reject of a draft PO are still accepted (202)", async () => {
    const a = await seedPo("draft");
    const sub = await call(`/v1/procurement/pos/${a}/submit-approval`, "POST", {});
    expect(sub.res.statusCode).toBe(202);
    const rej = await call(`/v1/procurement/pos/${a}/reject`, "PATCH", { reason: REASON });
    expect(rej.res.statusCode).toBe(202);
  });
});
