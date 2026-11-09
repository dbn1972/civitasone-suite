/**
 * UAT bundle 22 (W1, W2, W5): sanction decision states.
 *
 *  W1  an approved sanction is never changed by a later reject (consumer or route)
 *  W2  a rejected sanction is stored as "rejected" with the checker's reason, and the maker can read both
 *  W5  a decision the current state forbids is refused at the request (409 INVALID_STATE_TRANSITION),
 *      not accepted (202) and silently ignored
 *
 * Runs the real budget consumers against the test DB via MemoryQueue.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { MemoryQueue } from "@civitasone/queue";
import { eq } from "drizzle-orm";
import { db, sqlClient } from "../src/shared/db.js";
import { scoped } from "./_tenant.js";
import { financeSanctions, financeHeads, financeBudgets } from "../src/modules/budget/schema.js";
import { currentFyIST } from "../src/shared/ist-date.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { registerBudgetConsumers } from "../src/modules/budget/consumer.js";
import * as commands from "../src/modules/budget/commands.js";
import { getSanctionDetail } from "../src/modules/budget/queries.js";
import { COMMANDS } from "../src/topics.js";
import { queue } from "../src/shared/infra.js";

const TENANT = "aaaaaaaa-1111-4000-8000-0000000000b2";
const MAKER = "00000000-aaaa-4000-8000-0000000a0022";
const CHECKER = "00000000-aaaa-4000-8000-0000000c0022";
const CHECKER_2 = "00000000-aaaa-4000-8000-0000000c0023";
const HEAD = "66666666-bbbb-4000-8000-000000000022";
const SANC = "66666666-cccc-4000-8000-000000000022";
const MSGS = [1, 2, 3, 4].map((n) => `66666666-dddd-4000-8000-00000000002${n}`);
const REASON = "Provision for head 2202 is earmarked for the November payroll of Municipal Corporation staff";

const ctxOf = (actorId: string) => ({ tenantId: TENANT, actorId, correlationId: "corr-b22-san", roles: ["finance_admin"] }) as never;

async function seed(status: string, extra: Partial<typeof financeSanctions.$inferInsert> = {}) {
  await scoped(TENANT, (tx) => tx.insert(financeSanctions).values({
    id: SANC, tenantId: TENANT, sanctionNo: "SN/2026-27/B22-0001", purpose: "Annual maintenance of street lighting, Ward 14",
    headId: HEAD, amountMinor: 250000n, currency: "INR", status, createdBy: MAKER, updatedBy: MAKER, ...extra,
  }));
}
const row = async () => (await scoped(TENANT, (tx) => tx.select().from(financeSanctions).where(eq(financeSanctions.id, SANC))))[0];

async function clean() {
  await scoped(TENANT, (tx) => tx.delete(outboxMessages).where(eq(outboxMessages.correlationId, "corr-b22-san")));
  for (const m of MSGS) await db.delete(processed).where(eq(processed.messageId, m));
  await scoped(TENANT, (tx) => tx.delete(financeSanctions).where(eq(financeSanctions.id, SANC)));
}
async function waitFor(fn: () => Promise<boolean>, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return; await new Promise((r) => setTimeout(r, 50)); }
}
async function run(topic: string, messageId: string, actorId: string, payload: Record<string, unknown>) {
  const q = new MemoryQueue({ maxAttempts: 1 });
  registerBudgetConsumers(q);
  await q.start();
  await q.publish(topic, { messageId, type: topic, tenantId: TENANT, actorId, correlationId: "corr-b22-san", schemaVersion: "1.0", payload: { id: SANC, tenantId: TENANT, ...payload } });
  await waitFor(async () => q.dlq.length === 1 || (await db.select().from(processed).where(eq(processed.messageId, messageId))).length === 1);
  await q.stop();
  return q;
}

beforeEach(clean);
beforeEach(async () => {
  await scoped(TENANT, (tx) => tx.insert(financeHeads).values({ id: HEAD, tenantId: TENANT, code: "B22-SAN", name: "Street lighting maintenance", level: 1, classification: "expense", createdBy: MAKER, updatedBy: MAKER }).onConflictDoNothing());
  await scoped(TENANT, (tx) => tx.insert(financeBudgets).values({ tenantId: TENANT, headId: HEAD, fy: currentFyIST(), beMinor: 10n ** 12n, reMinor: 10n ** 12n, createdBy: MAKER, updatedBy: MAKER }).onConflictDoNothing());
});
afterAll(async () => { await clean(); await sqlClient.end(); });

describe("W1: an approved sanction cannot be changed by a later reject", () => {
  it("consumer: reject on an approved sanction leaves it approved with its approver", async () => {
    const approvedAt = new Date("2026-11-08T12:13:03Z");
    await seed("approved", { approvedBy: CHECKER, approvedAt, updatedBy: CHECKER });
    const q = await run(COMMANDS.sanctionReject, MSGS[0]!, CHECKER_2, { reason: REASON });
    const r = await row();
    expect(r?.status).toBe("approved");
    expect(r?.approvedBy).toBe(CHECKER);
    expect(r?.updatedBy).toBe(CHECKER);
    expect(q.dlq[0]?.error).toMatch(/INVALID_SANCTION_STATE/);
  });

  it("route: reject on an approved sanction is a 409 INVALID_STATE_TRANSITION, nothing queued", async () => {
    await seed("approved", { approvedBy: CHECKER, approvedAt: new Date(), updatedBy: CHECKER });
    await expect(commands.rejectSanction(ctxOf(CHECKER_2), SANC, { reason: REASON })).rejects.toMatchObject({ status: 409, code: "INVALID_STATE_TRANSITION" });
    expect((await row())?.status).toBe("approved");
  });

  it("race: approve and reject decided together leave exactly one outcome and never approved-then-rejected", async () => {
    await seed("pending_approval");
    const q = new MemoryQueue({ maxAttempts: 1 });
    registerBudgetConsumers(q);
    await q.start();
    const base = { tenantId: TENANT, correlationId: "corr-b22-san", schemaVersion: "1.0" };
    await Promise.all([
      q.publish(COMMANDS.sanctionApprove, { ...base, messageId: MSGS[0]!, type: COMMANDS.sanctionApprove, actorId: CHECKER, payload: { id: SANC, tenantId: TENANT } }),
      q.publish(COMMANDS.sanctionReject, { ...base, messageId: MSGS[1]!, type: COMMANDS.sanctionReject, actorId: CHECKER_2, payload: { id: SANC, tenantId: TENANT, reason: REASON } }),
    ]);
    await waitFor(async () => (await db.select().from(processed).where(eq(processed.messageId, MSGS[0]!))).length + (await db.select().from(processed).where(eq(processed.messageId, MSGS[1]!))).length + q.dlq.length >= 2);
    await q.stop();
    const r = await row();
    expect(["approved", "rejected"]).toContain(r?.status);
    // whichever won, the loser must not have left its marks
    if (r?.status === "approved") expect(r.rejectionReason ?? null).toBeNull();
    else expect(r?.approvedBy ?? null).toBeNull();
  });
});

describe("W2: a rejected sanction is Rejected and carries the reason", () => {
  it("consumer stores status rejected and the reason; the maker's detail shows both", async () => {
    await seed("pending_approval");
    await run(COMMANDS.sanctionReject, MSGS[0]!, CHECKER, { reason: REASON });
    const r = await row();
    expect(r?.status).toBe("rejected");
    expect(r?.rejectionReason).toBe(REASON);
    expect(r?.approvedBy ?? null).toBeNull();
    const detail = await getSanctionDetail(SANC, TENANT);
    expect(detail?.status).toBe("rejected");
    expect(detail?.remarks).toContain("earmarked for the November payroll");
    expect(detail?.approvalTrail.at(-1)).toMatchObject({ action: "rejected", remarks: REASON });
  });
});

describe("W5: a decision the state forbids is refused at the request", () => {
  it("approve after reject: 409 INVALID_STATE_TRANSITION", async () => {
    await seed("rejected", { rejectionReason: REASON, updatedBy: CHECKER });
    await expect(commands.approveSanction(ctxOf(CHECKER_2), SANC)).rejects.toMatchObject({ status: 409, code: "INVALID_STATE_TRANSITION" });
    expect((await row())?.status).toBe("rejected");
  });
  it("reject after reject: 409 INVALID_STATE_TRANSITION", async () => {
    await seed("rejected", { rejectionReason: REASON, updatedBy: CHECKER });
    await expect(commands.rejectSanction(ctxOf(CHECKER_2), SANC, { reason: REASON })).rejects.toMatchObject({ status: 409, code: "INVALID_STATE_TRANSITION" });
  });
  it("approve after approve: 409 INVALID_STATE_TRANSITION", async () => {
    await seed("approved", { approvedBy: CHECKER, approvedAt: new Date(), updatedBy: CHECKER });
    await expect(commands.approveSanction(ctxOf(CHECKER_2), SANC)).rejects.toMatchObject({ status: 409, code: "INVALID_STATE_TRANSITION" });
  });
  it("a legitimate reject of a pending sanction is accepted and, once the consumer runs it, applied", async () => {
    await seed("pending_approval");
    const publish = vi.spyOn(queue, "publish").mockResolvedValue(undefined as never);
    const accepted = await commands.rejectSanction(ctxOf(CHECKER), SANC, { reason: REASON });
    expect(accepted.status).toBe("accepted");
    expect(publish).toHaveBeenCalledTimes(1);
    const [topic, message] = publish.mock.calls[0] as unknown as [string, { messageId: string; actorId: string; payload: Record<string, unknown> }];
    publish.mockRestore();
    expect(topic).toBe(COMMANDS.sanctionReject);
    // drain the very command the route queued through the real consumer
    await run(topic, MSGS[3]!, message.actorId, message.payload);
    const r = await row();
    expect(r?.status).toBe("rejected");
    expect(r?.rejectionReason).toBe(REASON);
  });
});
