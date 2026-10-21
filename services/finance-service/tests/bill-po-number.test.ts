/**
 * GAP-FINANCE-EXPENDITURE-BILLS-06 -- a bill carries the human PO number procurement sent with the GRN, next to the
 * opaque po_ref, so the Bills register can show "PO-2026-014" instead of a shortened id.
 *
 *   - normalisePoNumber (pure): only a real string survives; a missing / blank / stringified-undefined value is null.
 *   - the billCreate consumer stores the number on the bill (real Postgres, migration 0153) and stores NULL when none is sent
 *     or when it is a stringified missing value.
 *   - GET /v1/finance/bills and GET /v1/finance/bills/:id return poNumber (and omit it for a bill that has none).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { MemoryQueue } from "@civitasone/queue";
import { eq, and } from "drizzle-orm";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { scoped } from "./_tenant.js";
import { financeBills } from "../src/modules/payments/schema.js";
import { financeHeads } from "../src/modules/budget/schema.js";
import { financeDdo, financeVendors } from "../src/modules/masters/schema.js";
import { financeBudgetAllocation } from "../src/modules/budget/allocation-schema.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { registerPaymentsConsumers } from "../src/modules/payments/consumer.js";
import { normalisePoNumber, PO_NUMBER_MAX_LENGTH } from "../src/modules/payments/domain.js";
import { fyFromDate } from "../src/modules/hoa/voucher.js";
import { COMMANDS } from "../src/topics.js";

// vitest.config.ts injects JWT_SECRET for the suite; no literal secret here (CI gitleaks scans every commit).
const SECRET = process.env.JWT_SECRET as string;
const TENANT = "aaaaaaaa-1111-4000-8000-00000000f306";
const ACTOR = "00000000-aaaa-4000-8000-00000000f306";
const HEAD = "f3060000-bbbb-4000-8000-000000000001";
const VENDOR = "f3060000-aaaa-4000-8000-000000000001";
const DDO = "DDO306001";
const FY = fyFromDate(new Date().toISOString().slice(0, 10));
const PO_UUID = "5b1c2d3e-0000-4000-8000-000000000306";
const CORR = "corr-f306-po-number";

const CASES = [
  { id: "f3060000-cccc-4000-8000-000000000001", msg: "f3060000-dddd-4000-8000-000000000001", poNumber: "PO-2026-014" as string | undefined, expected: "PO-2026-014" as string | null },
  { id: "f3060000-cccc-4000-8000-000000000002", msg: "f3060000-dddd-4000-8000-000000000002", poNumber: undefined, expected: null },
  { id: "f3060000-cccc-4000-8000-000000000003", msg: "f3060000-dddd-4000-8000-000000000003", poNumber: "undefined", expected: null },
] as const;

const token = (roles: string[]) => signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-f306" }, SECRET);

async function clean() {
  await scoped(TENANT, (tx) => tx.delete(outboxMessages).where(eq(outboxMessages.correlationId, CORR)));
  for (const c of CASES) {
    await db.delete(processed).where(eq(processed.messageId, c.msg));
    await scoped(TENANT, (tx) => tx.delete(financeBills).where(eq(financeBills.id, c.id)));
  }
}

describe("normalisePoNumber (pure)", () => {
  it("keeps a real number, trimmed", () => {
    expect(normalisePoNumber("PO-2026-014")).toBe("PO-2026-014");
    expect(normalisePoNumber("  PO-2026-014  ")).toBe("PO-2026-014");
  });
  it("returns null for anything that is not a real value", () => {
    for (const v of [undefined, null, "", "   ", "undefined", "null", 42, {}, []]) expect(normalisePoNumber(v)).toBeNull();
  });
  it("bounds the stored length", () => {
    expect(normalisePoNumber("P".repeat(PO_NUMBER_MAX_LENGTH + 20))).toHaveLength(PO_NUMBER_MAX_LENGTH);
  });
});

describe("PO number on the bill (real DB)", () => {
  beforeAll(async () => {
    await clean();
    await scoped(TENANT, (tx) => tx.insert(financeHeads).values({
      id: HEAD, tenantId: TENANT, code: "PO-NUM-HEAD", name: "PO number head", level: 1, classification: "expenditure",
      hoaCode: "207101010101010101", createdBy: ACTOR, updatedBy: ACTOR,
    }).onConflictDoNothing());
    await scoped(TENANT, (tx) => tx.insert(financeDdo).values({
      tenantId: TENANT, ddoCode: DDO, name: "PO number DDO", createdBy: ACTOR, updatedBy: ACTOR,
    }).onConflictDoNothing());
    await scoped(TENANT, (tx) => tx.insert(financeVendors).values({
      id: VENDOR, tenantId: TENANT, name: "PO Number Vendor", category: "supplies", pan: "ABCDE3060F", address: "1 Test Road",
      bankName: "Test Bank", bankAccountNo: "000111222333", ifsc: "TEST0001234", createdBy: ACTOR, updatedBy: ACTOR,
    }).onConflictDoNothing());
    await scoped(TENANT, (tx) => tx.delete(financeBudgetAllocation).where(
      and(eq(financeBudgetAllocation.tenantId, TENANT), eq(financeBudgetAllocation.headId, HEAD), eq(financeBudgetAllocation.fy, FY)),
    ));
    await scoped(TENANT, (tx) => tx.insert(financeBudgetAllocation).values({
      id: "f3060000-a110-4000-8000-000000000001", tenantId: TENANT, headId: HEAD, fy: FY,
      allocatedMinor: 100000000n, committedMinor: 0n, actualMinor: 0n, createdBy: ACTOR, updatedBy: ACTOR,
    }));

    const q = new MemoryQueue({ maxAttempts: 1 });
    registerPaymentsConsumers(q);
    await q.start();
    for (const c of CASES) {
      await q.publish(COMMANDS.billCreate, {
        messageId: c.msg, type: COMMANDS.billCreate, tenantId: TENANT, actorId: ACTOR, correlationId: CORR, schemaVersion: "1.0",
        payload: {
          id: c.id, tenantId: TENANT, billNo: "ignored", vendorId: VENDOR, headId: HEAD, ddoCode: DDO,
          grossMinor: "75000", currency: "INR", deductions: [], netMinor: "75000",
          poRef: `procurement_po:${PO_UUID}`, grnRef: "procurement_grn:eeeeeeee-1111-4000-8000-000000000306",
          ...(c.poNumber !== undefined ? { poNumber: c.poNumber } : {}),
        },
      });
    }
    await q.drain();
    await q.stop();
    expect(q.dlq).toHaveLength(0);
  });
  afterAll(async () => { await clean(); await sqlClient.end(); });

  it("the billCreate consumer stores the PO number, and NULL when none (or a stringified missing value) is sent", async () => {
    for (const c of CASES) {
      const rows = await scoped(TENANT, (tx) => tx.select().from(financeBills).where(eq(financeBills.id, c.id)));
      expect(rows, c.id).toHaveLength(1);
      expect(rows[0]?.poNumber, c.id).toBe(c.expected);
      // the opaque link is untouched
      expect(rows[0]?.poRef).toBe(`procurement_po:${PO_UUID}`);
    }
  });

  it("GET /v1/finance/bills returns poNumber next to poRef, and omits it where there is none", async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({ method: "GET", url: "/v1/finance/bills?limit=50", headers: { authorization: `Bearer ${token(["finance_officer"])}` } });
      expect(res.statusCode).toBe(200);
      const byId = new Map((res.json() as Array<{ id: string; poRef?: string; poNumber?: string }>).map((b) => [b.id, b]));
      expect(byId.get(CASES[0].id)?.poNumber).toBe("PO-2026-014");
      expect(byId.get(CASES[0].id)?.poRef).toBe(`procurement_po:${PO_UUID}`);
      expect(byId.get(CASES[1].id)).toBeDefined();
      expect(byId.get(CASES[1].id)?.poNumber).toBeUndefined();
      expect(byId.get(CASES[2].id)?.poNumber).toBeUndefined();
    } finally { await app.close(); }
  });

  it("GET /v1/finance/bills/:id returns poNumber", async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({ method: "GET", url: `/v1/finance/bills/${CASES[0].id}`, headers: { authorization: `Bearer ${token(["finance_officer"])}` } });
      expect(res.statusCode).toBe(200);
      expect(res.json().poNumber).toBe("PO-2026-014");
    } finally { await app.close(); }
  });
});
