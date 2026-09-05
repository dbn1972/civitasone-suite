/**
 * finance-service test suite
 *
 * Test 1 — Journal balance (pure): balanced journals pass; unbalanced throw.
 * Test 2 — Budget exceeded (pure): requested > available throws DomainError.
 * Test 3 — Bill 3-way match: missing GRN -> consumer emits billMismatch (on_hold).
 * Test 4 — CQRS wiring: publish finance.bill.create -> consumer -> DB (MemoryQueue).
 * Test 5 — PFMS HoA / DDO validation (pure).
 *
 * The integration tests (3 & 4) drive the REAL bill consumer against the live
 * finance DB, so they reference seeded master data for the default tenant:
 *   tenant  00000000-0000-0000-0000-000000000001
 *   head    b98d5225-6b76-474d-8992-eef8ad032436  (code 6001, HoA 207101010101010102)
 *   ddo     DDO123456
 *   vendor  aaaaaaaa-0000-4000-8000-000000000001 / aaaaaaaa-1111-4000-8000-000000000001
 *   budget allocation for HEAD in the bill's own FY (netMinor-covering)
 * The consumer enforces UNKNOWN_HEAD / UNKNOWN_DDO / HoA-master / UNKNOWN_VENDOR
 * (added in a802eef3, "close 10 live-tested business-logic gaps ... vendors")
 * and NO_ALLOCATION_FOUND checks, so all of these must resolve or the create
 * transaction rolls back -- which is exactly what silently sank tests 3 & 4
 * (0 bill rows, no thrown error visible in the suite output) once vendorExists
 * started being enforced: this file's fixtures were never updated to seed a
 * vendor after that commit landed. Confirmed via MemoryQueue's own `dlq`
 * (UNKNOWN_VENDOR: <id> not found in vendor master for tenant) before fixing.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MemoryQueue } from "@civitasone/queue";
import { eq, and } from "drizzle-orm";
import { db, sqlClient } from "../src/shared/db.js";
import { scoped } from "./_tenant.js";
import { financeBills } from "../src/modules/payments/schema.js";
import { financeHeads } from "../src/modules/budget/schema.js";
import { financeDdo, financeVendors } from "../src/modules/masters/schema.js";
import { financeBudgetAllocation } from "../src/modules/budget/allocation-schema.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { registerPaymentsConsumers } from "../src/modules/payments/consumer.js";
import { assertJournalBalances } from "../src/modules/gl/domain.js";
import { assertBudgetNotExceeded, availableBalance, assertValidPfmsHoA } from "../src/modules/budget/domain.js";
import { assertValidDdoCode } from "../src/shared/pfms.js";
import { fyFromDate } from "../src/modules/hoa/voucher.js";
import { EVENTS } from "../src/topics.js";

const ACTOR  = "00000000-aaaa-4000-8000-000000000001";
// Real seeded tenant + head so the consumer master checks pass.
const TENANT  = "00000000-0000-0000-0000-000000000001";
const HEAD    = "b98d5225-6b76-474d-8992-eef8ad032436";
const DDO     = "DDO123456";
const VENDOR_1 = "aaaaaaaa-0000-4000-8000-000000000001";
const VENDOR_2 = "aaaaaaaa-1111-4000-8000-000000000001";
const ALLOC_ID = "b98d5225-a110-4000-8000-000000000001";
// The billCreate consumer derives the allocation FY from the bill's OWN date
// (defaulting to today when unset, as both payloads below do), so the seeded
// allocation must be for that same FY or NO_ALLOCATION_FOUND fires instead.
const BILL_FY = fyFromDate(new Date().toISOString().slice(0, 10));
const BILL_1 = "22222222-bbbb-4000-8000-000000000001";
const BILL_2 = "33333333-cccc-4000-8000-000000000002";
const MSG_1  = "44444444-dddd-4000-8000-000000000001";
const MSG_2  = "55555555-eeee-4000-8000-000000000002";
const CORR_1 = "corr-mismatch-1";
const CORR_2 = "corr-bill-happy-1";

async function wipe(billId: string, msgId: string, correlationId: string) {
  await scoped(TENANT, (tx) => tx.delete(outboxMessages).where(eq(outboxMessages.correlationId, correlationId)));
  await scoped(TENANT, (tx) => tx.delete(financeBills).where(eq(financeBills.id, billId)));
  await db.delete(processed).where(eq(processed.messageId, msgId));
}

// helper: pump the memory queue until a predicate holds (or timeout).
async function waitFor(fn: () => Promise<boolean>, ms = 3000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
}

// Provision the master fixtures the bill consumer validates against: a head with
// a valid 18-digit HoA whose major head (2071) is in the major-head master, the
// DDO, both vendors the two integration tests bill against, and a budget
// allocation for HEAD in the bill's own FY. Scoped to the tenant so the RLS
// WITH CHECK passes; idempotent (re-runnable without manual cleanup).
beforeAll(async () => {
  await scoped(TENANT, (tx) => tx.insert(financeHeads).values({
    id: HEAD, tenantId: TENANT, code: "BILL-TEST-HEAD", name: "Bill Test Head",
    level: 1, classification: "expenditure", hoaCode: "207101010101010101",
    createdBy: ACTOR, updatedBy: ACTOR,
  }).onConflictDoNothing());
  await scoped(TENANT, (tx) => tx.insert(financeDdo).values({
    tenantId: TENANT, ddoCode: DDO, name: "Bill Test DDO", createdBy: ACTOR, updatedBy: ACTOR,
  }).onConflictDoNothing());
  // finance_vendors has a UNIQUE(tenant_id, pan) constraint -- each seeded
  // vendor needs its own PAN or the second onConflictDoNothing() insert
  // silently no-ops on the PAN collision (not the id), leaving VENDOR_2
  // missing and UNKNOWN_VENDOR still firing for the second bill.
  const vendorSeeds: Array<[string, string]> = [[VENDOR_1, "ABCDE1234F"], [VENDOR_2, "ABCDE5678K"]];
  for (const [vendorId, pan] of vendorSeeds) {
    await scoped(TENANT, (tx) => tx.insert(financeVendors).values({
      id: vendorId, tenantId: TENANT, name: `Bill Test Vendor ${vendorId.slice(-4)}`,
      category: "supplies", pan, address: "1 Test Road",
      bankName: "Test Bank", bankAccountNo: "000111222333", ifsc: "TEST0001234",
      createdBy: ACTOR, updatedBy: ACTOR,
    }).onConflictDoNothing());
  }
  // Delete-then-insert (rather than onConflictDoNothing) so committedMinor
  // always starts at 0 for this run -- the billCreate consumer mutates it via
  // addCommittedGuarded, and a stale committed balance from a prior run could
  // eventually make a re-run fail OVER_APPROPRIATION against a fixed allocatedMinor.
  await scoped(TENANT, (tx) => tx.delete(financeBudgetAllocation).where(
    and(eq(financeBudgetAllocation.tenantId, TENANT), eq(financeBudgetAllocation.headId, HEAD), eq(financeBudgetAllocation.fy, BILL_FY)),
  ));
  await scoped(TENANT, (tx) => tx.insert(financeBudgetAllocation).values({
    id: ALLOC_ID, tenantId: TENANT, headId: HEAD, fy: BILL_FY,
    allocatedMinor: 100000000n, committedMinor: 0n, actualMinor: 0n,
    createdBy: ACTOR, updatedBy: ACTOR,
  }));
});

// 1. Journal balance — pure ----------------------------------------------------

describe("GL domain — journal balance (pure)", () => {
  it("balanced journal passes", () => {
    expect(() =>
      assertJournalBalances([
        { accountCode: "0001", debitMinor: 50000, creditMinor: 0 },
        { accountCode: "0002", debitMinor: 0,     creditMinor: 50000 },
      ])
    ).not.toThrow();
  });

  it("unbalanced journal throws JOURNAL_UNBALANCED", () => {
    expect(() =>
      assertJournalBalances([
        { accountCode: "0001", debitMinor: 60000, creditMinor: 0 },
        { accountCode: "0002", debitMinor: 0,     creditMinor: 50000 },
      ])
    ).toThrowError("unbalanced");
  });

  it("single line throws JOURNAL_TOO_FEW_LINES", () => {
    expect(() =>
      assertJournalBalances([{ accountCode: "0001", debitMinor: 100, creditMinor: 100 }])
    ).toThrowError("at least 2 lines");
  });
});

// 2. Budget exceeded — pure ----------------------------------------------------

describe("Budget domain — exceeded check (pure)", () => {
  it("within budget passes", () => {
    const avail = availableBalance({ reMinor: 100000n, utilisedMinor: 40000n });
    expect(() => assertBudgetNotExceeded(avail, 50000n)).not.toThrow();
  });

  it("exactly at limit passes", () => {
    const avail = availableBalance({ reMinor: 100000n, utilisedMinor: 40000n });
    expect(() => assertBudgetNotExceeded(avail, 60000n)).not.toThrow();
  });

  it("exceeds budget throws BUDGET_EXCEEDED", () => {
    const avail = availableBalance({ reMinor: 100000n, utilisedMinor: 40000n });
    expect(() => assertBudgetNotExceeded(avail, 70000n)).toThrowError("BUDGET_EXCEEDED");
  });
});

// 3. Bill 3-way match — missing GRN -> mismatch event + on_hold ----------------

describe("Bill consumer — 3-way match (integration)", () => {
  beforeAll(async () => { await wipe(BILL_1, MSG_1, CORR_1); });
  afterAll(async () => { await wipe(BILL_1, MSG_1, CORR_1); });

  it("missing grn_ref causes finance.bill.mismatch and bill on_hold", async () => {
    const q = new MemoryQueue();
    registerPaymentsConsumers(q);
    await q.start();

    await q.publish("finance.bill.create", {
      messageId: MSG_1,
      type: "finance.bill.create",
      tenantId: TENANT,
      actorId: ACTOR,
      correlationId: "corr-mismatch-1",
      schemaVersion: "1.0",
      payload: {
        id: BILL_1,
        tenantId: TENANT,
        billNo: "BILL-3WM-001",
        vendorId: VENDOR_1,
        headId:   HEAD,
        ddoCode:  DDO,
        grossMinor: 50000,
        currency: "INR",
        deductions: [],
        netMinor: 50000,
        poRef: "procurement_po:cccccccc-0000-4000-8000-000000000001",
        // grnRef intentionally omitted -> triggers mismatch
      },
    });

    await waitFor(async () =>
      (await scoped(TENANT, (tx) => tx.select().from(financeBills).where(eq(financeBills.id, BILL_1)))).length === 1);
    await q.stop();

    const rows = await scoped(TENANT, (tx) => tx.select().from(financeBills).where(eq(financeBills.id, BILL_1)));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("on_hold");

    const outbox = await scoped(TENANT, (tx) => tx.select().from(outboxMessages).where(eq(outboxMessages.correlationId, CORR_1)));
    const eventTypes = outbox.map((r) => r.eventType);
    expect(eventTypes).toContain(EVENTS.billMismatch);
    expect(eventTypes).not.toContain(EVENTS.billPassed);
  });
});

// 4. CQRS wiring — happy path bill ---------------------------------------------

describe("Bill consumer — CQRS wiring (integration)", () => {
  beforeAll(async () => { await wipe(BILL_2, MSG_2, CORR_2); });
  afterAll(async () => { await wipe(BILL_2, MSG_2, CORR_2); });

  it("happy path: bill with po_ref + grn_ref inserts row and records _inbox.processed", async () => {
    const q = new MemoryQueue();
    registerPaymentsConsumers(q);
    await q.start();

    await q.publish("finance.bill.create", {
      messageId: MSG_2,
      type: "finance.bill.create",
      tenantId: TENANT,
      actorId: ACTOR,
      correlationId: "corr-bill-happy-1",
      schemaVersion: "1.0",
      payload: {
        id: BILL_2,
        tenantId: TENANT,
        billNo: "BILL-HAPPY-001",
        vendorId: VENDOR_2,
        headId:   HEAD,
        ddoCode:  DDO,
        grossMinor: 75000,
        currency: "INR",
        deductions: [{ type: "tds", amountMinor: 7500 }],
        netMinor: 67500,
        poRef:  "procurement_po:dddddddd-1111-4000-8000-000000000001",
        grnRef: "procurement_grn:eeeeeeee-1111-4000-8000-000000000001",
      },
    });

    await waitFor(async () =>
      (await db.select().from(processed).where(eq(processed.messageId, MSG_2))).length === 1);
    await q.stop();

    const bills = await scoped(TENANT, (tx) => tx.select().from(financeBills).where(eq(financeBills.id, BILL_2)));
    expect(bills).toHaveLength(1);
    // billNo is reassigned by the gapless allocator (BILL/<fy>/NNNN), not the caller value.
    expect(bills[0]?.billNo).toMatch(/^BILL\//);
    expect(bills[0]?.status).toBe("pending");
    expect(bills[0]?.netMinor).toBe(67500n);

    const seen = await db.select().from(processed).where(eq(processed.messageId, MSG_2));
    expect(seen).toHaveLength(1);

    const outbox = await scoped(TENANT, (tx) => tx.select().from(outboxMessages).where(eq(outboxMessages.correlationId, CORR_2)));
    const eventTypes = outbox.map((r) => r.eventType);
    expect(eventTypes).toContain("audit.event.record");
    expect(eventTypes).not.toContain(EVENTS.billMismatch);
  });
});

// 5. PFMS HoA / DDO validation (pure) ------------------------------------------

describe("PFMS domain — HoA and DDO validation (pure)", () => {
  it("valid 18-digit HoA passes", () => {
    expect(() => assertValidPfmsHoA("207101010101010101")).not.toThrow();
  });

  it("invalid HoA throws INVALID_HOA_CODE", () => {
    expect(() => assertValidPfmsHoA("6002")).toThrowError("INVALID_HOA_CODE");
    expect(() => assertValidPfmsHoA("20710101010101010")).toThrowError("INVALID_HOA_CODE");
  });

  it("valid DDO code passes", () => {
    expect(() => assertValidDdoCode("DDO123456")).not.toThrow();
  });

  it("invalid DDO code throws INVALID_DDO_CODE", () => {
    expect(() => assertValidDdoCode("AB")).toThrowError("INVALID_DDO_CODE");
  });
});

import { afterAll as _afterAllFinal } from "vitest";
_afterAllFinal(async () => { await sqlClient.end(); });
