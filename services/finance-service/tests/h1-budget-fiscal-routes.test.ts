/**
 * HTTP integration (real Postgres) for the h1-finance-budget-fiscal batch.
 * Queue is the in-memory driver (vitest env), so 202 means "validated and
 * published"; publish payloads are inspected via a spy.
 */
import { describe, it, expect, afterAll, beforeAll, vi, afterEach } from "vitest";
import { signToken } from "@civitasone/auth";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { scoped } from "./_tenant.js";
import { financeBudgetAllocation } from "../src/modules/budget/allocation-schema.js";
import { financeHeads } from "../src/modules/budget/schema.js";
import { pgSchema, uuid, varchar, integer, timestamp } from "drizzle-orm/pg-core";
import { encryptedText } from "../src/shared/pii-crypto.js";

// Mirrors the inline table in masters/bank-routes.ts (not exported there).
const bankAccounts = pgSchema("payments").table("finance_bank_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  bankName: varchar("bank_name", { length: 200 }).notNull(),
  branchName: varchar("branch_name", { length: 200 }),
  accountNo: encryptedText("account_no").notNull(),
  ifsc: encryptedText("ifsc").notNull(),
  accountType: varchar("account_type", { length: 20 }).notNull().default("current"),
  purpose: varchar("purpose", { length: 64 }),
  status: varchar("status", { length: 12 }).notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  version: integer("version").notNull().default(1),
});

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
// Fresh tenant per run: gl.finance_journals is append-only (no DELETE grant),
// so rows seeded for the readiness check cannot be cleaned up afterwards.
const TENANT = randomUUID();
const ACTOR = "00000000-aaaa-4000-8000-0000000a1fb1";
const HEAD_EXP = "aaaaaaaa-2222-4000-8000-0000000a1f01";
const HEAD_LIAB = "aaaaaaaa-2222-4000-8000-0000000a1f02";
const HEAD_REV0 = "aaaaaaaa-2222-4000-8000-0000000a1f03";
const ALLOC = "aaaaaaaa-3333-4000-8000-0000000a1f01";
const FY = "2031-32";

const tok = (roles: string[]) => signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-h1fbf" }, SECRET);
const admin = () => ({ authorization: `Bearer ${tok(["finance_admin"])}` });
const officer = () => ({ authorization: `Bearer ${tok(["finance_officer"])}` });

async function cleanup() {
  await scoped(TENANT, (tx) => tx.delete(financeBudgetAllocation).where(eq(financeBudgetAllocation.tenantId, TENANT)));
  await scoped(TENANT, (tx) => tx.delete(financeHeads).where(eq(financeHeads.tenantId, TENANT)));
  await scoped(TENANT, (tx) => tx.execute(sql`DELETE FROM gl.finance_fiscal_years WHERE tenant_id = ${TENANT}::uuid`));
  await scoped(TENANT, (tx) => tx.execute(sql`DELETE FROM gl.finance_recurring_entries WHERE tenant_id = ${TENANT}::uuid`));
}

