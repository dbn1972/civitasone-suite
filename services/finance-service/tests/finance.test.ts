/**
 * finance-service test suite
 *
 * Test 1 — Journal balance (pure): balanced journals pass; unbalanced throw.
 * Test 2 — Budget exceeded (pure): requested > available throws DomainError.
 * Test 3 — Bill 3-way match: missing GRN → consumer emits billMismatch not bill.create.
 * Test 4 — CQRS wiring: POST /finance/bills → queue → consumer → DB (MemoryQueue + MemoryCache).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MemoryQueue } from "@civitasone/queue";
import { eq } from "drizzle-orm";
import { db, sqlClient } from "../src/shared/db.js";
import { financeBills } from "../src/modules/payments/schema.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { registerPaymentsConsumers } from "../src/modules/payments/consumer.js";
import { assertJournalBalances } from "../src/modules/gl/domain.js";
import { assertBudgetNotExceeded, availableBalance, assertValidPfmsHoA } from "../src/modules/budget/domain.js";
import { assertValidDdoCode } from "../src/shared/pfms.js";
import { EVENTS } from "../src/topics.js";

const ACTOR  = "00000000-aaaa-4000-8000-000000000001";
const TENANT = "11111111-aaaa-4000-8000-000000000001";
const BILL_1 = "22222222-bbbb-4000-8000-000000000001";
const BILL_2 = "33333333-cccc-4000-8000-000000000002";
const MSG_1  = "44444444-dddd-4000-8000-000000000001";
const MSG_2  = "55555555-eeee-4000-8000-000000000002";

async function wipe(billId: string, msgId: string) {
  await db.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
  await db.delete(financeBills).where(eq(financeBills.id, billId));
  await db.delete(processed).where(eq(processed.messageId, msgId));
}

// ── 1. Journal balance — pure ──────────────────────────────────────────────

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

// ── 2. Budget exceeded — pure ──────────────────────────────────────────────

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

// ── 3. Bill 3-way match — missing GRN → mismatch event ───────────────────

describe("Bill consumer — 3-way match (integration)", () => {
  beforeAll(async () => {
    await wipe(BILL_1, MSG_1);
  });
  afterAll(async () => {
    await wipe(BILL_1, MSG_1);
  });

  it("missing grn_ref causes finance.bill.mismatch in outbox", async () => {
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
        vendorId: "aaaaaaaa-0000-4000-8000-000000000001",
        headId:   "bbbbbbbb-0000-4000-8000-000000000001",
        ddoCode:  "DDO123456",
        grossMinor: 50000,
        currency: "INR",
        deductions: [],
        netMinor: 50000,
        poRef: "procurement_po:cccccccc-0000-4000-8000-000000000001",
        // grnRef intentionally omitted → triggers mismatch
      },
    });

    await new Promise<void>((r) => setTimeout(r, 500));
    await q.stop();

    const rows = await db.select().from(financeBills).where(eq(financeBills.id, BILL_1));
    expect(rows).toHaveLength(1);

    const outbox = await db.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
    const eventTypes = outbox.map((r) => r.eventType);
    expect(eventTypes).toContain(EVENTS.billMismatch);
    expect(eventTypes).not.toContain(EVENTS.billPassed);
  });
});

// ── 4. CQRS wiring — happy path bill ─────────────────────────────────────

describe("Bill consumer — CQRS wiring (integration)", () => {
  beforeAll(async () => {
    await wipe(BILL_2, MSG_2);
  });
  afterAll(async () => {
    await wipe(BILL_2, MSG_2);
    await sqlClient.end();
  });

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
        vendorId: "aaaaaaaa-1111-4000-8000-000000000001",
        headId:   "bbbbbbbb-1111-4000-8000-000000000001",
        ddoCode:  "DDO123456",
        grossMinor: 75000,
        currency: "INR",
        deductions: [{ type: "tds", amountMinor: 7500 }],
        netMinor: 67500,
        poRef:  "procurement_po:dddddddd-1111-4000-8000-000000000001",
        grnRef: "procurement_grn:eeeeeeee-1111-4000-8000-000000000001",
      },
    });

    await new Promise<void>((r) => setTimeout(r, 500));
    await q.stop();

    const bills = await db.select().from(financeBills).where(eq(financeBills.id, BILL_2));
    expect(bills).toHaveLength(1);
    expect(bills[0]?.billNo).toBe("BILL-HAPPY-001");
    expect(bills[0]?.status).toBe("pending");
    expect(bills[0]?.netMinor).toBe(67500n);

    const seen = await db.select().from(processed).where(eq(processed.messageId, MSG_2));
    expect(seen).toHaveLength(1);

    const outbox = await db.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
    const eventTypes = outbox.map((r) => r.eventType);
    expect(eventTypes).toContain("audit.event.record");
    expect(eventTypes).not.toContain(EVENTS.billMismatch);
  });
});

// ── 5. PFMS HoA / DDO validation (pure) ──────────────────────────

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
