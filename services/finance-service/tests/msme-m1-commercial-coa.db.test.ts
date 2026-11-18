/**
 * MSME commercial M1 (real DB): seeding is idempotent and collision-safe, writes only budget.finance_heads (never the global
 * major-head master), stamps statement_class on commercial heads only, and a commercial tenant missing its required heads
 * is refused (fail-closed). Vendor master captures udyam_category.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql, eq } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { db } from "../src/shared/db.js";
import { scoped } from "./_tenant.js";
import { financeHeads } from "../src/modules/budget/schema.js";
import { financeVendors } from "../src/modules/masters/schema.js";
import { financeBills } from "../src/modules/payments/schema.js";
import { seedGlHeadsTx, CoaTemplateCollisionError } from "../src/modules/gl/standard-heads.js";
import { assertCommercialChartReadyTx, CommercialChartIncompleteError } from "../src/modules/gl/commercial-chart.js";
import { registerPaymentsConsumers } from "../src/modules/payments/consumer.js";
import { COMMANDS } from "../src/topics.js";

const ACTOR = randomUUID();
const mk = () => randomUUID();
const COM = mk(), GOV = mk(), CLASH = mk(), PART = mk();
const all = [COM, GOV, CLASH, PART];
let prevFlag: string | undefined;

const count = (t: string) => scoped(t, (tx) => tx.select({ n: sql<number>`count(*)::int` }).from(financeHeads).where(eq(financeHeads.tenantId, t))).then((r) => r[0]!.n);
const majorCount = () => db.execute(sql`SELECT count(*)::int AS n FROM budget.finance_major_heads`).then((r) => (r as unknown as Array<{ n: number }>)[0]!.n);
const setTemplate = (t: string, template: string) => scoped(t, (tx) => tx.execute(sql`
  INSERT INTO gl.finance_settings (tenant_id, coa_template, updated_by) VALUES (${t}::uuid, ${template}, ${ACTOR}::uuid)
  ON CONFLICT (tenant_id) DO UPDATE SET coa_template = EXCLUDED.coa_template`));

beforeAll(() => { prevFlag = process.env.TENANT_PROFILES_ENABLED; process.env.TENANT_PROFILES_ENABLED = "true"; });
afterAll(async () => {
  if (prevFlag === undefined) delete process.env.TENANT_PROFILES_ENABLED; else process.env.TENANT_PROFILES_ENABLED = prevFlag;
  for (const t of all) {
    await scoped(t, (tx) => tx.delete(financeBills).where(eq(financeBills.tenantId, t)));
    await scoped(t, (tx) => tx.delete(financeVendors).where(eq(financeVendors.tenantId, t)));
    await scoped(t, (tx) => tx.delete(financeHeads).where(eq(financeHeads.tenantId, t)));
    await scoped(t, (tx) => tx.execute(sql`DELETE FROM gl.finance_settings WHERE tenant_id = ${t}::uuid`));
  }
});

describe("M1 seed: idempotent, tenant-table only, statement_class on commercial heads only", () => {
  it("commercial seed twice = same rows; never touches the global major-head master", async () => {
    const before = await majorCount();
    await scoped(COM, (tx) => seedGlHeadsTx(tx, COM, "commercial"));
    const n1 = await count(COM);
    await scoped(COM, (tx) => seedGlHeadsTx(tx, COM, "commercial"));
    expect(await count(COM)).toBe(n1);
    expect(await majorCount()).toBe(before);
    const rows = await scoped(COM, (tx) => tx.select({ code: financeHeads.code, sc: financeHeads.statementClass, hoa: financeHeads.hoaCode }).from(financeHeads).where(eq(financeHeads.tenantId, COM)));
    expect(rows.every((r) => r.sc !== null)).toBe(true);
    expect(rows.every((r) => r.hoa === null)).toBe(true);
    expect(rows.find((r) => r.code === "5400")?.sc).toBe("expense");
    expect(rows.find((r) => r.code === "3200")?.sc).toBe("reserve");
    expect(rows.find((r) => r.code === "2300")?.sc).toBe("current_liability");
  });
  it("govt seed leaves statement_class NULL on every row", async () => {
    await scoped(GOV, (tx) => seedGlHeadsTx(tx, GOV, "govt"));
    const rows = await scoped(GOV, (tx) => tx.select({ sc: financeHeads.statementClass }).from(financeHeads).where(eq(financeHeads.tenantId, GOV)));
    expect(rows.length).toBeGreaterThan(10);
    expect(rows.every((r) => r.sc === null)).toBe(true);
  });
  it("collision: a tenant already using 3000 for another purpose aborts the commercial seed and writes nothing", async () => {
    await scoped(CLASH, (tx) => tx.insert(financeHeads).values({ tenantId: CLASH, code: "3000", name: "Misc spend", level: 1, classification: "expense", createdBy: ACTOR, updatedBy: ACTOR }));
    await expect(scoped(CLASH, (tx) => seedGlHeadsTx(tx, CLASH, "commercial"))).rejects.toBeInstanceOf(CoaTemplateCollisionError);
    expect(await count(CLASH)).toBe(1);
  });
});

describe("M1 fail-closed by classification", () => {
  it("refuses a partial commercial chart, a wrong-classification code, and passes the full chart", async () => {
    await scoped(PART, (tx) => tx.insert(financeHeads).values({ tenantId: PART, code: "5400", name: "Purchases", level: 1, classification: "expense", createdBy: ACTOR, updatedBy: ACTOR }));
    await expect(scoped(PART, (tx) => assertCommercialChartReadyTx(tx, PART))).rejects.toBeInstanceOf(CommercialChartIncompleteError);
    await scoped(PART, (tx) => seedGlHeadsTx(tx, PART, "commercial"));
    await expect(scoped(PART, (tx) => assertCommercialChartReadyTx(tx, PART))).resolves.toBeUndefined();
    await scoped(PART, (tx) => tx.update(financeHeads).set({ classification: "expense" }).where(sql`${financeHeads.tenantId} = ${PART}::uuid AND ${financeHeads.code} = '3000'`));
    await expect(scoped(PART, (tx) => assertCommercialChartReadyTx(tx, PART))).rejects.toThrow(/3000 is expense, expected equity/);
  });
  it("the bill consumer refuses (DLQ, JOURNAL_COA_TEMPLATE_INCOMPLETE) a commercial tenant with an incomplete chart", async () => {
    const T = mk(); all.push(T);
    await setTemplate(T, "commercial");
    await scoped(T, (tx) => tx.insert(financeHeads).values({ tenantId: T, code: "5400", name: "Purchases", level: 1, classification: "expense", createdBy: ACTOR, updatedBy: ACTOR }));
    const vendorId = mk();
    await scoped(T, (tx) => tx.insert(financeVendors).values({ id: vendorId, tenantId: T, name: "V", category: "supplier", pan: "BBBBB1234F", address: "1 Rd", bankName: "B", bankAccountNo: "000111222333", ifsc: "TEST0001234", createdBy: ACTOR, updatedBy: ACTOR }));
    const q = new MemoryQueue({ maxAttempts: 1 });
    registerPaymentsConsumers(q);
    await q.start();
    await q.publish(COMMANDS.billCreate, {
      messageId: mk(), type: COMMANDS.billCreate, tenantId: T, actorId: ACTOR, correlationId: mk(), schemaVersion: "1.0",
      payload: { id: mk(), tenantId: T, billNo: "M1-1", vendorId, headCode: "5400", grossMinor: "30000", netMinor: "30000", currency: "INR", deductions: [], poRef: "po:1", grnRef: "grn:1" },
    });
    await q.drain(); await q.stop();
    expect(q.dlq.map((d) => String(d.error)).join(" ")).toMatch(/JOURNAL_COA_TEMPLATE_INCOMPLETE/);
  });
});

describe("M1 vendor master: udyam_category", () => {
  it("round-trips a valid class, defaults NULL, and the CHECK rejects an unknown class", async () => {
    const base = { tenantId: COM, name: "V", category: "supplier", address: "1 Rd", bankName: "B", bankAccountNo: "000111222333", ifsc: "TEST0001234", createdBy: ACTOR, updatedBy: ACTOR };
    const a = mk(), b = mk();
    await scoped(COM, (tx) => tx.insert(financeVendors).values({ ...base, id: a, pan: "AAAAA1111A", udyamCategory: "micro" }));
    await scoped(COM, (tx) => tx.insert(financeVendors).values({ ...base, id: b, pan: "AAAAA2222B" }));
    const rows = await scoped(COM, (tx) => tx.select({ id: financeVendors.id, u: financeVendors.udyamCategory }).from(financeVendors).where(eq(financeVendors.tenantId, COM)));
    expect(rows.find((r) => r.id === a)?.u).toBe("micro");
    expect(rows.find((r) => r.id === b)?.u).toBeNull();
    await expect(scoped(COM, (tx) => tx.insert(financeVendors).values({ ...base, id: mk(), pan: "AAAAA3333C", udyamCategory: "bogus" }))).rejects.toThrow();
  });
});
