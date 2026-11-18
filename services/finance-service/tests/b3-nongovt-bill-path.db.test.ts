/**
 * Segment Phase B3 (real DB, not run in the build session): finance.bill.create by COA template.
 * (a) commercial AND nonprofit bills post with NO HoA and NO DDO row; (b) a govt bill still needs a valid HoA + DDO;
 * (c) a works-style bill (workId, no headCode) takes the tenant template default head from finance.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql, eq } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { db } from "../src/shared/db.js";
import { scoped } from "./_tenant.js";
import { financeBills, financePayments } from "../src/modules/payments/schema.js";
import { financeHeads } from "../src/modules/budget/schema.js";
import { financeDdo, financeVendors } from "../src/modules/masters/schema.js";
import { financeBudgetAllocation } from "../src/modules/budget/allocation-schema.js";
import { seedGlHeadsTx } from "../src/modules/gl/standard-heads.js";
import { registerPaymentsConsumers } from "../src/modules/payments/consumer.js";
import { fyFromDate } from "../src/modules/hoa/voucher.js";
import { COMMANDS } from "../src/topics.js";

const ACTOR = randomUUID();
const PASSER = randomUUID();
const PAYER = randomUUID();
const FY = fyFromDate(new Date().toISOString().slice(0, 10));
type Tpl = "govt" | "commercial" | "nonprofit";
interface Fx { tenantId: string; headId: string; vendorId: string; template: Tpl; code: string }
const mk = (template: Tpl, code: string): Fx => ({ tenantId: randomUUID(), headId: randomUUID(), vendorId: randomUUID(), template, code });
const COM = mk("commercial", "5400"), NPO = mk("nonprofit", "5400"), GOV = mk("govt", "2202");
const all = [COM, NPO, GOV];
let prevFlag: string | undefined;

async function seed(t: Fx, withGovtMasters: boolean): Promise<void> {
  await scoped(t.tenantId, (tx) => tx.execute(sql`
    INSERT INTO gl.finance_settings (tenant_id, coa_template, updated_by) VALUES (${t.tenantId}::uuid, ${t.template}, ${t.tenantId}::uuid)
    ON CONFLICT (tenant_id) DO UPDATE SET coa_template = EXCLUDED.coa_template`));
  await scoped(t.tenantId, (tx) => tx.insert(financeHeads).values({
    id: t.headId, tenantId: t.tenantId, code: t.code, name: "Bill head", level: 1,
    classification: t.template === "govt" ? "expenditure" : "expense",
    ...(t.template === "govt" ? { hoaCode: "220201101010101010" } : {}), createdBy: ACTOR, updatedBy: ACTOR,
  }));
  // The payment-initiate consumer posts Dr Accounts-Payable / Cr Bank, resolved per tenant by code (defaults 2050 / 1100); same
  // seed as tests/payments-initiate-audit.test.ts seedHeads().
  await scoped(t.tenantId, (tx) => tx.insert(financeHeads).values([
    { id: randomUUID(), tenantId: t.tenantId, code: "2050", name: "Accounts Payable control", level: 1, createdBy: ACTOR, updatedBy: ACTOR },
    { id: randomUUID(), tenantId: t.tenantId, code: "1100", name: "Bank", level: 1, createdBy: ACTOR, updatedBy: ACTOR },
  ]).onConflictDoNothing());
  // MSME M1: a commercial tenant is fail-closed on its required commercial heads, so give it the full seeded chart (the 5400
  // above is kept: the seed is ON CONFLICT DO NOTHING).
  if (t.template === "commercial") await scoped(t.tenantId, (tx) => seedGlHeadsTx(tx, t.tenantId, "commercial"));
  if (withGovtMasters) {
    await scoped(t.tenantId, (tx) => tx.insert(financeDdo).values({ tenantId: t.tenantId, ddoCode: "DDO123456", name: "DDO", createdBy: ACTOR, updatedBy: ACTOR }).onConflictDoNothing());
  }
  await scoped(t.tenantId, (tx) => tx.insert(financeVendors).values({
    id: t.vendorId, tenantId: t.tenantId, name: "Vendor", category: "contractor", pan: "BBBBB1234F", address: "1 Road",
    bankName: "Bank", bankAccountNo: "000111222333", ifsc: "TEST0001234", createdBy: ACTOR, updatedBy: ACTOR,
  }));
  await scoped(t.tenantId, (tx) => tx.insert(financeBudgetAllocation).values({
    id: randomUUID(), tenantId: t.tenantId, headId: t.headId, fy: FY, allocatedMinor: 100000000n, committedMinor: 0n, actualMinor: 0n, createdBy: ACTOR, updatedBy: ACTOR,
  }));
}

async function post(t: Fx, over: Record<string, unknown>): Promise<{ billId: string; dlq: string[] }> {
  const q = new MemoryQueue({ maxAttempts: 1 });
  registerPaymentsConsumers(q);
  await q.start();
  const billId = randomUUID();
  await q.publish(COMMANDS.billCreate, {
    messageId: randomUUID(), type: COMMANDS.billCreate, tenantId: t.tenantId, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0",
    payload: { id: billId, tenantId: t.tenantId, billNo: "B3-1", vendorId: t.vendorId, grossMinor: "30000", netMinor: "30000", currency: "INR", deductions: [], poRef: "po:1", grnRef: "grn:1", ...over },
  });
  await q.drain();
  await q.stop();
  return { billId, dlq: q.dlq.map((d) => String(d.error)) };
}
const rowOf = (t: Fx, id: string) => scoped(t.tenantId, (tx) => tx.select().from(financeBills).where(eq(financeBills.id, id))).then((r) => r[0]);

beforeAll(async () => {
  prevFlag = process.env.TENANT_PROFILES_ENABLED;
  process.env.TENANT_PROFILES_ENABLED = "true";
  await seed(COM, false); await seed(NPO, false);
  await seed(GOV, false); // govt tenant deliberately has NO DDO row (set per test)
});
afterAll(async () => {
  if (prevFlag === undefined) delete process.env.TENANT_PROFILES_ENABLED; else process.env.TENANT_PROFILES_ENABLED = prevFlag;
  for (const t of all) {
    await scoped(t.tenantId, (tx) => tx.delete(financePayments).where(eq(financePayments.tenantId, t.tenantId)));
    await scoped(t.tenantId, (tx) => tx.delete(financeBills).where(eq(financeBills.tenantId, t.tenantId)));
    await scoped(t.tenantId, (tx) => tx.delete(financeBudgetAllocation).where(eq(financeBudgetAllocation.tenantId, t.tenantId)));
    await scoped(t.tenantId, (tx) => tx.delete(financeVendors).where(eq(financeVendors.id, t.vendorId)));
    await scoped(t.tenantId, (tx) => tx.delete(financeDdo).where(eq(financeDdo.tenantId, t.tenantId)));
    await scoped(t.tenantId, (tx) => tx.delete(financeHeads).where(eq(financeHeads.tenantId, t.tenantId)));
    await scoped(t.tenantId, (tx) => tx.execute(sql`DELETE FROM gl.finance_settings WHERE tenant_id = ${t.tenantId}::uuid`));
  }
  void db;
});

describe("B3 (a): non-govt tenants post bills with no HoA / DDO structure", () => {
  it.each([COM, NPO])("$template bill posts with headCode 5400, no DDO row and no ddoCode", async (t) => {
    const { billId, dlq } = await post(t, { headCode: "5400" });
    expect(dlq).toEqual([]);
    const row = await rowOf(t, billId);
    expect(row?.headId).toBe(t.headId);
    expect(row?.ddoCode ?? null).toBeNull();
  });
});

describe("B3 (b): a govt bill still requires and validates HoA + DDO", () => {
  it("is refused with no DDO in the master, and posts once the DDO exists", async () => {
    const refused = await post(GOV, { headCode: "2202", ddoCode: "DDO123456" });
    expect(refused.dlq.join(" ")).toMatch(/UNKNOWN_DDO/);
    expect(await rowOf(GOV, refused.billId)).toBeUndefined();
    await scoped(GOV.tenantId, (tx) => tx.insert(financeDdo).values({ tenantId: GOV.tenantId, ddoCode: "DDO123456", name: "DDO", createdBy: ACTOR, updatedBy: ACTOR }).onConflictDoNothing());
    const ok = await post(GOV, { headCode: "2202", ddoCode: "DDO123456" });
    expect(ok.dlq).toEqual([]);
    expect((await rowOf(GOV, ok.billId))?.ddoCode).toBe("DDO123456");
  });
  it("is refused when the head carries no valid HoA", async () => {
    await scoped(GOV.tenantId, (tx) => tx.update(financeHeads).set({ hoaCode: null }).where(eq(financeHeads.id, GOV.headId)));
    const r = await post(GOV, { headCode: "2202", ddoCode: "DDO123456" });
    expect(r.dlq.length).toBe(1);
    await scoped(GOV.tenantId, (tx) => tx.update(financeHeads).set({ hoaCode: "220201101010101010" }).where(eq(financeHeads.id, GOV.headId)));
  });
});

describe("B3 (c): a works-style bill (workId, no headCode) takes the template default head from finance", () => {
  it.each([COM, NPO, GOV])("$template resolves $code", async (t) => {
    if (t === GOV) await scoped(t.tenantId, (tx) => tx.insert(financeDdo).values({ tenantId: t.tenantId, ddoCode: "DDO123456", name: "DDO", createdBy: ACTOR, updatedBy: ACTOR }).onConflictDoNothing());
    const { billId, dlq } = await post(t, { workId: randomUUID(), worksBillId: randomUUID(), poRef: `works_award:${randomUUID()}`, grnRef: `works_bill:${randomUUID()}`, ...(t === GOV ? { ddoCode: "DDO123456" } : {}) });
    expect(dlq).toEqual([]);
    expect((await rowOf(t, billId))?.headId).toBe(t.headId);
  });
});

/** Mark a posted bill passed by a second officer, then run finance.payment.initiate as a third (maker != passer != payer). */
async function pay(t: Fx, billId: string, over: Record<string, unknown>): Promise<{ paymentId: string; dlq: string[] }> {
  await scoped(t.tenantId, (tx) => tx.update(financeBills).set({ status: "passed", updatedBy: PASSER }).where(eq(financeBills.id, billId)));
  const q = new MemoryQueue({ maxAttempts: 1 });
  registerPaymentsConsumers(q);
  await q.start();
  const paymentId = randomUUID();
  await q.publish(COMMANDS.paymentInitiate, {
    messageId: randomUUID(), type: COMMANDS.paymentInitiate, tenantId: t.tenantId, actorId: PAYER, correlationId: randomUUID(), schemaVersion: "1.0",
    payload: { id: paymentId, tenantId: t.tenantId, billId, mode: "NEFT", amountMinor: "30000", currency: "INR", reason: "B3 test", ...over },
  });
  await q.drain();
  await q.stop();
  return { paymentId, dlq: q.dlq.map((d) => String(d.error)) };
}
const payOf = (t: Fx, id: string) => scoped(t.tenantId, (tx) => tx.select().from(financePayments).where(eq(financePayments.id, id))).then((r) => r[0]);

