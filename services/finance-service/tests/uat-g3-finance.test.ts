/**
 * UAT g3 regression tests (finance-service):
 *  #1  migration 0155 adds gl.finance_period_close.created_by idempotently, so period-close / journals stop 500ing
 *  #16 sample bills use stage values that satisfy finance_bills_stage_check
 */
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db } from "../src/shared/db.js";
import { financeHeads } from "../src/modules/budget/schema.js";
import { seedSampleBills, clearSampleBills, countSampleBills, NoBudgetHeadError } from "../src/modules/payments/repo.js";

class Rollback extends Error {}

describe("#1 migration 0155_period_close_created_by", () => {
  const migration = readFileSync(fileURLToPath(new URL("../migrations/0155_period_close_created_by.sql", import.meta.url)), "utf8");

  it("is additive + idempotent and never touches money columns", () => {
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS created_by uuid/i);
    expect(migration).not.toMatch(/\*\s*100|DROP\s+COLUMN\s+(?!IF)/i);
  });

  it("repairs a table that lost created_by: the column exists afterwards and re-running is a no-op", async () => {
    await expect(db.transaction(async (tx) => {
      await tx.execute(sql.raw("ALTER TABLE gl.finance_period_close DROP COLUMN IF EXISTS created_by"));
      const before = await tx.execute(sql`SELECT 1 FROM information_schema.columns WHERE table_schema='gl' AND table_name='finance_period_close' AND column_name='created_by'`);
      expect((before as unknown as unknown[]).length).toBe(0);
      await tx.execute(sql.raw(migration));
      await tx.execute(sql.raw(migration));
      const after = await tx.execute(sql`SELECT 1 FROM information_schema.columns WHERE table_schema='gl' AND table_name='finance_period_close' AND column_name='created_by'`);
      expect((after as unknown as unknown[]).length).toBe(1);
      throw new Rollback();
    })).rejects.toThrow(Rollback);
  });
});

describe("#16 sample bills respect finance_bills_stage_check", () => {
  it("seedSampleBills inserts on an existing head without violating stage/status/FK checks, and clearSampleBills removes them", async () => {
    const tenant = randomUUID();
    const actor = randomUUID();
    await runWithTenant(tenant, async () => {
      await db.transaction(async (tx) => {
        await tx.insert(financeHeads).values({ id: randomUUID(), tenantId: tenant, code: "UATTEST-G3", name: "UATTEST head", level: 0, createdBy: actor, updatedBy: actor });
      });
      expect(await seedSampleBills(tenant, actor)).toBe(3);
      expect(await countSampleBills(tenant)).toBe(3);
      expect(await clearSampleBills(tenant)).toBe(3);
      await db.transaction(async (tx) => { await tx.delete(financeHeads).where(sql`tenant_id = ${tenant}`); });
    });
  });

  it("fails with a typed NoBudgetHeadError (mapped to 422) when the tenant has no head, instead of an FK 500", async () => {
    const tenant = randomUUID();
    await runWithTenant(tenant, async () => {
      await expect(seedSampleBills(tenant, randomUUID())).rejects.toBeInstanceOf(NoBudgetHeadError);
    });
  });
});
