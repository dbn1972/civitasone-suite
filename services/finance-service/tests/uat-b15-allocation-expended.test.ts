/**
 * UAT bundle 15 (R-N1): Budget Allocation showed EXPENDED Rs 0.00 on UT3E2192 while Budget Monitoring and the ledger
 * showed Rs 270. GET /v1/finance/budget-allocations returned the stored allocation `actual_minor` (moved only by the
 * payment consumers), while monitoring reads the books (monitoring-books.ts, bundle 14 A7). The allocation list and
 * detail now use the same books-based line, so the two screens agree.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { scoped } from "./_tenant.js";
import { bearer } from "./_fp02.js";
import { financeLedger, financeJournals } from "../src/modules/gl/schema.js";
import { deterministicId } from "../src/modules/gl/spine.js";
import { financeHeads } from "../src/modules/budget/schema.js";
import { financeBudgetAllocation } from "../src/modules/budget/allocation-schema.js";
import { financeBills } from "../src/modules/payments/schema.js";

const T = randomUUID();
const MAKER = "00000000-0f2a-4000-8000-0000000000b1";
const READER = "00000000-0f2a-4000-8000-0000000000b2";
const H = { edu: randomUUID(), ap: randomUUID(), cash: randomUUID(), med: randomUUID() };
const ALLOC = { edu: randomUUID(), med: randomUUID() };
let app: Awaited<ReturnType<typeof buildApp>>;
const headers = () => bearer(T, READER, ["finance_officer"]);
const get = (url: string) => app.inject({ method: "GET", url, headers: headers() });
const ledger = (headId: string, dr: bigint, cr: bigint, postingDate = "2026-09-10") => ({
  tenantId: T, headId, debitMinor: dr, creditMinor: cr, voucherNo: `JV-${randomUUID().slice(0, 6)}`, postingDate, createdBy: MAKER, updatedBy: MAKER,
});

beforeAll(async () => {
  app = await buildApp();
  await scoped(T, (tx) => tx.insert(financeHeads).values([
    { id: H.edu, tenantId: T, code: "2202", name: "General Education", level: 0, classification: "expense", createdBy: MAKER, updatedBy: MAKER },
    { id: H.ap, tenantId: T, code: "2050", name: "Accounts Payable", level: 0, classification: "liability", createdBy: MAKER, updatedBy: MAKER },
    { id: H.cash, tenantId: T, code: "1100", name: "Cash / Bank", level: 0, classification: "asset", createdBy: MAKER, updatedBy: MAKER },
    { id: H.med, tenantId: T, code: "2210", name: "Medical", level: 0, classification: "expense", createdBy: MAKER, updatedBy: MAKER },
  ]));
  // The UT3E2192 case: a Rs 270 direct journal voucher on 2202 (debit expense, credit cash), plus one passed bill of
  // Rs 500 whose GL journal is posted (booked, still unpaid) and is committed on the allocation. A posting outside
  // FY 2026-27 must not count.
  const billId = randomUUID();
  await scoped(T, (tx) => tx.insert(financeBills).values({
    id: billId, tenantId: T, billNo: `B-${billId.slice(0, 8)}`, vendorId: randomUUID(), headId: H.edu, grossMinor: 50000n, netMinor: 50000n,
    billDate: "2026-09-10", status: "passed", createdBy: MAKER, updatedBy: MAKER,
  }));
  await scoped(T, (tx) => tx.insert(financeJournals).values({
    id: deterministicId(`bill:${billId}`), tenantId: T, voucherNo: `BILL-${billId.slice(0, 8)}`, type: "bill", postingDate: "2026-09-10",
    status: "posted", createdBy: MAKER, updatedBy: MAKER,
    lines: [{ accountCode: H.edu, debitMinor: "50000", creditMinor: "0" }, { accountCode: H.ap, debitMinor: "0", creditMinor: "50000" }],
  } as typeof financeJournals.$inferInsert));
  await scoped(T, (tx) => tx.insert(financeLedger).values([
    ledger(H.edu, 27000n, 0n), ledger(H.cash, 0n, 27000n),
    ledger(H.edu, 50000n, 0n), ledger(H.ap, 0n, 50000n),
    ledger(H.edu, 99900n, 0n, "2025-06-01"), ledger(H.cash, 0n, 99900n, "2025-06-01"),
  ]));
  await scoped(T, (tx) => tx.insert(financeBudgetAllocation).values([
    // As stored by the bill consumer: committed = the bill net, actual = 0 (nothing paid yet).
    { id: ALLOC.edu, tenantId: T, headId: H.edu, fy: "2026-27", allocatedMinor: 27000000n, committedMinor: 50000n, createdBy: MAKER, updatedBy: MAKER },
    { id: ALLOC.med, tenantId: T, headId: H.med, fy: "2026-27", allocatedMinor: 15000000n, createdBy: MAKER, updatedBy: MAKER },
  ]));
});
afterAll(async () => { await app.close(); await sqlClient.end(); });

describe("R-N1: budget allocation Expended comes from the ledger, like Budget Monitoring", () => {
  it("GET /v1/finance/budget-allocations: actual = ledger net on the head in the FY; a booked bill leaves commitment", async () => {
    const res = await get("/v1/finance/budget-allocations?fy=2026-27");
    expect(res.statusCode).toBe(200);
    const rows = (res.json() as { data: Array<Record<string, string>> }).data;
    const edu = rows.find((r) => r.id === ALLOC.edu)!;
    // expended 270 + 500 = 770 (the 2025 posting is outside the FY); committed 500 - 500 booked = 0.
    expect(edu).toMatchObject({ headCode: "2202", actualMinor: "77000", committedMinor: "0", availableMinor: String(27000000 - 77000) });
    expect(rows.find((r) => r.id === ALLOC.med)).toMatchObject({ actualMinor: "0", committedMinor: "0", availableMinor: "15000000" });
  });

  it("the allocation list and Budget Monitoring report the same figures for every head", async () => {
    const alloc = (await get("/v1/finance/budget-allocations?fy=2026-27")).json() as { data: Array<Record<string, string>> };
    const mon = (await get("/v1/finance/budget-monitoring?fy=2026-27&asOf=2026-11-03")).json() as { lines: Array<Record<string, string>> };
    for (const line of mon.lines) {
      const a = alloc.data.find((r) => r.id === line.id)!;
      expect(a).toBeDefined();
      expect({ actual: a.actualMinor, committed: a.committedMinor, available: a.availableMinor })
        .toEqual({ actual: line.actualMinor, committed: line.committedMinor, available: line.availableMinor });
    }
  });

  it("GET /v1/finance/budget-allocations/:id uses the same books-based figures", async () => {
    const res = await get(`/v1/finance/budget-allocations/${ALLOC.edu}`);
    expect(res.statusCode).toBe(200);
    expect((res.json() as { data: Record<string, string> }).data).toMatchObject({ actualMinor: "77000", committedMinor: "0" });
  });

  it("without ?fy= the list still reads each row from the books of its own FY", async () => {
    const rows = ((await get("/v1/finance/budget-allocations")).json() as { data: Array<Record<string, string>> }).data;
    expect(rows.find((r) => r.id === ALLOC.edu)).toMatchObject({ actualMinor: "77000" });
  });
});
