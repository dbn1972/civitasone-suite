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

describe("TX-006 — UPDATE that moves a line between journals validates BOTH journals", () => {
  // Regression coverage for a gap an independent reviewer found in this PR:
  // the trigger's original v_journal_id := COALESCE(NEW.journal_id,
  // OLD.journal_id) always resolves to NEW.journal_id on an UPDATE (NEW is
  // never null there), so re-assigning a line's journal_id only ever
  // re-validated the DESTINATION journal. The SOURCE journal a line moved
  // OUT of was never re-checked, so a transaction could leave it
  // permanently unbalanced while still committing cleanly. Fixed by having
  // the trigger validate OLD.journal_id too whenever it differs from
  // NEW.journal_id.

  it("moving lines out of a balanced journal, leaving the source unbalanced: DB rejects at commit", async () => {
    const journalA = randomUUID();
    const journalB = randomUUID();
    await seedHeadAndJournal(journalA, `TX006-A-${journalA.slice(0, 8)}`);
    await seedHeadAndJournal(journalB, `TX006-B-${journalB.slice(0, 8)}`);

    const line1 = randomUUID(); // stays in A: debit 100000
    const line2 = randomUUID(); // moves to B: credit 60000
    const line3 = randomUUID(); // moves to B: credit 40000

    // Seed A balanced: debit 100000 vs credit (60000 + 40000) = 100000.
    await scoped(TEST_TENANT, async (tx: any) => {
      await tx.execute(sql`
        INSERT INTO gl.finance_journal_lines
          (id, tenant_id, journal_id, head_id, debit_minor, credit_minor, posting_date, journal_type)
        VALUES (${line1}::uuid, ${TEST_TENANT}::uuid, ${journalA}::uuid, ${HEAD_ID}::uuid, 100000, 0, '2026-09-11', 'journal')
      `);
      await tx.execute(sql`
        INSERT INTO gl.finance_journal_lines
          (id, tenant_id, journal_id, head_id, debit_minor, credit_minor, posting_date, journal_type)
        VALUES (${line2}::uuid, ${TEST_TENANT}::uuid, ${journalA}::uuid, ${HEAD_ID}::uuid, 0, 60000, '2026-09-11', 'journal')
      `);
      await tx.execute(sql`
        INSERT INTO gl.finance_journal_lines
          (id, tenant_id, journal_id, head_id, debit_minor, credit_minor, posting_date, journal_type)
        VALUES (${line3}::uuid, ${TEST_TENANT}::uuid, ${journalA}::uuid, ${HEAD_ID}::uuid, 0, 40000, '2026-09-11', 'journal')
      `);
    });

    // Move line2 + line3 into B via UPDATE journal_id, adding a compensating
    // debit-100000 line to B so the DESTINATION stays balanced. If only the
    // destination is validated, this commits — leaving A with a lone
    // debit-100000/credit-0 line, permanently unbalanced.
    await expect(
      scoped(TEST_TENANT, async (tx: any) => {
        await tx.execute(sql`
          UPDATE gl.finance_journal_lines SET journal_id = ${journalB}::uuid WHERE id = ${line2}::uuid
        `);
        await tx.execute(sql`
          UPDATE gl.finance_journal_lines SET journal_id = ${journalB}::uuid WHERE id = ${line3}::uuid
        `);
        await tx.execute(sql`
          INSERT INTO gl.finance_journal_lines
            (id, tenant_id, journal_id, head_id, debit_minor, credit_minor, posting_date, journal_type)
          VALUES (gen_random_uuid(), ${TEST_TENANT}::uuid, ${journalB}::uuid, ${HEAD_ID}::uuid, 100000, 0, '2026-09-11', 'journal')
        `);
      })
    ).rejects.toThrow(/JOURNAL_UNBALANCED/);

    // Whole transaction rolled back: A is untouched and still balanced.
    const rowsA = (await scoped(TEST_TENANT, (tx: any) => tx.execute(sql`
      SELECT COALESCE(SUM(debit_minor),0)::bigint AS dr, COALESCE(SUM(credit_minor),0)::bigint AS cr
      FROM gl.finance_journal_lines WHERE journal_id = ${journalA}::uuid
    `))) as unknown as { dr: string; cr: string }[];
    expect(BigInt(rowsA[0]!.dr)).toBe(BigInt(rowsA[0]!.cr));
    expect(BigInt(rowsA[0]!.dr)).toBe(100000n);
  });

  it("moving all lines from one journal to another, both ends up balanced: allowed", async () => {
    const journalA = randomUUID();
    const journalB = randomUUID();
    await seedHeadAndJournal(journalA, `TX006-A-${journalA.slice(0, 8)}`);
    await seedHeadAndJournal(journalB, `TX006-B-${journalB.slice(0, 8)}`);

    const line1 = randomUUID();
    const line2 = randomUUID();

    // Seed A balanced: debit 80000 vs credit 80000. B starts with no lines
    // (trivially balanced: 0 == 0).
    await scoped(TEST_TENANT, async (tx: any) => {
      await tx.execute(sql`
        INSERT INTO gl.finance_journal_lines
          (id, tenant_id, journal_id, head_id, debit_minor, credit_minor, posting_date, journal_type)
        VALUES (${line1}::uuid, ${TEST_TENANT}::uuid, ${journalA}::uuid, ${HEAD_ID}::uuid, 80000, 0, '2026-09-11', 'journal')
      `);
      await tx.execute(sql`
        INSERT INTO gl.finance_journal_lines
          (id, tenant_id, journal_id, head_id, debit_minor, credit_minor, posting_date, journal_type)
        VALUES (${line2}::uuid, ${TEST_TENANT}::uuid, ${journalA}::uuid, ${HEAD_ID}::uuid, 0, 80000, '2026-09-11', 'journal')
      `);
    });

    // Move BOTH lines from A to B: A ends up empty (0 == 0, balanced) and B
    // ends up with the exact same balanced pair (80000 == 80000). Both the
    // source and destination validate cleanly, so the tx should commit.
    await expect(
      scoped(TEST_TENANT, async (tx: any) => {
        await tx.execute(sql`
          UPDATE gl.finance_journal_lines SET journal_id = ${journalB}::uuid WHERE id = ${line1}::uuid
        `);
        await tx.execute(sql`
          UPDATE gl.finance_journal_lines SET journal_id = ${journalB}::uuid WHERE id = ${line2}::uuid
        `);
        return "committed";
      })
    ).resolves.toBe("committed");

    const rowsA = (await scoped(TEST_TENANT, (tx: any) => tx.execute(sql`
      SELECT COALESCE(SUM(debit_minor),0)::bigint AS dr, COALESCE(SUM(credit_minor),0)::bigint AS cr
      FROM gl.finance_journal_lines WHERE journal_id = ${journalA}::uuid
    `))) as unknown as { dr: string; cr: string }[];
    expect(BigInt(rowsA[0]!.dr)).toBe(0n);
    expect(BigInt(rowsA[0]!.cr)).toBe(0n);

    const rowsB = (await scoped(TEST_TENANT, (tx: any) => tx.execute(sql`
      SELECT COALESCE(SUM(debit_minor),0)::bigint AS dr, COALESCE(SUM(credit_minor),0)::bigint AS cr
      FROM gl.finance_journal_lines WHERE journal_id = ${journalB}::uuid
    `))) as unknown as { dr: string; cr: string }[];
    expect(BigInt(rowsB[0]!.dr)).toBe(BigInt(rowsB[0]!.cr));
    expect(BigInt(rowsB[0]!.dr)).toBe(80000n);
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
