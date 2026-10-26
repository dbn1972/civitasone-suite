/**
 * V4-B-08: GET /v1/finance/statements/receipts-payments must carry the opening balance (cash/bank balance
 * before the FY start) so that closing_balance = opening_balance + total_receipts - total_payments.
 * It used to report only the FY-window net movement as "closing_balance". Real DB; minor-unit (paise) values.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { scoped } from "./_tenant.js";
import { bearer } from "./_fp02.js";

const T = randomUUID();
const OTHER = randomUUID();
const ACTOR = "00000000-0f02-4000-8000-000000000053";
let app: Awaited<ReturnType<typeof buildApp>>;

const get = (fy: string, tenant = T) =>
  app.inject({ method: "GET", url: `/v1/finance/statements/receipts-payments?fy=${fy}`, headers: bearer(tenant, ACTOR, ["finance_officer"]) });
type Row = { bank_or_cash: string; opening_balance: string | number; total_receipts: string | number; total_payments: string | number; closing_balance: string | number };
const by = (rows: Row[]) => Object.fromEntries(rows.map((r) => [r.bank_or_cash, r]));
const nums = (r: Row) => [r.opening_balance, r.total_receipts, r.total_payments, r.closing_balance].map(String);

beforeAll(async () => {
  app = await buildApp();
  await scoped(T, (tx) => tx.execute(sql`
    INSERT INTO gl.finance_cash_book (tenant_id, entry_date, voucher_type, voucher_no, particulars, receipt_minor, payment_minor, balance_minor, bank_or_cash)
    VALUES (${T}::uuid, '2025-06-01', 'receipt', 'P-1', 'prior cash in', 1000, 0, 0, 'cash'),
           (${T}::uuid, '2026-03-31', 'payment', 'P-2', 'prior cash out', 0, 200, 0, 'cash'),
           (${T}::uuid, '2026-02-10', 'receipt', 'P-3', 'prior bank in', 500, 0, 0, 'bank'),
           (${T}::uuid, '2026-04-01', 'receipt', 'F-1', 'fy cash in', 300, 0, 0, 'cash'),
           (${T}::uuid, '2026-09-15', 'payment', 'F-2', 'fy cash out', 0, 100, 0, 'cash'),
           (${T}::uuid, '2027-03-31', 'payment', 'F-3', 'fy bank out', 0, 50, 0, 'bank'),
           (${T}::uuid, '2027-04-01', 'receipt', 'N-1', 'next FY, excluded from 2026-27', 7, 0, 0, 'cash')`));
  await scoped(OTHER, (tx) => tx.execute(sql`
    INSERT INTO gl.finance_cash_book (tenant_id, entry_date, voucher_type, voucher_no, particulars, receipt_minor, payment_minor, balance_minor, bank_or_cash)
    VALUES (${OTHER}::uuid, '2025-06-01', 'receipt', 'X-1', 'other tenant', 99999, 0, 0, 'cash')`));
});
afterAll(async () => { await app.close(); await sqlClient.end(); });

describe("GET /v1/finance/statements/receipts-payments opening balance", () => {
  it("closing = opening (prior FY) + receipts - payments, per cash/bank, tenant-scoped", async () => {
    const r = await get("2026-27");
    expect(r.statusCode).toBe(200);
    const d = by(r.json().data as Row[]);
    expect(nums(d.cash!)).toEqual(["800", "300", "100", "1000"]);
    expect(nums(d.bank!)).toEqual(["500", "0", "50", "450"]);
  });
  it("a later FY opens with the prior FY closing balance (and a bank with no FY movement still appears)", async () => {
    const r = await get("2027-28");
    const d = by(r.json().data as Row[]);
    // N-1 (7) falls in the 2027-28 window; cash opens at the 2026-27 close (1000); bank has no FY movement
    expect(nums(d.cash!)).toEqual(["1000", "7", "0", "1007"]);
    expect(nums(d.bank!)).toEqual(["450", "0", "0", "450"]);
  });
});
