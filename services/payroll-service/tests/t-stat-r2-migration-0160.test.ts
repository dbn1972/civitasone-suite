/**
 * T-STAT review of PR #2449, SHOULD-FIX 6: migration 0160 is additive, so it
 * can be applied before (or slightly before) the new code without breaking the
 * code still running: the old revision-arrears unique index that the previous
 * code targets with ON CONFLICT is kept, nothing is dropped.
 */
import { describe, it, expect, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { db, sqlClient } from "../src/shared/db.js";

afterAll(async () => { await sqlClient.end(); });
const file = readFileSync(join(__dirname, "..", "migrations", "0160_arrears_due_minus_drawn.sql"), "utf8");
const statements = file.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

describe("migration 0160 is additive", () => {
  it("drops no index and no column", () => {
    expect(statements).not.toMatch(/DROP\s+INDEX/i);
    expect(statements).not.toMatch(/DROP\s+COLUMN/i);
    expect(statements).not.toMatch(/DROP\s+TABLE/i);
  });

  it("the old revision index the previous code relies on and the new one both exist", async () => {
    const rows = (await db.execute(sql`
      SELECT indexname FROM pg_indexes WHERE schemaname = ${"payroll"} AND tablename = ${"payroll_arrears"} ORDER BY indexname`)) as unknown as Array<{ indexname: string }>;
    const names = rows.map((r) => r.indexname);
    expect(names).toContain("ux_payroll_arrears_revision_period");
    expect(names).toContain("ux_payroll_arrears_dmd_settled");
    expect(names).toContain("ix_payroll_arrears_tenant_emp_period");
  });
});
