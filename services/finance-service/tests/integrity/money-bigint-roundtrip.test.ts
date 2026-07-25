/**
 * Phase-4 Data Integrity — Check #2 (finance round-trip): exact paise preserved.
 *
 * Money is stored as bigint minor units. This test writes a precise paise value
 * through the persistence layer and reads it back, asserting exact BigInt
 * equality and bigint runtime type — proving no float/Number() coercion loses
 * precision on the finance money path. Complements the cross-DB column-type
 * audit in tests/data-integrity/money-column-types.test.ts.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db, sqlClient } from "../../src/shared/db.js";
import { financeLedger } from "../../src/modules/gl/schema.js";
import { financeHeads } from "../../src/modules/budget/schema.js";
import { scoped } from "../_tenant.js";

const TENANT = "c2222222-aaaa-4000-8000-000000000004";
const ACTOR = "00000000-aaaa-4000-8000-0000000000cd";
const HEAD_ID = randomUUID();

// Exact paise amount from the Phase-4 spec.
const EXACT_PAISE = 123456789n;
// A value above 2^53 that is not float64-representable, to catch Number() coercion.
const ABOVE_2_53 = 9_007_199_254_740_993n;

async function seedHead() {
  await scoped(TENANT, (tx) =>
    tx
      .insert(financeHeads)
      .values({
        id: HEAD_ID,
        tenantId: TENANT,
        code: "P4-BIGINT-HEAD",
        name: "Phase-4 Bigint Round-trip Head",
        level: 1,
        createdBy: ACTOR,
        updatedBy: ACTOR,
      })
      .onConflictDoNothing(),
  );
}

afterAll(async () => {
  await db
    .execute(sql`DELETE FROM gl.finance_ledger WHERE tenant_id = ${TENANT}::uuid`)
    .catch(() => {});
  await db.delete(financeHeads).where(eq(financeHeads.id, HEAD_ID)).catch(() => {});
  await sqlClient.end();
});

describe("Check #2 — exact paise round-trip (bigint, no precision loss)", () => {
  it("persists and reads back 123456789 paise exactly", async () => {
    await seedHead();
    const id = randomUUID();
    await scoped(TENANT, (tx) =>
      tx.insert(financeLedger).values({
        id,
        tenantId: TENANT,
        headId: HEAD_ID,
        debitMinor: EXACT_PAISE,
        creditMinor: 0n,
        balanceMinor: EXACT_PAISE,
        voucherNo: `P4-EXACT-${id.slice(0, 8)}`,
        postingDate: "2024-04-01",
        currency: "INR",
        createdBy: ACTOR,
        updatedBy: ACTOR,
      }),
    );
    const [row] = await scoped(TENANT, (tx) =>
      tx.select().from(financeLedger).where(eq(financeLedger.id, id)).limit(1),
    );
    expect(row).toBeDefined();
    expect(row!.debitMinor).toBe(EXACT_PAISE);
    expect(row!.balanceMinor).toBe(EXACT_PAISE);
    expect(typeof row!.debitMinor).toBe("bigint");
  });

  it("preserves a value above 2^53 that float64 cannot represent", async () => {
    await seedHead();
    const id = randomUUID();
    await scoped(TENANT, (tx) =>
      tx.insert(financeLedger).values({
        id,
        tenantId: TENANT,
        headId: HEAD_ID,
        debitMinor: ABOVE_2_53,
        creditMinor: 0n,
        balanceMinor: ABOVE_2_53,
        voucherNo: `P4-BIG-${id.slice(0, 8)}`,
        postingDate: "2024-04-01",
        currency: "INR",
        createdBy: ACTOR,
        updatedBy: ACTOR,
      }),
    );
    const [row] = await scoped(TENANT, (tx) =>
      tx.select().from(financeLedger).where(eq(financeLedger.id, id)).limit(1),
    );
    expect(row!.debitMinor).toBe(ABOVE_2_53);
    // Prove Number() would have corrupted it (loses the last bit).
    expect(BigInt(Number(ABOVE_2_53))).not.toBe(ABOVE_2_53);
  });
});
