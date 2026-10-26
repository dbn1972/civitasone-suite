/**
 * V4-B-11: GET /v1/finance/statements/cash-flow must list months in financial-year order (Apr..Mar),
 * not calendar order (1..12), which put Jan-Mar of the FY ahead of Apr-Dec. Real DB.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { scoped } from "./_tenant.js";
import { bearer } from "./_fp02.js";

const T = randomUUID();
const ACTOR = "00000000-0f02-4000-8000-000000000052";
let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  app = await buildApp();
  await scoped(T, (tx) => tx.execute(sql`
    INSERT INTO gl.finance_cash_book (tenant_id, entry_date, voucher_type, voucher_no, particulars, receipt_minor, payment_minor, balance_minor, bank_or_cash)
    VALUES (${T}::uuid, '2027-01-10', 'receipt', 'V-JAN', 'jan', 300, 0, 0, 'cash'),
           (${T}::uuid, '2026-04-05', 'receipt', 'V-APR', 'apr', 100, 40, 0, 'cash'),
           (${T}::uuid, '2026-12-20', 'payment', 'V-DEC', 'dec', 0, 70, 0, 'bank'),
           (${T}::uuid, '2027-03-31', 'receipt', 'V-MAR', 'mar', 500, 0, 0, 'cash'),
           (${T}::uuid, '2026-03-31', 'receipt', 'V-PRIOR', 'prior FY, excluded', 999, 0, 0, 'cash')`));
});
afterAll(async () => { await app.close(); await sqlClient.end(); });

describe("GET /v1/finance/statements/cash-flow month order", () => {
  it("returns months Apr..Mar for the FY, with correct per-month totals", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/finance/statements/cash-flow?fy=2026-27", headers: bearer(T, ACTOR, ["finance_officer"]) });
    expect(r.statusCode).toBe(200);
    const flows = r.json().monthlyFlows as Array<{ month: number; inflows: string | number; outflows: string | number; net_flow: string | number }>;
    expect(flows.map((f) => f.month)).toEqual([4, 12, 1, 3]);
    expect(flows.map((f) => String(f.net_flow))).toEqual(["60", "-70", "300", "500"]);
  });
});
