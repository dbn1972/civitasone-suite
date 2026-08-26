/**
 * masters/routes.ts — GET /v1/finance/vendors/:id bill-history rollup.
 *
 * Proves the vendor<->bills join the frontend's Total Bills/Total Paid/TDS
 * Deducted stat cards and Bill History table need (finance/vendors/[id]),
 * which was permanently empty because neither the mapper nor the schema
 * carried a `bills` field. Seeds one vendor with two real bills (one
 * carrying a TDS deduction) directly via the payments.finance_bills table
 * and asserts the rollup the route now returns.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { eq } from "drizzle-orm";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { scoped } from "./_tenant.js";
import { financeVendors } from "../src/modules/masters/schema.js";
import { financeBills } from "../src/modules/payments/schema.js";
import { financeHeads } from "../src/modules/budget/schema.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-0000000000fb";
const ACTOR = "00000000-aaaa-4000-8000-0000000000fb";
const VENDOR = "55555555-aaaa-4000-8000-0000000000fb";
const HEAD = "55555555-bbbb-4000-8000-0000000000fb";
const BILL_WITH_TDS = "55555555-cccc-4000-8000-0000000000f1";
const BILL_NO_TDS = "55555555-cccc-4000-8000-0000000000f2";

function token(roles: string[]) {
  return signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-vendor-bills" }, SECRET);
}
const financeAdmin = () => ({ authorization: `Bearer ${token(["finance_admin"])}` });

async function cleanup() {
  await scoped(TENANT, (tx) => tx.delete(financeBills).where(eq(financeBills.vendorId, VENDOR)));
  await scoped(TENANT, (tx) => tx.delete(financeVendors).where(eq(financeVendors.id, VENDOR)));
  await scoped(TENANT, (tx) => tx.delete(financeHeads).where(eq(financeHeads.id, HEAD)));
}

beforeAll(async () => {
  await cleanup();
  // finance_bills.head_id carries a real FK to budget.finance_heads(id)
  // (migration 0055) -- seed a row there too so the bill inserts below
  // don't violate it.
  await scoped(TENANT, (tx) => tx.insert(financeHeads).values({
    id: HEAD, tenantId: TENANT, code: "5100-ROLLUP", name: "Rollup Test Expense Head", level: 2,
    createdBy: ACTOR, updatedBy: ACTOR,
  }));
  await scoped(TENANT, (tx) => tx.insert(financeVendors).values({
    id: VENDOR, tenantId: TENANT, name: "M/s Test Rollup Vendor", category: "supplies",
    pan: "ABCDE1234F", address: "1 Test Road", bankName: "Test Bank",
    bankAccountNo: "000111222333", ifsc: "TEST0001234",
    createdBy: ACTOR, updatedBy: ACTOR,
  }));
  await scoped(TENANT, (tx) => tx.insert(financeBills).values({
    id: BILL_WITH_TDS, tenantId: TENANT, billNo: "BILL/ROLLUP/001", vendorId: VENDOR, headId: HEAD,
    grossMinor: 110000n, netMinor: 100000n,
    deductions: [{ type: "tds", amountMinor: 10000, description: "TDS @ 10%" }],
    status: "paid", createdBy: ACTOR, updatedBy: ACTOR,
  }));
  await scoped(TENANT, (tx) => tx.insert(financeBills).values({
    id: BILL_NO_TDS, tenantId: TENANT, billNo: "BILL/ROLLUP/002", vendorId: VENDOR, headId: HEAD,
    grossMinor: 50000n, netMinor: 50000n, deductions: [],
    status: "pending", createdBy: ACTOR, updatedBy: ACTOR,
  }));
});
afterAll(async () => { await cleanup(); await sqlClient.end(); });

describe("GET /v1/finance/vendors/:id — bill-history rollup", () => {
  it("returns a bills array with both seeded bills, amounts, and the extracted TDS", async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: "GET", url: `/v1/finance/vendors/${VENDOR}`, headers: financeAdmin(),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(Array.isArray(body.bills)).toBe(true);
      expect(body.bills.length).toBe(2);

      const withTds = body.bills.find((b: any) => b.id === BILL_WITH_TDS);
      expect(withTds).toBeDefined();
      expect(withTds.billNo).toBe("BILL/ROLLUP/001");
      expect(withTds.amount).toBe("100000");
      expect(withTds.tds).toBe("10000");
      expect(withTds.status).toBe("paid");

      const noTds = body.bills.find((b: any) => b.id === BILL_NO_TDS);
      expect(noTds).toBeDefined();
      expect(noTds.amount).toBe("50000");
      expect(noTds.tds).toBe("0");

      // The frontend derives Total Bills/Total Paid/TDS Deducted stat cards
      // client-side from this same array -- prove the numbers it would land
      // on are the right ones.
      const totalPaidMinor = body.bills.reduce((s: bigint, b: any) => s + BigInt(b.amount), 0n);
      const totalTdsMinor = body.bills.reduce((s: bigint, b: any) => s + BigInt(b.tds), 0n);
      expect(totalPaidMinor).toBe(150000n);
      expect(totalTdsMinor).toBe(10000n);
    } finally {
      await app.close();
    }
  });

  it("a vendor with no bills gets an empty (not missing) bills array", async () => {
    const OTHER_VENDOR = "55555555-aaaa-4000-8000-0000000000f0";
    await scoped(TENANT, (tx) => tx.insert(financeVendors).values({
      id: OTHER_VENDOR, tenantId: TENANT, name: "M/s No Bills Yet", category: "supplies",
      pan: "ZYXWV9876G", address: "2 Test Road", bankName: "Test Bank",
      bankAccountNo: "999888777666", ifsc: "TEST0009999",
      createdBy: ACTOR, updatedBy: ACTOR,
    }));
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: "GET", url: `/v1/finance/vendors/${OTHER_VENDOR}`, headers: financeAdmin(),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().bills).toEqual([]);
    } finally {
      await app.close();
      await scoped(TENANT, (tx) => tx.delete(financeVendors).where(eq(financeVendors.id, OTHER_VENDOR)));
    }
  });
});
