/**
 * GAP-FINANCE-ACCOUNTING-FINANCIAL-STATEMENTS-03: GET /v1/finance/statements returns every balance as an exact
 * MINOR-unit (paise) decimal string. It used to return Number(bigint) / 100 rupee floats, which lose precision above
 * 2^53 paise and left the web guessing the unit. Real DB: heads + ledger rows are inserted, the route is called.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { scoped } from "./_tenant.js";
import { financeHeads } from "../src/modules/budget/schema.js";
import { financeLedger } from "../src/modules/gl/schema.js";
import { bearer } from "./_fp02.js";

// gl.finance_ledger is append-only, so each run gets its own tenants.
const T = randomUUID();
const OTHER = randomUUID();
const ACTOR = "00000000-0f02-4000-8000-000000000051";
let app: Awaited<ReturnType<typeof buildApp>>;
const get = (tenant = T, roles: string[] = ["finance_officer"]) =>
  app.inject({ method: "GET", url: "/v1/finance/statements", headers: bearer(tenant, ACTOR, roles) });

const head = (tenantId: string, code: string, classification: string) => ({
  id: randomUUID(), tenantId, code, name: `Head ${code}`, level: 0, classification, createdBy: ACTOR, updatedBy: ACTOR,
});
const line = (tenantId: string, headId: string, voucherNo: string, debitMinor: bigint, creditMinor: bigint) => ({
  tenantId, headId, voucherNo, postingDate: "2026-06-15", debitMinor, creditMinor, createdBy: ACTOR, updatedBy: ACTOR,
});

const ASSET = head(T, "1100", "asset");
const INCOME = head(T, "4100", "income");
const EXPENSE = head(T, "5100", "expense");
const FOREIGN = head(OTHER, "1100", "asset");

beforeAll(async () => {
  app = await buildApp();
  await scoped(T, (tx) => tx.insert(financeHeads).values([ASSET, INCOME, EXPENSE]));
  await scoped(OTHER, (tx) => tx.insert(financeHeads).values([FOREIGN]));
  await scoped(T, (tx) => tx.insert(financeLedger).values([
    // 9007199254740000 + 993 = 9007199254740993 paise debited: above 2^53, so a double cannot hold it.
    line(T, ASSET.id, "V-1", 9007199254740000n, 0n),
    line(T, ASSET.id, "V-2", 993n, 100n),
    line(T, INCOME.id, "V-3", 0n, 150050n),
    line(T, EXPENSE.id, "V-4", 70025n, 0n),
  ]));
  await scoped(OTHER, (tx) => tx.insert(financeLedger).values([line(OTHER, FOREIGN.id, "V-9", 5n, 0n)]));
});
afterAll(async () => { await app.close(); await sqlClient.end(); });

describe("GET /v1/finance/statements minor-unit contract", () => {
  it("returns exact paise strings per head, with no float loss above 2^53", async () => {
    const res = await get();
    expect(res.statusCode).toBe(200);
    const rows = res.json() as Array<Record<string, string>>;
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(rows).toHaveLength(3);

    expect(byId.get(ASSET.id)).toMatchObject({
      type: "asset", openingBalance: "0", receipts: "100", payments: "9007199254740993", closingBalance: "-9007199254740893",
    });
    expect(byId.get(INCOME.id)).toMatchObject({
      type: "income", openingBalance: "0", receipts: "150050", payments: "0", closingBalance: "150050",
    });
    expect(byId.get(EXPENSE.id)).toMatchObject({
      type: "expenditure", openingBalance: "0", receipts: "0", payments: "70025", closingBalance: "-70025",
    });
  });

  it("every balance on the wire is a string of digits, never a JSON number", async () => {
    const rows = (await get()).json() as Array<Record<string, unknown>>;
    for (const r of rows) {
      for (const f of ["openingBalance", "receipts", "payments", "closingBalance"]) {
        expect(typeof r[f]).toBe("string");
        expect(r[f]).toMatch(/^-?\d+$/);
      }
    }
  });

  it("is tenant-scoped, and a non-finance role is refused", async () => {
    const other = (await get(OTHER)).json() as Array<Record<string, string>>;
    expect(other).toHaveLength(1);
    expect(other[0]).toMatchObject({ id: FOREIGN.id, payments: "5", closingBalance: "-5" });
    expect((await get(T, ["citizen"])).statusCode).toBe(403);
  });
});
