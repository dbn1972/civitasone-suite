/**
 * Bigint Precision Round-Trip Test
 *
 * Verifies that amounts exceeding Number.MAX_SAFE_INTEGER (2^53) survive a
 * round-trip through PostgreSQL without precision loss. CivitasOne stores all
 * monetary values as bigint minor units (paise). ₹500 crore = 50_000_000_000_000
 * paise, which is above 2^53 and would silently truncate if coerced via Number().
 *
 * This test inserts into gl.finance_ledger, reads back, and asserts exact
 * BigInt equality — catching any accidental Number() coercion in the ORM layer.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db, sqlClient } from "../src/shared/db.js";
import { financeLedger } from "../src/modules/gl/schema.js";
import { financeHeads } from "../src/modules/budget/schema.js";
import { scoped } from "./_tenant.js";

const TENANT = "c1111111-aaaa-4000-8000-000000000002";
const ACTOR = "00000000-aaaa-4000-8000-0000000000ab";
const HEAD_ID = randomUUID();

// 2^53 = 9_007_199_254_740_992. Use 10_000_000_000_000_000 (₹1,00,000 crore = 1e16 paise)
const ABOVE_SAFE_INTEGER = 10_000_000_000_000_000n; // 1e16 paise = ₹1,00,000 crore

async function seedHead() {
  // We need a head_id to satisfy the FK / logical reference in the ledger.
  // Use onConflictDoNothing for idempotency across reruns.
  await scoped(TENANT, (tx) => tx.insert(financeHeads).values({
    id: HEAD_ID,
    tenantId: TENANT,
    code: "BIGINT-TEST-HEAD",
    name: "Bigint Precision Test Head",
    level: 1,
    createdBy: ACTOR,
    updatedBy: ACTOR,
  }).onConflictDoNothing());
}

async function clean() {
  // The ledger is append-only (trigger blocks DELETE), so we bypass with raw SQL
  // that temporarily disables the trigger for test cleanup.
  await db.execute(sql`
    DELETE FROM gl.finance_ledger WHERE tenant_id = ${TENANT}::uuid
  `).catch(() => { /* ignore if trigger blocks — test rows are tenant-scoped */ });
  await db.delete(financeHeads).where(eq(financeHeads.id, HEAD_ID)).catch(() => {});
}

afterAll(async () => {
  await clean();
  await sqlClient.end();
});

describe("Bigint Precision — GL Ledger round-trip", () => {
  it("inserts and reads back an amount above 2^53 without precision loss", async () => {
    await seedHead();

    // Use a fresh ID each run to avoid conflicts with append-only ledger
    const testLedgerId = randomUUID();

    // Insert a ledger line with a debitMinor above Number.MAX_SAFE_INTEGER
    await scoped(TENANT, (tx) => tx.insert(financeLedger).values({
      id: testLedgerId,
      tenantId: TENANT,
      headId: HEAD_ID,
      debitMinor: ABOVE_SAFE_INTEGER,
      creditMinor: 0n,
      balanceMinor: ABOVE_SAFE_INTEGER,
      voucherNo: `BIGINT-TEST-V001-${testLedgerId.slice(0, 8)}`,
      postingDate: "2024-04-01",
      currency: "INR",
      createdBy: ACTOR,
      updatedBy: ACTOR,
    }));

    // Read it back
    const rows = await scoped(TENANT, (tx) => tx.select().from(financeLedger).where(eq(financeLedger.id, testLedgerId)).limit(1));

    expect(rows.length).toBe(1);
    const row = rows[0]!;

    // The critical assertion: BigInt equality, not Number equality
    expect(row.debitMinor).toBe(ABOVE_SAFE_INTEGER);
    expect(row.balanceMinor).toBe(ABOVE_SAFE_INTEGER);
    expect(row.creditMinor).toBe(0n);

    // Verify it's actually a bigint type (not silently coerced to number)
    expect(typeof row.debitMinor).toBe("bigint");
    expect(typeof row.balanceMinor).toBe("bigint");
  });

  it("preserves precision for an odd value above 2^53 (not exactly representable as float64)", async () => {
    // 2^53 + 1 = 9_007_199_254_740_993 — NOT exactly representable as Number
    const ODD_ABOVE_SAFE = 9_007_199_254_740_993n;
    const oddId = randomUUID();

    await seedHead();

    await scoped(TENANT, (tx) => tx.insert(financeLedger).values({
      id: oddId,
      tenantId: TENANT,
      headId: HEAD_ID,
      debitMinor: ODD_ABOVE_SAFE,
      creditMinor: 0n,
      balanceMinor: ODD_ABOVE_SAFE,
      voucherNo: "BIGINT-TEST-V002",
      postingDate: "2024-04-01",
      currency: "INR",
      createdBy: ACTOR,
      updatedBy: ACTOR,
    }));

    const rows = await scoped(TENANT, (tx) => tx.select().from(financeLedger).where(eq(financeLedger.id, oddId)).limit(1));

    expect(rows.length).toBe(1);
    const row = rows[0]!;

    // This is the REAL precision test: Number(9007199254740993) === 9007199254740992
    // If the ORM used Number() anywhere in the pipeline, this would fail.
    expect(row.debitMinor).toBe(ODD_ABOVE_SAFE);
    expect(row.balanceMinor).toBe(ODD_ABOVE_SAFE);
    expect(typeof row.debitMinor).toBe("bigint");

    // Prove Number() would corrupt this value:
    // Number(9007199254740993n) rounds to 9007199254740992 (loses the last bit)
    const asNumber = Number(ODD_ABOVE_SAFE);
    expect(BigInt(asNumber)).not.toBe(ODD_ABOVE_SAFE);
  });
});
