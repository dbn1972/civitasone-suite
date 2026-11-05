/**
 * #2464 review blocker 2 (bundle 19), real Postgres: the new heads (2104-2108, 3100, 4310) may not exist in a tenant yet.
 *  - the standard-heads backfill (a mandatory deploy prerequisite) adds every one of them: dry run by default,
 *    idempotent, never changes an existing head;
 *  - safety net: a payroll accrual whose split deduction head is missing posts that line to 2102 with a warning and
 *    never dead-letters; with the heads present the split heads are used;
 *  - a cash-basis disposal with no 4310 posts the proceeds to the miscellaneous receipts head (4001) with a warning.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { MemoryQueue, type Handler } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { eq, and } from "drizzle-orm";
import { sqlClient } from "../src/shared/db.js";
import { scoped } from "./_tenant.js";
import { financeHeads, financeBudgets } from "../src/modules/budget/schema.js";
import { financeJournals, financeJournalLines } from "../src/modules/gl/schema.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { registerIntegrationConsumers } from "../src/modules/integrations/consumer.js";
import { registerGlConsumers } from "../src/modules/gl/consumer.js";
import { deterministicId } from "../src/modules/gl/spine.js";
import { COMMANDS, CONSUMED_EVENTS } from "../src/topics.js";
import { currentFyIST, todayIST } from "../src/shared/ist-date.js";
import { backfillStandardGlHeads, parseArgs } from "../scripts/backfill-standard-gl-heads.js";

const ACTOR = randomUUID();
const BARE = randomUUID();   // only the heads the accrual always needs
const FULL = randomUUID();   // also the split deduction heads
const NO4310 = randomUUID(); // cash basis, 4001 but no 4310
const NONE = randomUUID();   // cash basis, neither 4310 nor 4001
const BF = randomUUID();     // backfill
const pg = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
let q: MemoryQueue;

function tenantWrappedQueue(): MemoryQueue {
  const m = new MemoryQueue({ maxAttempts: 1 });
  const raw = m.subscribe.bind(m);
  m.subscribe = ((topic: string, handler: Handler) => raw(topic, (msg: Parameters<Handler>[0]) => runWithTenant(msg.tenantId, () => handler(msg)))) as typeof m.subscribe;
  return m;
}
async function publish(tenantId: string, topic: string, payload: Record<string, unknown>) {
  await q.publish(topic, { messageId: randomUUID(), type: topic, tenantId, actorId: ACTOR, correlationId: `hf-${randomUUID().slice(0, 8)}`, schemaVersion: "1.0", payload });
  await q.drain();
}
async function chart(t: string, list: Array<[string, string, string]>) {
  for (const [code, name, classification] of list) {
    await scoped(t, (tx) => tx.insert(financeHeads).values({ tenantId: t, code, name, level: 1, classification, createdBy: ACTOR, updatedBy: ACTOR }));
  }
}
const outbox = async (t: string, topic: string) => ((await scoped(t, (tx) => tx.select().from(outboxMessages).where(and(eq(outboxMessages.tenantId, t), eq(outboxMessages.topic, topic))))) as Array<{ payload: Record<string, unknown> }>).map((r) => r.payload);
const accrual = (runId: string) => ({
  runId, month: todayIST().slice(0, 7), totalGrossMinor: "100000", totalNetMinor: "80000", totalEmployerContribMinor: "0",
  employeeDeductionsMinor: { tds: "5000", gpf: "0", nps: "10000", pf: "0", esi: "0", pt: "200", other: "4800" },
});
const accrualPayload = async (t: string, runId: string) => (await outbox(t, COMMANDS.journalPost)).find((p) => String(p.voucherNo).endsWith(runId.slice(0, 8)));
const legs = (p: Record<string, unknown> | undefined) => ((p?.lines ?? []) as Array<{ accountCode: string; debitMinor: string; creditMinor: string }>).map((l) => [l.accountCode, l.debitMinor, l.creditMinor]);

beforeAll(async () => {
  const base: Array<[string, string, string]> = [["1100", "Cash / Bank", "asset"], ["5001", "Salary Expense", "expense"], ["2101", "Net Salary Payable", "liability"], ["2102", "Other deductions", "liability"]];
  await chart(BARE, base);
  await chart(FULL, [...base, ["2200", "TDS Payable", "liability"], ["2105", "NPS Payable", "liability"], ["2108", "PT Payable", "liability"]]);
  for (const t of [BARE, FULL]) {
    const [h] = await scoped(t, (tx) => tx.select().from(financeHeads).where(and(eq(financeHeads.tenantId, t), eq(financeHeads.code, "5001"))));
    await scoped(t, (tx) => tx.insert(financeBudgets).values({ tenantId: t, headId: h!.id, fy: currentFyIST(), beMinor: 10n ** 12n, reMinor: 10n ** 12n, createdBy: ACTOR, updatedBy: ACTOR }));
  }
  await chart(NO4310, [["1100", "Cash / Bank", "asset"], ["4001", "Revenue Income", "income"]]);
  await chart(NONE, [["1100", "Cash / Bank", "asset"]]);
  q = tenantWrappedQueue();
  registerIntegrationConsumers(q); registerGlConsumers(q);
  await q.start();
});
afterAll(async () => { await q.stop(); await pg.end({ timeout: 5 }); await sqlClient.end(); });

describe("payroll accrual: split deduction heads with a 2102 safety net", () => {
  it("heads missing: every deduction line falls back to 2102, a warning is recorded, and the accrual posts (no DLQ)", async () => {
    const runId = randomUUID();
    await publish(BARE, CONSUMED_EVENTS.payrollRunApproved, accrual(runId));
    const p = await accrualPayload(BARE, runId);
    expect(legs(p).sort()).toEqual([["2101", "0", "80000"], ["2102", "0", "10000"], ["2102", "0", "200"], ["2102", "0", "4800"], ["2102", "0", "5000"], ["5001", "100000", "0"]]);
    const warn = (await outbox(BARE, "audit.event.record")).filter((a) => a.code === "PAYROLL_DEDUCTION_HEAD_MISSING" && a.resourceId === runId);
    expect(warn).toHaveLength(1);
    expect((warn[0]!.missingHeads as string[]).sort()).toEqual(["2105", "2108", "2200"]);
    // the relayed journal posts
    await publish(BARE, COMMANDS.journalPost, p!);
    expect(await scoped(BARE, (tx) => tx.select().from(financeJournals).where(eq(financeJournals.id, String(p!.id))))).toHaveLength(1);
    expect(q.dlq).toHaveLength(0);
  });
  it("heads present: the split heads are used and no warning is recorded", async () => {
    const runId = randomUUID();
    await publish(FULL, CONSUMED_EVENTS.payrollRunApproved, accrual(runId));
    const p = await accrualPayload(FULL, runId);
    expect(legs(p).sort()).toEqual([["2101", "0", "80000"], ["2102", "0", "4800"], ["2105", "0", "10000"], ["2108", "0", "200"], ["2200", "0", "5000"], ["5001", "100000", "0"]]);
    expect((await outbox(FULL, "audit.event.record")).filter((a) => a.code === "PAYROLL_DEDUCTION_HEAD_MISSING")).toHaveLength(0);
    await publish(FULL, COMMANDS.journalPost, p!);
    expect(await scoped(FULL, (tx) => tx.select().from(financeJournals).where(eq(financeJournals.id, String(p!.id))))).toHaveLength(1);
    expect(q.dlq).toHaveLength(0);
  });
});

describe("cash-basis disposal proceeds with no 4310 head", () => {
  const disposal = (assetId: string) => ({ type: "asset_disposal", assetId, acquisitionCost: "120000", accumulatedDep: "3000", proceeds: 5000, gainLoss: "-112000", currency: "INR", disposalDate: todayIST() });
  it("falls back to the miscellaneous receipts head 4001 with a warning", async () => {
    const assetId = randomUUID();
    await publish(NO4310, COMMANDS.journalPost, disposal(assetId));
    const id = deterministicId(`asset_disposal:${assetId}`);
    const lines = (await scoped(NO4310, (tx) => tx.select().from(financeJournalLines).where(eq(financeJournalLines.journalId, id)))) as Array<{ headCode: string; debitMinor: bigint; creditMinor: bigint }>;
    expect(lines.map((l) => [l.headCode, String(l.debitMinor), String(l.creditMinor)]).sort()).toEqual([["1100", "5000", "0"], ["4001", "0", "5000"]]);
    expect((await outbox(NO4310, "audit.event.record")).filter((a) => a.code === "ASSET_SALE_RECEIPT_HEAD_MISSING")).toHaveLength(1);
  });
  it("with neither head the receipt is refused (UNKNOWN_ACCOUNT_CODE), as before", async () => {
    const assetId = randomUUID();
    const before = q.dlq.length;
    await publish(NONE, COMMANDS.journalPost, disposal(assetId));
    const codes = (await outbox(NONE, "finance.gl.rejected")).filter((r) => r.journalId === deterministicId(`asset_disposal:${assetId}`)).map((r) => r.code);
    expect(codes).toEqual(["UNKNOWN_ACCOUNT_CODE"]);
    expect(q.dlq.length).toBe(before + 1);
    q.dlq.length = before;
  });
});

describe("backfill-standard-gl-heads covers every head this PR introduces (mandatory deploy prerequisite)", () => {
  it("is a dry run by default; --apply writes; both together are refused", () => {
    expect(parseArgs([]).dryRun).toBe(true);
    expect(parseArgs(["--dry-run"]).dryRun).toBe(true);
    expect(parseArgs(["--apply", "--tenant", BF]).dryRun).toBe(false);
    expect(() => parseArgs(["--apply", "--dry-run"])).toThrow(/mutually exclusive/);
  });
  it("adds 2104-2108, 3100 and 4310 to a tenant without them, idempotently, and never changes an existing head", async () => {
    await chart(BF, [["1100", "Cash / Bank", "asset"], ["2105", "Our own NPS head", "liability"]]);
    const NEW = ["2104", "2106", "2107", "2108", "3100", "4310"];
    const [dry] = await backfillStandardGlHeads(pg, { dryRun: true, tenants: [BF] });
    const planned = dry!.missing.map((h) => h.code);
    for (const c of NEW) expect(planned).toContain(c);
    expect(planned).not.toContain("2105");
    expect(dry!.inserted).toEqual([]);
    const [applied] = await backfillStandardGlHeads(pg, { dryRun: false, tenants: [BF] });
    for (const c of NEW) expect(applied!.inserted).toContain(c);
    const [nps] = await scoped(BF, (tx) => tx.select().from(financeHeads).where(and(eq(financeHeads.tenantId, BF), eq(financeHeads.code, "2105"))));
    expect(nps!.name).toBe("Our own NPS head");
    const [again] = await backfillStandardGlHeads(pg, { dryRun: false, tenants: [BF] });
    expect(again!.inserted).toEqual([]);
  });
});
