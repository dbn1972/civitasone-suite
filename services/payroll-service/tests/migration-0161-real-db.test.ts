/**
 * UAT L2-N3 review (PR #2454 BLOCKER): migration 0161 backfills runs the old
 * code left at "processing" after their computation finished. Real Postgres, run
 * as payroll_svc (NOBYPASSRLS, FORCE RLS) exactly as the migration runner does,
 * inside a transaction that is rolled back at the end, so no other tenant's rows
 * are changed by this test.
 *
 *  - finished (updated_at > created_at) version-1 run WITH slips -> computed;
 *  - finished version-1 run with NO slips -> failed, "no payslips computed (migration 0161)";
 *  - finished version-2 run with slips -> computed;
 *  - never-computed run (updated_at = created_at, version 1) -> stays processing;
 *  - approved / failed runs untouched;
 *  - the NOTICE carries the per-status counts; a second application moves nothing.
 */
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import postgres from "postgres";

const MIGRATION = readFileSync(new URL("../migrations/0161_payroll_run_computed_status.sql", import.meta.url), "utf8");
const ROLLBACK = new Error("rollback (test)");

describe("migration 0161: processing runs the old code finished", () => {
  it("moves finished runs with slips to computed, finished zero-slip runs to failed, leaves never-computed runs, and is idempotent", async () => {
    const notices: string[] = [];
    const client = postgres(process.env.DATABASE_URL as string, { max: 1, onnotice: (n) => notices.push(String(n.message)) });
    const tenant = randomUUID();
    const actor = randomUUID();
    const ids = {
      v1WithSlips: randomUUID(), v1NoSlips: randomUUID(), v2WithSlips: randomUUID(),
      neverComputed: randomUUID(), approved: randomUUID(), failed: randomUUID(),
    };
    type Row = { id: string; status: string; last_error: string | null };
    let first: Row[] = [];
    let second: Row[] = [];
    try {
      await client.begin(async (tx) => {
        const asTenant = () => tx`SELECT set_config(${"app.tenant_id"}, ${tenant}, true)`;
        await asTenant();
        const seed = async (id: string, month: string, status: string, version: number, finished: boolean, slips: number) => {
          await tx`INSERT INTO payroll.payroll_runs (id, tenant_id, run_no, month, structure_id, run_type, status, version, created_at, updated_at, created_by, updated_by)
            VALUES (${id}, ${tenant}, ${"MIG0161-" + month}, ${month}, ${randomUUID()}, ${"supplementary"}, ${status}, ${version},
                    ${"2026-10-01T10:00:00Z"}, ${finished ? "2026-10-01T10:05:00Z" : "2026-10-01T10:00:00Z"}, ${actor}, ${actor})`;
          for (let i = 0; i < slips; i += 1) {
            await tx`INSERT INTO payroll.payroll_slips (id, tenant_id, run_id, employee_id, employee_no, created_by, updated_by)
              VALUES (${randomUUID()}, ${tenant}, ${id}, ${randomUUID()}, ${"MIG-" + i}, ${actor}, ${actor})`;
          }
        };
        await seed(ids.v1WithSlips, "2026-01", "processing", 1, true, 2);
        await seed(ids.v1NoSlips, "2026-02", "processing", 1, true, 0);
        await seed(ids.v2WithSlips, "2026-03", "processing", 2, true, 1);
        await seed(ids.neverComputed, "2026-04", "processing", 1, false, 0);
        await seed(ids.approved, "2026-05", "approved", 1, true, 1);
        await seed(ids.failed, "2026-06", "failed", 1, true, 0);

        const read = async () => { await asTenant(); return (await tx<Row[]>`SELECT id::text AS id, status, last_error FROM payroll.payroll_runs WHERE tenant_id = ${tenant}`); };
        await tx.unsafe(MIGRATION);
        first = await read();
        await tx.unsafe(MIGRATION);
        second = await read();
        throw ROLLBACK;
      });
    } catch (e) {
      if (e !== ROLLBACK) throw e;
    } finally {
      await client.end();
    }

    const byId = (rows: Row[]) => Object.fromEntries(rows.map((r) => [r.id, r]));
    const a = byId(first);
    expect(a[ids.v1WithSlips]).toMatchObject({ status: "computed", last_error: null });
    expect(a[ids.v2WithSlips]).toMatchObject({ status: "computed", last_error: null });
    expect(a[ids.v1NoSlips]).toMatchObject({ status: "failed", last_error: "no payslips computed (migration 0161)" });
    expect(a[ids.neverComputed]).toMatchObject({ status: "processing", last_error: null });
    expect(a[ids.approved]?.status).toBe("approved");
    expect(a[ids.failed]).toMatchObject({ status: "failed", last_error: null });
    // Idempotent: the second application changes nothing.
    expect(byId(second)).toEqual(a);
    // NOTICE: counts per target status (no ids, no names). The first application
    // moved at least this tenant's rows; the second moved nothing anywhere.
    const counts = notices.filter((n) => n.startsWith("0161 payroll run backfill:")).map((n) => n.match(/(\d+) processing -> computed, (\d+) processing -> failed/)!.slice(1).map(Number));
    expect(counts).toHaveLength(2);
    expect(counts[0]![0]).toBeGreaterThanOrEqual(2);
    expect(counts[0]![1]).toBeGreaterThanOrEqual(1);
    expect(counts[1]).toEqual([0, 0]);
    for (const n of notices) expect(n).not.toContain(tenant);
  });
});
