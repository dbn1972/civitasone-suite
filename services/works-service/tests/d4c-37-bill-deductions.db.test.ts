/**
 * Owner decision D4c #37 (GAP-WORKS-BILLING-BILLS-NEW-03): a contractor bill carries the FIXED statutory deduction
 * heads (security deposit, income-tax TDS, GST TDS, labour cess, retention). Default rates are editable per
 * executing division (tenant-wide default when no division row), the amounts are COMPUTED from the gross, the maker
 * may ADJUST them, and the lines must sum to the bill's total deductions. Stored in works.bill_recoveries so the
 * checker sees computed vs. adjusted. Real Postgres (works_svc, FORCE RLS), real consumers.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, afterAll } from "vitest";
import { runWithTenant } from "@civitasone/db";
import { eq } from "drizzle-orm";
import { db, sqlClient } from "../src/shared/db.js";
import { COMMANDS } from "../src/topics.js";
import { awards } from "../src/modules/tender/schema.js";
import { boqItems } from "../src/modules/boq/schema.js";
import { workProposals } from "../src/modules/proposal/schema.js";
import { bills, billRecoveries, measurementBooks, measurements } from "../src/modules/billing/schema.js";
import { registerBillingConsumers } from "../src/modules/billing/consumer.js";
import { DEDUCTION_HEADS, computeDeductionLines, resolveRates, BUILT_IN_RATE_BPS } from "../src/modules/billing/domain.js";
import { createBillSchema, setDeductionRatesSchema } from "../src/modules/billing/validators.js";
import { getEffectiveDeductionRates, listRecoveriesForBill } from "../src/modules/billing/repo.js";

const TENANT = `d4c37000-0000-4000-8000-${randomUUID().slice(24)}`;
const MAKER = randomUUID();
const ADMIN = randomUUID();

type Handler = (msg: unknown) => Promise<void>;
const handlers: Record<string, Handler> = {};
registerBillingConsumers({ subscribe: (t: string, fn: Handler) => { handlers[t] = fn; } } as never);

const deliver = (command: string, payload: Record<string, unknown>, actorId = MAKER) =>
  runWithTenant(TENANT, () => handlers[command]!({
    messageId: randomUUID(), tenantId: TENANT, actorId, correlationId: "d4c37", schemaVersion: "1.0", payload,
  }));
const inTenant = <T>(fn: () => Promise<T>) => runWithTenant(TENANT, fn);
const inTx = <T>(fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>) =>
  runWithTenant(TENANT, () => db.transaction(fn));

afterAll(async () => {
  await sqlClient.begin(async (sql) => {
    await sql`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    for (const t of ["works.bill_recoveries", "works.deduction_rates", "works.bill_items", "works.bills", "works.measurements",
      "works.measurement_books", "works.boq_items", "works.awards", "works.work_proposals"]) {
      await sql.unsafe(`DELETE FROM ${t} WHERE tenant_id = '${TENANT}'`);
    }
  });
  await sqlClient`DELETE FROM _outbox.messages WHERE tenant_id = ${TENANT}`;
  await sqlClient.end();
});

async function seedBillableWork(divisionId: string | null = null) {
  const workId = randomUUID(); const awardId = randomUUID(); const mbId = randomUUID(); const boqId = randomUUID();
  await inTx(async (tx) => {
    await tx.insert(workProposals).values({
      id: workId, tenantId: TENANT, workNumber: `W/${workId.slice(0, 6)}`, category: "regular", description: "d4c37",
      workTypeId: randomUUID(), estimatedCostMinor: 100000000n, executingDivisionId: divisionId, createdBy: MAKER, updatedBy: MAKER,
    });
    await tx.insert(awards).values({ id: awardId, tenantId: TENANT, workId, contractorName: "Acme", acceptedAmountMinor: 100000000n, createdBy: MAKER });
    await tx.insert(boqItems).values({ id: boqId, tenantId: TENANT, workId, itemDescription: "Earthwork", unit: "cum", rate: 100n, quantity: "100000", amountMinor: 10000000n, createdBy: MAKER });
    await tx.insert(measurementBooks).values({ id: mbId, tenantId: TENANT, workId, awardId, mbNumber: `MB-${mbId.slice(0, 6)}`, issuedBy: MAKER, status: "do_finalized", createdBy: MAKER, updatedBy: MAKER });
    await tx.insert(measurements).values({ id: randomUUID(), tenantId: TENANT, mbId, boqItemId: boqId, quantity: "10000", createdBy: MAKER, updatedBy: MAKER });
  });
  return { workId, awardId, mbId };
}
const billPayload = (w: { workId: string; awardId: string; mbId: string }, n: string, extra: Record<string, unknown> = {}) => ({
  id: randomUUID(), workId: w.workId, awardId: w.awardId, mbId: w.mbId, billMode: "e_mb", billNumber: n, grossAmountMinor: "1000000", ...extra,
});

describe("domain: fixed heads + computed lines", () => {
  it("the heads are exactly the five approved ones, in a stable order", () => {
    expect([...DEDUCTION_HEADS]).toEqual(["security_deposit", "income_tax_tds", "gst_tds", "labour_cess", "retention"]);
  });
  it("computes each line as gross x rate (basis points) in exact paise and the lines sum to the total", () => {
    const lines = computeDeductionLines(1_000_000n, { security_deposit: 500, income_tax_tds: 200, gst_tds: 200, labour_cess: 100, retention: 0 });
    expect(lines.map((l) => [l.head, l.amountMinor])).toEqual([
      ["security_deposit", 50000n], ["income_tax_tds", 20000n], ["gst_tds", 20000n], ["labour_cess", 10000n], ["retention", 0n],
    ]);
    expect(lines.reduce((s, l) => s + l.amountMinor, 0n)).toBe(100000n);
  });
  it("rounds half-up to the paisa and never loses precision above 2^53", () => {
    expect(computeDeductionLines(1001n, { ...BUILT_IN_RATE_BPS, gst_tds: 250 }).find((l) => l.head === "gst_tds")!.amountMinor).toBe(25n); // 25.025 -> 25
    expect(computeDeductionLines(900700000000000001n, { ...BUILT_IN_RATE_BPS, retention: 10000 }).find((l) => l.head === "retention")!.amountMinor).toBe(900700000000000001n);
  });
  it("a division row beats the tenant default row, which beats the built-in default", () => {
    const rows = [
      { divisionId: null, head: "gst_tds", rateBps: 300 },
      { divisionId: "dv1", head: "gst_tds", rateBps: 150 },
      { divisionId: "dv2", head: "labour_cess", rateBps: 50 },
    ];
    expect(resolveRates(rows, "dv1").gst_tds).toBe(150);
    expect(resolveRates(rows, "dv3").gst_tds).toBe(300);
    expect(resolveRates(rows, null).gst_tds).toBe(300);
    expect(resolveRates(rows, "dv1").labour_cess).toBe(BUILT_IN_RATE_BPS.labour_cess);
  });
});

describe("validators", () => {
  const base = { workId: randomUUID(), awardId: randomUUID(), mbId: randomUUID(), billMode: "e_mb", billNumber: "RA-1", grossAmountMinor: "1000" };
  it("accepts recoveries for the fixed heads only, each at most once", () => {
    expect(createBillSchema.parse({ ...base, recoveries: [{ recoveryType: "gst_tds", amountMinor: "20" }] }).recoveries).toHaveLength(1);
    expect(() => createBillSchema.parse({ ...base, recoveries: [{ recoveryType: "bribe", amountMinor: "20" }] })).toThrow();
    expect(() => createBillSchema.parse({ ...base, recoveries: [{ recoveryType: "gst_tds", amountMinor: "1" }, { recoveryType: "gst_tds", amountMinor: "2" }] })).toThrow();
    expect(() => createBillSchema.parse({ ...base, recoveries: [{ recoveryType: "gst_tds", amountMinor: "-1" }] })).toThrow();
  });
  it("rate-set payload bounds each rate to 0..10000 bps and rejects an empty set", () => {
    expect(setDeductionRatesSchema.parse({ rates: [{ head: "gst_tds", rateBps: 200 }] }).rates).toHaveLength(1);
    expect(() => setDeductionRatesSchema.parse({ rates: [{ head: "gst_tds", rateBps: 10001 }] })).toThrow();
    expect(() => setDeductionRatesSchema.parse({ rates: [] })).toThrow();
  });
});

describe("billCreate persists the deduction lines (real DB)", () => {
  it("stores one bill_recoveries row per supplied head with the server-computed amount beside the maker's amount; deductions = sum; net = gross - sum", async () => {
    const w = await seedBillableWork();
    const p = billPayload(w, "RA-1", {
      recoveries: [
        { recoveryType: "security_deposit", amountMinor: "50000" },   // as computed (5%)
        { recoveryType: "income_tax_tds", amountMinor: "10000" },     // maker adjusted down from 2% (20000)
        { recoveryType: "gst_tds", amountMinor: "20000" },
        { recoveryType: "labour_cess", amountMinor: "10000" },
      ],
    });
    await deliver(COMMANDS.billCreate, p);
    const [bill] = await inTx((tx) => tx.select().from(bills).where(eq(bills.id, p.id)));
    expect(bill!.deductionsMinor).toBe(90000n);
    expect(bill!.netPayableMinor).toBe(910000n);
    const rows = await inTx((tx) => tx.select().from(billRecoveries).where(eq(billRecoveries.billId, p.id)));
    expect(rows).toHaveLength(4);
    const tds = rows.find((r) => r.recoveryType === "income_tax_tds")!;
    expect(tds.amountMinor).toBe(10000n);
    expect(tds.computedAmountMinor).toBe(20000n);
    expect(tds.rateBps).toBe(BUILT_IN_RATE_BPS.income_tax_tds);
    expect(tds.createdBy).toBe(MAKER);
    const listed = await inTenant(() => listRecoveriesForBill(TENANT, p.id));
    expect(listed.map((r) => r.recoveryType).sort()).toEqual(["gst_tds", "income_tax_tds", "labour_cess", "security_deposit"]);
  });

  it("uses the division's own rate for the computed column when that division has a rate set", async () => {
    const divisionId = randomUUID();
    await deliver(COMMANDS.deductionRateSet, { divisionId, rates: [{ head: "gst_tds", rateBps: 400 }] }, ADMIN);
    const w = await seedBillableWork(divisionId);
    const p = billPayload(w, "RA-DIV", { recoveries: [{ recoveryType: "gst_tds", amountMinor: "40000" }] });
    await deliver(COMMANDS.billCreate, p);
    const [row] = await inTx((tx) => tx.select().from(billRecoveries).where(eq(billRecoveries.billId, p.id)));
    expect(row!.rateBps).toBe(400);
    expect(row!.computedAmountMinor).toBe(40000n);
  });

  it("refuses a deductionsMinor that disagrees with the sum of the lines, and writes nothing", async () => {
    const w = await seedBillableWork();
    const p = billPayload(w, "RA-MISMATCH", { deductionsMinor: "999", recoveries: [{ recoveryType: "gst_tds", amountMinor: "20000" }] });
    await expect(deliver(COMMANDS.billCreate, p)).rejects.toThrow(/DEDUCTIONS_MISMATCH/);
    expect(await inTx((tx) => tx.select().from(bills).where(eq(bills.id, p.id)))).toHaveLength(0);
  });

  it("refuses lines that sum to more than the gross", async () => {
    const w = await seedBillableWork();
    const p = billPayload(w, "RA-OVER", { recoveries: [{ recoveryType: "retention", amountMinor: "1000001" }] });
    await expect(deliver(COMMANDS.billCreate, p)).rejects.toThrow(/DEDUCTIONS_EXCEED_GROSS/);
    expect(await inTx((tx) => tx.select().from(bills).where(eq(bills.id, p.id)))).toHaveLength(0);
  });

  it("a bill sent without lines keeps working exactly as before (plain deductionsMinor, no rows)", async () => {
    const w = await seedBillableWork();
    const p = billPayload(w, "RA-PLAIN", { deductionsMinor: "1000" });
    await deliver(COMMANDS.billCreate, p);
    const [bill] = await inTx((tx) => tx.select().from(bills).where(eq(bills.id, p.id)));
    expect(bill!.netPayableMinor).toBe(999000n);
    expect(await inTenant(() => listRecoveriesForBill(TENANT, p.id))).toHaveLength(0);
  });
});

describe("deduction rates (per-division defaults)", () => {
  it("setting rates upserts one row per head, is idempotent on replay, and a later set overwrites", async () => {
    const divisionId = randomUUID();
    await deliver(COMMANDS.deductionRateSet, { divisionId, rates: [{ head: "labour_cess", rateBps: 120 }, { head: "retention", rateBps: 500 }] }, ADMIN);
    await deliver(COMMANDS.deductionRateSet, { divisionId, rates: [{ head: "labour_cess", rateBps: 90 }] }, ADMIN);
    const eff = await inTenant(() => getEffectiveDeductionRates(TENANT, divisionId));
    expect(eff.labour_cess).toBe(90);
    expect(eff.retention).toBe(500);
    expect(eff.gst_tds).toBe(BUILT_IN_RATE_BPS.gst_tds);
    const rows = await sqlClient.begin(async (sql) => {
      await sql`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
      return sql`SELECT head FROM works.deduction_rates WHERE tenant_id = ${TENANT} AND division_id = ${divisionId}`;
    });
    expect(rows).toHaveLength(2);
  });

  it("a tenant-wide default (no division) applies to a division with no row of its own", async () => {
    await deliver(COMMANDS.deductionRateSet, { divisionId: null, rates: [{ head: "income_tax_tds", rateBps: 1 }] }, ADMIN);
    const eff = await inTenant(() => getEffectiveDeductionRates(TENANT, randomUUID()));
    expect(eff.income_tax_tds).toBe(1);
  });

  it("the same command delivered twice (same messageId) is applied once", async () => {
    const divisionId = randomUUID(); const messageId = randomUUID();
    const m = { messageId, tenantId: TENANT, actorId: ADMIN, correlationId: "x", schemaVersion: "1.0", payload: { divisionId, rates: [{ head: "gst_tds", rateBps: 11 }] } };
    await runWithTenant(TENANT, () => handlers[COMMANDS.deductionRateSet]!(m));
    await runWithTenant(TENANT, () => handlers[COMMANDS.deductionRateSet]!({ ...m, payload: { divisionId, rates: [{ head: "gst_tds", rateBps: 99 }] } }));
    expect((await inTenant(() => getEffectiveDeductionRates(TENANT, divisionId))).gst_tds).toBe(11);
  });
});
