/**
 * TX-006 — DB-level debit = credit enforcement on journal lines.
 *
 * Until migration 0072, the ONLY guard that a journal balances (sum(debit) ==
 * sum(credit)) was the application-level assertJournalBalances() in
 * src/modules/gl/domain.ts, called from the GL consumer before it ever
 * touches the database. A direct SQL insert into gl.finance_journal_lines —
 * a migration script, an ad-hoc psql session, a future code path that
 * forgets to call assertJournalBalances — had nothing stopping it from
 * posting an unbalanced journal.
 *
 * This suite proves DB-level enforcement directly: it bypasses the app layer
 * entirely (raw tx.execute(sql`INSERT ...`) against gl.finance_journal_lines,
 * never calling postJournal/assertJournalBalances) and shows the database
 * itself rejects an unbalanced journal at commit, via the DEFERRABLE
 * INITIALLY DEFERRED constraint trigger added in migration 0072. It also
 * confirms a balanced direct multi-line insert still succeeds (no
 * regression on the legitimate write shape the app itself uses — N separate
 * INSERT statements for one journal's lines inside a single transaction),
 * and that the existing app-level assertJournalBalances() guard is untouched.
 */

import { describe, it, expect, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { sqlClient } from "../src/shared/db.js";
import { scoped } from "./_tenant.js";
import { financeHeads } from "../src/modules/budget/schema.js";
import { financeJournals } from "../src/modules/gl/schema.js";
import { assertJournalBalances } from "../src/modules/gl/domain.js";

// Test-isolated tenant (all hex, never conflicts with seed data or other suites).
const TEST_TENANT = "aa000006-ec00-4000-8000-000000000006";
const TEST_ACTOR  = "bb000006-ec00-4000-8000-000000000006";
const HEAD_ID     = "cc000006-ec00-4000-8000-000000000006";

async function seedHeadAndJournal(journalId: string, voucherNo: string) {
  await scoped(TEST_TENANT, (tx: any) =>
    tx.insert(financeHeads).values({
      id: HEAD_ID, tenantId: TEST_TENANT, code: "9906", name: "TX-006 test head",
      level: 1, classification: "asset", createdBy: TEST_ACTOR, updatedBy: TEST_ACTOR,
    }).onConflictDoNothing()
  );
  await scoped(TEST_TENANT, (tx: any) =>
    tx.insert(financeJournals).values({
      id: journalId, tenantId: TEST_TENANT, voucherNo, type: "journal",
      postingDate: "2026-09-11", status: "posted", lines: [],
      createdBy: TEST_ACTOR, updatedBy: TEST_ACTOR,
    }).onConflictDoNothing()
  );
}

afterAll(async () => {
  // gl.finance_journal_lines rows can be deleted (no immutability trigger on
  // this denormalized table); gl.finance_journals rows cannot (append-only,
  // migration 0014) so they are left in place, RLS-scoped to this throwaway
  // tenant — same convention as tests/recon-db.test.ts.
  await scoped(TEST_TENANT, (tx: any) =>
    tx.execute(sql`DELETE FROM gl.finance_journal_lines WHERE tenant_id = ${TEST_TENANT}::uuid`)
  ).catch(() => {});
  await sqlClient.end();
});

describe("TX-006 — DB rejects a direct-SQL unbalanced journal (bypassing the app layer)", () => {
  it("single unbalanced line: DB rejects at commit", async () => {
    const journalId = randomUUID();
    await seedHeadAndJournal(journalId, `TX006-${journalId.slice(0, 8)}`);

    await expect(
      scoped(TEST_TENANT, (tx: any) => tx.execute(sql`
        INSERT INTO gl.finance_journal_lines
          (id, tenant_id, journal_id, head_id, debit_minor, credit_minor, posting_date, journal_type)
        VALUES
          (gen_random_uuid(), ${TEST_TENANT}::uuid, ${journalId}::uuid, ${HEAD_ID}::uuid, 100000, 0, '2026-09-11', 'journal')
      `))
    ).rejects.toThrow(/JOURNAL_UNBALANCED/);
  });

  it("two unbalanced lines across separate INSERT statements in one transaction: DB rejects at commit", async () => {
    // Mirrors postJournal's actual write shape (one INSERT per line, same
    // transaction) — proves the deferred trigger checks the journal's FULL
    // line set at commit, not each row in isolation, and still catches an
    // imbalance that spans statements.
    const journalId = randomUUID();
    await seedHeadAndJournal(journalId, `TX006-${journalId.slice(0, 8)}`);

    await expect(
      scoped(TEST_TENANT, async (tx: any) => {
        await tx.execute(sql`
          INSERT INTO gl.finance_journal_lines
            (id, tenant_id, journal_id, head_id, debit_minor, credit_minor, posting_date, journal_type)
          VALUES
            (gen_random_uuid(), ${TEST_TENANT}::uuid, ${journalId}::uuid, ${HEAD_ID}::uuid, 50000, 0, '2026-09-11', 'journal')
        `);
        await tx.execute(sql`
          INSERT INTO gl.finance_journal_lines
            (id, tenant_id, journal_id, head_id, debit_minor, credit_minor, posting_date, journal_type)
          VALUES
            (gen_random_uuid(), ${TEST_TENANT}::uuid, ${journalId}::uuid, ${HEAD_ID}::uuid, 0, 40000, '2026-09-11', 'journal')
        `);
      })
    ).rejects.toThrow(/JOURNAL_UNBALANCED/);
  });

  it("a balanced direct multi-line insert (same shape the app uses) still succeeds — no regression", async () => {
    const journalId = randomUUID();
    await seedHeadAndJournal(journalId, `TX006-${journalId.slice(0, 8)}`);

    await expect(
      scoped(TEST_TENANT, async (tx: any) => {
        await tx.execute(sql`
          INSERT INTO gl.finance_journal_lines
            (id, tenant_id, journal_id, head_id, debit_minor, credit_minor, posting_date, journal_type)
          VALUES
            (gen_random_uuid(), ${TEST_TENANT}::uuid, ${journalId}::uuid, ${HEAD_ID}::uuid, 75000, 0, '2026-09-11', 'journal')
        `);
        await tx.execute(sql`
          INSERT INTO gl.finance_journal_lines
            (id, tenant_id, journal_id, head_id, debit_minor, credit_minor, posting_date, journal_type)
          VALUES
            (gen_random_uuid(), ${TEST_TENANT}::uuid, ${journalId}::uuid, ${HEAD_ID}::uuid, 0, 75000, '2026-09-11', 'journal')
        `);
        return "committed";
      })
    ).resolves.toBe("committed");

    const rows = (await scoped(TEST_TENANT, (tx: any) => tx.execute(sql`
      SELECT COALESCE(SUM(debit_minor),0)::bigint AS dr, COALESCE(SUM(credit_minor),0)::bigint AS cr
      FROM gl.finance_journal_lines WHERE journal_id = ${journalId}::uuid
    `))) as unknown as { dr: string; cr: string }[];
    expect(BigInt(rows[0]!.dr)).toBe(BigInt(rows[0]!.cr));
    expect(BigInt(rows[0]!.dr)).toBe(75000n);
  });
});

describe("TX-006 — existing app-level assertJournalBalances() guard is unaffected", () => {
  it("still accepts a balanced set of lines", () => {
    expect(() =>
      assertJournalBalances([
        { accountCode: "1100", debitMinor: "100000", creditMinor: "0" },
        { accountCode: "2100", debitMinor: "0", creditMinor: "100000" },
      ] as any)
    ).not.toThrow();
  });

  it("still rejects an unbalanced set of lines", () => {
    expect(() =>
      assertJournalBalances([
        { accountCode: "1100", debitMinor: "100000", creditMinor: "0" },
        { accountCode: "2100", debitMinor: "0", creditMinor: "90000" },
      ] as any)
    ).toThrow(/JOURNAL_UNBALANCED/);
  });
});
