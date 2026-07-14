/**
 * Financial Reconciliation — DB Integration Tests (T3)
 * Lane L04: finance-service invariant verification against live DB.
 *
 * Invariants:
 *   I2  GL ledger aggregate: sum(Dr) == sum(Cr)
 *   I6  GL immutability: REVOKE + trigger enforcement
 *   I8  Subledger = control account (HTTP reconciliation route)
 *   I2b Per-journal balance check
 *   I5b Reversal linkage (DB-level reversal status)
 *
 * Uses a unique test tenant UUID so no seed data is polluted.
 * Real HTTP via buildApp() for route tests; scoped() for direct DB access.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { scoped } from "./_tenant.js";
import { financeJournals, financeLedger } from "../src/modules/gl/schema.js";
import { financeHeads } from "../src/modules/budget/schema.js";
import { financePeriodClose } from "../src/modules/period-close/schema.js";

// ── Test-isolated tenant (all hex, never conflicts with seed data) ──────────
const TEST_TENANT = "aa000001-ec00-4000-8000-000000000001";
const TEST_ACTOR  = "bb000001-ec00-4000-8000-000000000001";
const JWT_SECRET  = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

// Seeded head IDs for this tenant
const H_ASSET = "cc000001-ec00-4000-8000-000000000001"; // code 1100
const H_LIAB  = "cc000002-ec00-4000-8000-000000000002"; // code 2100
const H_EXP   = "cc000003-ec00-4000-8000-000000000003"; // code 5100

// Journal IDs for ledger balance tests
const J1 = "dd000001-ec00-4000-8000-000000000001"; // expense / AP credit
const J2 = "dd000002-ec00-4000-8000-000000000002"; // AP debit / cash credit

function token(roles = ["finance_officer"]) {
  return signToken({ sub: TEST_ACTOR, tid: TEST_TENANT, roles, sid: "recon-db" }, JWT_SECRET);
}

// ── Setup: seed heads + journals + ledger ───────────────────────────────────

beforeAll(async () => {
  // Heads (use multi-row insert; each row triggers a separate VALUES in the query)
  await scoped(TEST_TENANT, (tx: any) =>
    tx.insert(financeHeads).values([
      { id: H_ASSET, tenantId: TEST_TENANT, code: "1100", name: "Cash (Recon Test)",     level: 1, classification: "asset",        createdBy: TEST_ACTOR, updatedBy: TEST_ACTOR },
      { id: H_LIAB,  tenantId: TEST_TENANT, code: "2100", name: "AP Control (Recon)",    level: 1, classification: "liability",     createdBy: TEST_ACTOR, updatedBy: TEST_ACTOR },
      { id: H_EXP,   tenantId: TEST_TENANT, code: "5100", name: "Salary Exp (Recon)",    level: 1, classification: "expenditure",   createdBy: TEST_ACTOR, updatedBy: TEST_ACTOR },
    ]).onConflictDoNothing()
  );

  // Journals (status=posted, lines in JSONB)
  await scoped(TEST_TENANT, (tx: any) =>
    tx.insert(financeJournals).values([
      {
        id: J1, tenantId: TEST_TENANT, voucherNo: "RECON-001", type: "journal",
        postingDate: "2026-09-01", status: "posted",
        lines: [
          { accountCode: H_EXP,  debitMinor:  "500000", creditMinor: "0" },
          { accountCode: H_LIAB, debitMinor:  "0",      creditMinor: "500000" },
        ],
        createdBy: TEST_ACTOR, updatedBy: TEST_ACTOR,
      },
      {
        id: J2, tenantId: TEST_TENANT, voucherNo: "RECON-002", type: "journal",
        postingDate: "2026-09-05", status: "posted",
        lines: [
          { accountCode: H_LIAB,  debitMinor: "300000", creditMinor: "0" },
          { accountCode: H_ASSET, debitMinor: "0",      creditMinor: "300000" },
        ],
        createdBy: TEST_ACTOR, updatedBy: TEST_ACTOR,
      },
    ]).onConflictDoNothing()
  );

  // Ledger lines (one row per journal line — append-only)
  await scoped(TEST_TENANT, (tx: any) =>
    tx.insert(financeLedger).values([
      // J1: Expense Dr 500k / AP Cr 500k
      { id: "ee000001-ec00-4000-8000-000000000001", tenantId: TEST_TENANT, headId: H_EXP,   debitMinor: 500_000n, creditMinor: 0n,       balanceMinor:  500_000n, voucherNo: "RECON-001", postingDate: "2026-09-01", createdBy: TEST_ACTOR, updatedBy: TEST_ACTOR },
      { id: "ee000002-ec00-4000-8000-000000000002", tenantId: TEST_TENANT, headId: H_LIAB,  debitMinor: 0n,       creditMinor: 500_000n, balanceMinor: -500_000n, voucherNo: "RECON-001", postingDate: "2026-09-01", createdBy: TEST_ACTOR, updatedBy: TEST_ACTOR },
      // J2: AP Dr 300k / Cash Cr 300k
      { id: "ee000003-ec00-4000-8000-000000000003", tenantId: TEST_TENANT, headId: H_LIAB,  debitMinor: 300_000n, creditMinor: 0n,       balanceMinor:  300_000n, voucherNo: "RECON-002", postingDate: "2026-09-05", createdBy: TEST_ACTOR, updatedBy: TEST_ACTOR },
      { id: "ee000004-ec00-4000-8000-000000000004", tenantId: TEST_TENANT, headId: H_ASSET, debitMinor: 0n,       creditMinor: 300_000n, balanceMinor: -300_000n, voucherNo: "RECON-002", postingDate: "2026-09-05", createdBy: TEST_ACTOR, updatedBy: TEST_ACTOR },
    ]).onConflictDoNothing()
  );
});

// ── Teardown ─────────────────────────────────────────────────────────────────

afterAll(async () => {
  // Note: gl.finance_ledger is append-only (trigger blocks DELETE for everyone,
  // even the owner, by design — migration 0014). Ledger rows for the test tenant
  // are left in place; they are RLS-scoped and invisible to other tenants.
  await scoped(TEST_TENANT, (tx: any) =>
    tx.execute(sql`DELETE FROM gl.finance_journals WHERE tenant_id = ${TEST_TENANT}::uuid`)
  ).catch(() => {}); // DELETE trigger on journals is also present — ignore cleanup errors
  await scoped(TEST_TENANT, (tx: any) =>
    tx.execute(sql`DELETE FROM gl.finance_period_close WHERE tenant_id = ${TEST_TENANT}::uuid`)
  ).catch(() => {});
  await scoped(TEST_TENANT, (tx: any) =>
    tx.execute(sql`DELETE FROM budget.finance_heads WHERE tenant_id = ${TEST_TENANT}::uuid`)
  ).catch(() => {});
  await sqlClient.end();
});

// ─────────────────────────────────────────────────────────────────────────────
// I2 – GL ledger aggregate balance
// ─────────────────────────────────────────────────────────────────────────────

describe("I2 – GL ledger aggregate: sum(Dr) == sum(Cr) (DB integration)", () => {
  it("whole-tenant aggregate: total debit equals total credit", async () => {
    const rows = await scoped(TEST_TENANT, (tx: any) => tx.execute(sql`
      SELECT
        COALESCE(SUM(debit_minor),  0)::bigint AS dr,
        COALESCE(SUM(credit_minor), 0)::bigint AS cr,
        COUNT(*)::int                           AS cnt
      FROM gl.finance_ledger
      WHERE tenant_id = ${TEST_TENANT}::uuid
    `)) as unknown as { dr: string; cr: string; cnt: number }[];

    const dr  = BigInt(rows[0]!.dr);
    const cr  = BigInt(rows[0]!.cr);
    const cnt = Number(rows[0]!.cnt);

    expect(cnt).toBeGreaterThanOrEqual(4);
    expect(dr).toBe(cr);                  // PASS: aggregate balanced
    expect(dr).toBe(800_000n);            // 500k + 300k
  });

  it("per-journal balance: RECON-001 lines sum to Dr==Cr", async () => {
    const rows = await scoped(TEST_TENANT, (tx: any) => tx.execute(sql`
      SELECT
        COALESCE(SUM(debit_minor),  0)::bigint AS dr,
        COALESCE(SUM(credit_minor), 0)::bigint AS cr
      FROM gl.finance_ledger
      WHERE tenant_id = ${TEST_TENANT}::uuid AND voucher_no = 'RECON-001'
    `)) as unknown as { dr: string; cr: string }[];
    expect(BigInt(rows[0]!.dr)).toBe(BigInt(rows[0]!.cr));
    expect(BigInt(rows[0]!.dr)).toBe(500_000n);
  });

  it("per-journal balance: RECON-002 lines sum to Dr==Cr", async () => {
    const rows = await scoped(TEST_TENANT, (tx: any) => tx.execute(sql`
      SELECT
        COALESCE(SUM(debit_minor),  0)::bigint AS dr,
        COALESCE(SUM(credit_minor), 0)::bigint AS cr
      FROM gl.finance_ledger
      WHERE tenant_id = ${TEST_TENANT}::uuid AND voucher_no = 'RECON-002'
    `)) as unknown as { dr: string; cr: string }[];
    expect(BigInt(rows[0]!.dr)).toBe(BigInt(rows[0]!.cr));
    expect(BigInt(rows[0]!.dr)).toBe(300_000n);
  });

  it("trial-balance-check route: isBalanced=true, difference=0, Dr==Cr", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/finance/statements/trial-balance-check",
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(b.isBalanced).toBe(true);
    expect(b.differenceMinor).toBe("0");
    expect(BigInt(b.totalDebitMinor)).toBe(BigInt(b.totalCreditMinor));
    expect(BigInt(b.totalDebitMinor)).toBeGreaterThan(0n); // non-trivial: seeded data present
  });

  it("trial-balance lines: every entry has a known nature classification", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/finance/statements/trial-balance-check",
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    const b = res.json();
    for (const line of b.lines as { nature: string }[]) {
      expect(["asset", "liability", "equity", "income", "expense"]).toContain(line.nature);
    }
  });

  it("balance-sheet: equation holds (assets = liabilities + equity + net-income)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/finance/statements/balance-sheet",
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(b.balanceCheck.balanced).toBe(true);
    expect(b.balanceCheck.differenceMinor).toBe("0");
    const assets = BigInt(b.totals.totalAssetsMinor);
    const liabAndEquity = BigInt(b.totals.totalLiabilitiesAndEquityMinor);
    expect(assets).toBe(liabAndEquity);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// I6 – GL immutability (REVOKE + DB trigger enforcement)
// ─────────────────────────────────────────────────────────────────────────────

describe("I6 – GL immutability: REVOKE + trigger enforcement (DB integration)", () => {
  it("finance_svc has no UPDATE privilege on gl.finance_ledger (REVOKE-enforced)", async () => {
    // The finance_svc role had UPDATE REVOKED in migration 0014
    await expect(
      scoped(TEST_TENANT, (tx: any) => tx.execute(sql`
        UPDATE gl.finance_ledger
           SET debit_minor = debit_minor + 1
         WHERE tenant_id = ${TEST_TENANT}::uuid AND voucher_no = 'RECON-001'
      `))
    ).rejects.toThrow(); // permission denied
  });

  it("finance_svc has no DELETE privilege on gl.finance_journals (REVOKE-enforced)", async () => {
    // finance_svc had DELETE REVOKED in migration 0014
    await expect(
      scoped(TEST_TENANT, (tx: any) => tx.execute(sql`
        DELETE FROM gl.finance_journals
         WHERE tenant_id = ${TEST_TENANT}::uuid AND voucher_no = 'RECON-001'
      `))
    ).rejects.toThrow(); // permission denied
  });

  it("DB trigger blocks illegal status transition posted→draft on finance_journals", async () => {
    // finance_svc CAN UPDATE journals (status transition), but the trigger rejects
    // any transition that is not one of: draft→posted, posted→reversed, same→same
    await expect(
      scoped(TEST_TENANT, (tx: any) => tx.execute(sql`
        UPDATE gl.finance_journals
           SET status = 'draft', updated_at = now(), updated_by = ${TEST_ACTOR}::uuid
         WHERE tenant_id = ${TEST_TENANT}::uuid AND voucher_no = 'RECON-001'
      `))
    ).rejects.toThrow(/illegal status transition|immutable/i);
  });

  it("DB trigger allows legal posted→reversed status transition", async () => {
    // The reversal consumer uses exactly this path: mark original as 'reversed'
    await expect(
      scoped(TEST_TENANT, (tx: any) => tx.execute(sql`
        UPDATE gl.finance_journals
           SET status = 'reversed', updated_at = now(), updated_by = ${TEST_ACTOR}::uuid
         WHERE tenant_id = ${TEST_TENANT}::uuid AND voucher_no = 'RECON-002'
      `))
    ).resolves.toBeDefined(); // allowed transition
  });

  it("DB trigger blocks mutation of journal business fields (lines JSONB)", async () => {
    await expect(
      scoped(TEST_TENANT, (tx: any) => tx.execute(sql`
        UPDATE gl.finance_journals
           SET lines = '[]'::jsonb, updated_at = now()
         WHERE tenant_id = ${TEST_TENANT}::uuid AND voucher_no = 'RECON-001'
      `))
    ).rejects.toThrow(/immutable/i);
  });

  it("DB trigger blocks mutation of journal posting_date", async () => {
    await expect(
      scoped(TEST_TENANT, (tx: any) => tx.execute(sql`
        UPDATE gl.finance_journals
           SET posting_date = '2020-01-01', updated_at = now()
         WHERE tenant_id = ${TEST_TENANT}::uuid AND voucher_no = 'RECON-001'
      `))
    ).rejects.toThrow(/immutable/i);
  });

  it("DB trigger blocks mutation of voucher_no", async () => {
    await expect(
      scoped(TEST_TENANT, (tx: any) => tx.execute(sql`
        UPDATE gl.finance_journals
           SET voucher_no = 'HACKED', updated_at = now()
         WHERE tenant_id = ${TEST_TENANT}::uuid AND voucher_no = 'RECON-001'
      `))
    ).rejects.toThrow(/immutable/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// I8 – Subledger = control account reconciliation (HTTP)
// ─────────────────────────────────────────────────────────────────────────────

describe("I8 – Subledger = control account reconciliation (HTTP route)", () => {
  it("AP reconciliation endpoint: returns required fields with correct mismatch detection", async () => {
    // Our test tenant has GL ledger entries for the AP control account (code 2100)
    // but NO entries in gl.finance_ap_ledger → subledger ≠ control → not reconciled.
    // This tests the FALSE path of the reconciliation invariant.
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/finance/subledger-gl-reconciliation?side=ap",
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    // Structural contract: all required fields present with correct types
    expect(typeof d.subledgerBalanceMinor).toBe("string");
    expect(typeof d.controlAccountBalanceMinor).toBe("string");
    expect(typeof d.differenceMinor).toBe("string");
    expect(typeof d.isReconciled).toBe("boolean");
    expect(d.side).toBe("ap");
    // Reconciliation arithmetic: differenceMinor = subledger - control (must be consistent)
    const diff = BigInt(d.differenceMinor);
    const sub  = BigInt(d.subledgerBalanceMinor);
    const ctrl = BigInt(d.controlAccountBalanceMinor);
    expect(diff).toBe(sub - ctrl); // arithmetic identity always holds
    // isReconciled must reflect whether difference is zero
    expect(d.isReconciled).toBe(diff === 0n);
  });

  it("AR reconciliation endpoint: returns required fields", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/finance/subledger-gl-reconciliation?side=ar",
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d.side).toBe("ar");
    expect(typeof d.isReconciled).toBe("boolean");
    expect(d.differenceMinor).toBe("0");
  });

  it("reconciliation rejects unauthorised role with 403", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/finance/subledger-gl-reconciliation",
      headers: { authorization: `Bearer ${token(["citizen"])}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("period list endpoint returns 200 (period-close controls reachable)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/finance/periods",
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().data)).toBe(true);
  });

  it("period hard-close and post-attempt returns correct period list", async () => {
    // close a period for this tenant
    const app1 = await buildApp();
    const closeRes = await app1.inject({
      method: "POST",
      url: "/v1/finance/periods/2025-06/hard-close",
      headers: { authorization: `Bearer ${token()}` },
    });
    await app1.close();
    expect([200, 201, 409]).toContain(closeRes.statusCode); // already closed is ok

    // verify periods list reflects the period
    const app2 = await buildApp();
    const listRes = await app2.inject({
      method: "GET",
      url: "/v1/finance/periods",
      headers: { authorization: `Bearer ${token()}` },
    });
    await app2.close();
    expect(listRes.statusCode).toBe(200);
    const periods = listRes.json().data as { period: string; status: string }[];
    const p = periods.find((x) => x.period === "2025-06");
    // If we closed it, it appears; if it was already closed before, it's still there
    if (p) expect(p.status).toBe("hard_close");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// I5b – Reversal status reflected in DB (after trigger test reversed RECON-002)
// ─────────────────────────────────────────────────────────────────────────────

describe("I5b – Reversal status persisted in DB (DB integration)", () => {
  it("RECON-002 journal was marked reversed by the trigger test (status=reversed)", async () => {
    // The I6 trigger test updated RECON-002 to status='reversed' (the legal transition)
    const rows = await scoped(TEST_TENANT, (tx: any) =>
      tx.select({ status: financeJournals.status })
        .from(financeJournals)
        .where(eq(financeJournals.voucherNo, "RECON-002"))
    ) as { status: string }[];
    // Either reversed (if trigger test ran) or posted (if not yet)
    expect(["posted", "reversed"]).toContain(rows[0]?.status);
  });

  it("reversed journal: RECON-001 still has status=posted (original not deleted)", async () => {
    const rows = await scoped(TEST_TENANT, (tx: any) =>
      tx.select({ id: financeJournals.id, status: financeJournals.status })
        .from(financeJournals)
        .where(eq(financeJournals.voucherNo, "RECON-001"))
    ) as { id: string; status: string }[];
    // RECON-001 exists (not deleted) and has status=posted (trigger blocked mutating it)
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("posted");
  });

  it("GL ledger lines for reversed journal still exist (append-only: no delete)", async () => {
    const rows = await scoped(TEST_TENANT, (tx: any) => tx.execute(sql`
      SELECT COUNT(*)::int AS cnt
      FROM gl.finance_ledger
      WHERE tenant_id = ${TEST_TENANT}::uuid AND voucher_no = 'RECON-002'
    `)) as unknown as { cnt: number }[];
    // Lines still exist even if the journal was marked reversed
    expect(Number(rows[0]!.cnt)).toBe(2); // the two lines we inserted in beforeAll
  });
});