describe("B3 payment path: DDO only for govt", () => {
  it.each([COM, NPO])("$template bill is PAID with no DDO row and no ddoCode (stored null)", async (t) => {
    const bill = await post(t, { headCode: "5400" });
    expect(bill.dlq).toEqual([]);
    const r = await pay(t, bill.billId, {});
    expect(r.dlq).toEqual([]);
    const row = await payOf(t, r.paymentId);
    expect(row?.status).toBe("initiated");
    expect(row?.ddoCode ?? null).toBeNull();
    expect((await rowOf(t, bill.billId))?.status).toBe("paid");
  });
  it("govt payment is still refused without a ddoCode, and with a malformed one, and pays with a valid DDO", async () => {
    // GOV has its DDO row from the (b) tests above.
    const bill = await post(GOV, { headCode: "2202", ddoCode: "DDO123456" });
    expect(bill.dlq).toEqual([]);
    const noDdo = await pay(GOV, bill.billId, {});
    expect(noDdo.dlq.join(" ")).toMatch(/SCHEMA_VIOLATION/);
    expect(await payOf(GOV, noDdo.paymentId)).toBeUndefined();
    const bad = await pay(GOV, bill.billId, { ddoCode: "!!" });
    expect(bad.dlq.length).toBe(1);
    expect(await payOf(GOV, bad.paymentId)).toBeUndefined();
    const ok = await pay(GOV, bill.billId, { ddoCode: "DDO123456" });
    expect(ok.dlq).toEqual([]);
    expect((await payOf(GOV, ok.paymentId))?.ddoCode).toBe("DDO123456");
  });
});
