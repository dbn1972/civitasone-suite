import { pgSchema, uuid, varchar, bigint, numeric, date, timestamp } from "drizzle-orm/pg-core";
import { and, eq, inArray, sql } from "drizzle-orm";
import { scopedRead } from "../../shared/db.js";

// gl.finance_vendor_tds (migration 0009_world_class_finance.sql) -- the real
// TDS ledger, written by tds/consumer.ts's tdsDeductionRecord handler (via
// POST /v1/finance/vendor-tds) and previously only read by tds/routes.ts's
// raw-SQL GET handlers. Modelled here as a proper drizzle table (rather than
// more raw SQL) so reads elsewhere -- like the vendor bill-history rollup
// below -- get the same inArray/groupBy safety as every other repo in this
// service instead of hand-rolled array-parameter binding.
const glSchema = pgSchema("gl");
export const financeVendorTds = glSchema.table("finance_vendor_tds", {
  id:               uuid("id").primaryKey().defaultRandom(),
  tenantId:         uuid("tenant_id").notNull(),
  vendorId:         uuid("vendor_id").notNull(),
  vendorName:       varchar("vendor_name", { length: 256 }),
  pan:              varchar("pan", { length: 10 }),
  billId:           uuid("bill_id"),
  paymentId:        uuid("payment_id"),
  section:          varchar("section", { length: 10 }).notNull().default("194C"),
  grossAmountMinor: bigint("gross_amount_minor", { mode: "bigint" }).notNull(),
  tdsRatePct:       numeric("tds_rate_pct", { precision: 5, scale: 2 }).notNull().default("2.00"),
  tdsAmountMinor:   bigint("tds_amount_minor", { mode: "bigint" }).notNull(),
  surchargeMinor:   bigint("surcharge_minor", { mode: "bigint" }).notNull().default(0n),
  cessMinor:        bigint("cess_minor", { mode: "bigint" }).notNull().default(0n),
  netPaymentMinor:  bigint("net_payment_minor", { mode: "bigint" }).notNull(),
  deductionDate:    date("deduction_date").notNull(),
  depositDate:      date("deposit_date"),
  challanNo:        varchar("challan_no", { length: 64 }),
  quarter:          varchar("quarter", { length: 2 }).notNull(),
  fy:               varchar("fy", { length: 7 }).notNull(),
  status:           varchar("status", { length: 16 }).notNull().default("deducted"),
  createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type BillTdsAmount = { billId: string; tdsAmountMinor: bigint };

/**
 * Sum of TDS actually withheld per bill, from gl.finance_vendor_tds -- the
 * real TDS ledger. bill_id is nullable on this table (a deduction can be
 * tied only to a payment_id, not a bill), and a single bill can accumulate
 * more than one deduction row (e.g. a correction), so this groups and sums
 * per bill_id rather than assuming a 1:1 row. A bill with no matching row is
 * simply absent from the result -- callers should default its TDS to 0.
 *
 * NOT sourced from finance_bills.deductions: the only real bill-creation
 * path (integrations/consumer.ts's grnAccepted handler) hardcodes
 * deductions: [], and none of payments/consumer.ts's three updateBill()
 * call sites ever populate it either -- that jsonb column is written by
 * nothing in production, so reading TDS out of it always returns zero.
 */
export async function findTdsAmountsByBillIds(tenantId: string, billIds: string[]): Promise<BillTdsAmount[]> {
  if (billIds.length === 0) return [];
  const rows = await scopedRead((tx) => tx
    .select({
      billId: financeVendorTds.billId,
      tdsAmountMinor: sql<string>`sum(${financeVendorTds.tdsAmountMinor})`,
    })
    .from(financeVendorTds)
    .where(and(eq(financeVendorTds.tenantId, tenantId), inArray(financeVendorTds.billId, billIds)))
    .groupBy(financeVendorTds.billId));
  return rows
    .filter((r): r is { billId: string; tdsAmountMinor: string } => r.billId !== null)
    .map((r) => ({ billId: r.billId, tdsAmountMinor: BigInt(r.tdsAmountMinor) }));
}