beforeAll(async () => {
  await cleanup();
  await scoped(TENANT, (tx) => tx.insert(financeHeads).values([
    { id: HEAD_EXP, tenantId: TENANT, code: "3054-H1", name: "Roads and Bridges", level: 1, classification: "expense", createdBy: ACTOR, updatedBy: ACTOR },
    { id: HEAD_LIAB, tenantId: TENANT, code: "8443-H1", name: "Civil Deposits", level: 1, classification: "liability", createdBy: ACTOR, updatedBy: ACTOR },
    // seed-all.mjs shape: level-0 major head classified "revenue"
    // GAP-FINANCE-OPENING-BALANCES-03: the opening-balances route requires codes in the chart of accounts
    ...["H1-1100", "H1-3100", "H1-M1", "H1-M2"].map((code, i) => ({
      id: `aaaaaaaa-2222-4000-8000-0000000a1f1${i}`, tenantId: TENANT, code, name: `Head ${code}`, level: 1,
      classification: "expense", createdBy: ACTOR, updatedBy: ACTOR,
    })),
    { id: HEAD_REV0, tenantId: TENANT, code: "2202", name: "General Education", level: 0, classification: "revenue", createdBy: ACTOR, updatedBy: ACTOR },
  ]));
  await scoped(TENANT, (tx) => tx.insert(financeBudgetAllocation).values({
    id: ALLOC, tenantId: TENANT, headId: HEAD_EXP, fy: FY, allocatedMinor: 1000n, committedMinor: 0n, actualMinor: 100n,
    currency: "INR", createdBy: ACTOR, updatedBy: ACTOR,
  }));
  await scoped(TENANT, (tx) => tx.execute(sql`
    INSERT INTO gl.finance_fiscal_years (id, tenant_id, code, label, start_date, end_date, status, created_by)
    VALUES (gen_random_uuid(), ${TENANT}::uuid, '2031-32', 'FY 2031-32', '2031-04-01', '2032-03-31', 'active', ${ACTOR}::uuid),
           (gen_random_uuid(), ${TENANT}::uuid, '2030-31', 'FY 2030-31', '2030-04-01', '2031-03-31', 'closed', ${ACTOR}::uuid)`));
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => { await cleanup(); await sqlClient.end(); });

async function inject(method: "GET" | "POST" | "PATCH", url: string, headers: Record<string, string>, payload?: unknown) {
  const app = await buildApp();
  try {
    return await app.inject({ method, url, headers, ...(payload !== undefined ? { payload: payload as object } : {}) });
  } finally { await app.close(); }
}

describe("head labels on allocation + monitoring (GAP-FINANCE-BUDGET-ALLOCATION-01 / MONITORING-02)", () => {
  it("allocation list carries headCode/headName", async () => {
    const res = await inject("GET", `/v1/finance/budget-allocations?fy=${FY}`, officer());
    expect(res.statusCode).toBe(200);
    const row = (res.json().data as Array<Record<string, unknown>>).find((r) => r.id === ALLOC)!;
    expect(row).toMatchObject({ headId: HEAD_EXP, headCode: "3054-H1", headName: "Roads and Bridges" });
  });
  it("monitoring lines carry headCode/headName", async () => {
    const res = await inject("GET", `/v1/finance/budget-monitoring?fy=${FY}&asOf=2031-09-30`, officer());
    expect(res.statusCode).toBe(200);
    const line = (res.json().lines as Array<Record<string, unknown>>).find((l) => l.id === ALLOC)!;
    expect(line).toMatchObject({ headCode: "3054-H1", headName: "Roads and Bridges" });
  });
});

describe("POST /v1/finance/budgets head guard (GAP-FINANCE-BUDGET-FORMULATION-NEW-02)", () => {
  it("rejects a liability head with a headId field error and publishes nothing", async () => {
    const publish = vi.spyOn(queue, "publish");
    const res = await inject("POST", "/v1/finance/budgets", officer(), { headId: HEAD_LIAB, fy: FY, beMinor: "100000" });
    expect(res.statusCode).toBe(400);
    expect(res.json().fieldErrors).toEqual([expect.objectContaining({ field: "headId", message: expect.stringMatching(/expenditure head/) })]);
    expect(publish).not.toHaveBeenCalled();
  });
  it("rejects an unknown head", async () => {
    const res = await inject("POST", "/v1/finance/budgets", officer(), { headId: randomUUID(), fy: FY, beMinor: "100000" });
    expect(res.statusCode).toBe(400);
    expect(res.json().fieldErrors[0].field).toBe("headId");
  });
  it("accepts a level-0 revenue-classified major head (2202 General Education)", async () => {
    const res = await inject("POST", "/v1/finance/budgets", officer(), { headId: HEAD_REV0, fy: FY, beMinor: "100000" });
    expect(res.statusCode).toBe(202);
  });
  it("accepts an expense head", async () => {
    const res = await inject("POST", "/v1/finance/budgets", officer(), { headId: HEAD_EXP, fy: FY, beMinor: "100000" });
    expect(res.statusCode).toBe(202);
  });
});

describe("fiscal-year writes (GAP-FINANCE-FISCAL-YEARS-01/-02)", () => {
  const next = { code: "2032-33", label: "FY 2032-33", startDate: "2032-04-01", endDate: "2033-03-31" };
  it("create without a reason -> 400", async () => {
    const res = await inject("POST", "/v1/finance/fiscal-years", admin(), next);
    expect(res.statusCode).toBe(400);
  });
  it("create overlapping an existing year -> 409 FY_OVERLAP", async () => {
    const res = await inject("POST", "/v1/finance/fiscal-years", admin(), { ...next, startDate: "2032-03-01", reason: "Next year per Finance order" });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("FY_OVERLAP");
  });
  it("create with a reason -> 202 and the reason rides on the command", async () => {
    const publish = vi.spyOn(queue, "publish");
    const res = await inject("POST", "/v1/finance/fiscal-years", admin(), { ...next, reason: "Next year per Finance order" });
    expect(res.statusCode).toBe(202);
    expect((publish.mock.calls[0][1] as { payload: { reason: string } }).payload.reason).toBe("Next year per Finance order");
  });
  it("create with an impossible calendar date -> 400 (not a worker cast failure)", async () => {
    const res = await inject("POST", "/v1/finance/fiscal-years", admin(), { ...next, code: "2040-41", startDate: "2040-02-31", endDate: "2041-03-31", reason: "Next year per Finance order" });
    expect(res.statusCode).toBe(400);
    expect(res.json().fieldErrors[0].field).toBe("startDate");
  });
  it("activate without a reason -> 400", async () => {
    const res = await inject("PATCH", "/v1/finance/fiscal-years/2030-31/activate", admin(), {});
    expect(res.statusCode).toBe(400);
  });
  it("activate an unknown code -> 404 (never closes the active year)", async () => {
    const publish = vi.spyOn(queue, "publish");
    const res = await inject("PATCH", "/v1/finance/fiscal-years/2039-40/activate", admin(), { reason: "Typo test for unknown year" });
    expect(res.statusCode).toBe(404);
    expect(publish).not.toHaveBeenCalled();
  });
  it("activate the already-active year -> 409", async () => {
    const res = await inject("PATCH", "/v1/finance/fiscal-years/2031-32/activate", admin(), { reason: "Re-activate current year" });
    expect(res.statusCode).toBe(409);
  });
  it("activate a closed year with a reason -> 202 with reason on the command", async () => {
    const publish = vi.spyOn(queue, "publish");
    const res = await inject("PATCH", "/v1/finance/fiscal-years/2030-31/activate", admin(), { reason: "Re-open prior year for audit adjustments" });
    expect(res.statusCode).toBe(202);
    expect((publish.mock.calls[0][1] as { payload: { reason: string } }).payload.reason).toBe("Re-open prior year for audit adjustments");
  });
});

describe("opening balances (GAP-FINANCE-OPENING-BALANCES-01)", () => {
  const entries = [
    { accountCode: "H1-1100", debitMinor: "9007199254740993", creditMinor: "0" },
    { accountCode: "H1-3100", debitMinor: "0", creditMinor: "9007199254740993" },
  ];
  it("paise above Postgres BIGINT max -> 400", async () => {
    const big = "9223372036854775808";
    const res = await inject("POST", "/v1/finance/opening-balances", admin(), {
      fyCode: "2031-32", reason: "Migration per audited TB 31-03",
      entries: [{ accountCode: "H1-1100", debitMinor: big, creditMinor: "0" }, { accountCode: "H1-3100", debitMinor: "0", creditMinor: big }],
    });
    expect(res.statusCode).toBe(400);
  });
  it("paise exactly at BIGINT max are accepted", async () => {
    const max = "9223372036854775807";
    const res = await inject("POST", "/v1/finance/opening-balances", admin(), {
      fyCode: "2031-32", reason: "Migration per audited TB 31-03",
      entries: [{ accountCode: "H1-M1", debitMinor: max, creditMinor: "0" }, { accountCode: "H1-M2", debitMinor: "0", creditMinor: max }],
    });
    expect(res.statusCode).toBe(202);
  });
  it("without a reason -> 400", async () => {
    const res = await inject("POST", "/v1/finance/opening-balances", admin(), { fyCode: "2031-32", entries });
    expect(res.statusCode).toBe(400);
  });
  it("with a reason -> 202; paise above 2^53 travel exactly as strings", async () => {
    const publish = vi.spyOn(queue, "publish");
    const res = await inject("POST", "/v1/finance/opening-balances", admin(), { fyCode: "2031-32", entries, reason: "Migration per audited TB 31-03" });
    expect(res.statusCode).toBe(202);
    const payload = (publish.mock.calls[0][1] as { payload: { reason: string; entries: Array<{ debitMinor: string }> } }).payload;
    expect(payload.reason).toBe("Migration per audited TB 31-03");
    expect(payload.entries[0].debitMinor).toBe("9007199254740993");
  });
});

describe("period close (GAP-FINANCE-PERIOD-CLOSE-01/-02)", () => {
  for (const action of ["close", "hard-close", "reopen"]) {
    it(`${action} without a reason -> 400`, async () => {
      const res = await inject("POST", `/v1/finance/periods/2031-05/${action}`, admin(), {});
      expect(res.statusCode).toBe(400);
    });
  }
  it("soft-close with a reason -> 202 and the reason rides on the command", async () => {
    const publish = vi.spyOn(queue, "publish");
    const res = await inject("POST", "/v1/finance/periods/2031-05/close", officer(), { reason: "May books reviewed by AO" });
    expect(res.statusCode).toBe(202);
    expect((publish.mock.calls[0][1] as { payload: { reason: string } }).payload.reason).toBe("May books reviewed by AO");
  });
  it("readiness counts unposted vouchers and due recurring entries in the period", async () => {
    await scoped(TENANT, (tx) => tx.execute(sql`
      INSERT INTO gl.finance_journals (id, tenant_id, voucher_no, type, posting_date, status, created_by, updated_by)
      VALUES (gen_random_uuid(), ${TENANT}::uuid, 'H1-JV-1', 'journal', '2031-05-10', 'draft', ${ACTOR}::uuid, ${ACTOR}::uuid),
             (gen_random_uuid(), ${TENANT}::uuid, 'H1-JV-2', 'journal', '2031-05-11', 'pending_approval', ${ACTOR}::uuid, ${ACTOR}::uuid),
             (gen_random_uuid(), ${TENANT}::uuid, 'H1-JV-3', 'journal', '2031-05-12', 'posted', ${ACTOR}::uuid, ${ACTOR}::uuid),
             (gen_random_uuid(), ${TENANT}::uuid, 'H1-JV-4', 'journal', '2031-06-01', 'draft', ${ACTOR}::uuid, ${ACTOR}::uuid)`));
    await scoped(TENANT, (tx) => tx.execute(sql`
      INSERT INTO gl.finance_recurring_entries (tenant_id, name, debit_account_id, credit_account_id, amount_minor, next_run_date, created_by)
      VALUES (${TENANT}::uuid, 'Rent', ${HEAD_EXP}::uuid, ${HEAD_LIAB}::uuid, 100, '2031-05-25', ${ACTOR}::uuid)`));
    const res = await inject("GET", "/v1/finance/periods/2031-05/readiness", officer());
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ period: "2031-05", unpostedVouchers: 2, unreconciledBankLines: 0, dueRecurringEntries: 1 });
  });
  it("readiness rejects a malformed period", async () => {
    const res = await inject("GET", "/v1/finance/periods/2031-13/readiness", officer());
    expect(res.statusCode).toBe(400);
  });
});

describe("bank accounts (GAP-FINANCE-CONFIG-01)", () => {
  it("rejects a duplicate IFSC + account number for the tenant with 409", async () => {
    await scoped(TENANT, (tx) => tx.insert(bankAccounts).values({
      tenantId: TENANT, bankName: "State Bank of India", accountNo: "00112233445566", ifsc: "SBIN0001234", createdBy: ACTOR,
    }));
    const dup = await inject("POST", "/v1/finance/bank-accounts", admin(), {
      bankName: "SBI", accountNo: "00112233445566", ifsc: "sbin0001234", accountType: "current",
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().code).toBe("BANK_ACCOUNT_EXISTS");
    const other = await inject("POST", "/v1/finance/bank-accounts", admin(), {
      bankName: "SBI", accountNo: "00112233445567", ifsc: "SBIN0001234", accountType: "current",
    });
    expect(other.statusCode).toBe(202);
  });
});
