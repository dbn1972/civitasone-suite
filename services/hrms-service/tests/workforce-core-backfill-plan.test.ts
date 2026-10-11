/**
 * Workforce Core backfill — planner unit tests (SmartTransfer OS, ST-M01-08).
 *
 * Pure-logic coverage with a stub SqlClient (no DB) for the source-row shapes a
 * seeded real DB cannot easily produce — an employee with no department_id or
 * no date_of_joining (both NOT NULL in employee.hrms_employees), a duplicate
 * employee row, and the office-less reservation-fragment branch — plus the
 * human-summary renderer. The real-Postgres proof lives in
 * tests/workforce-core-backfill-real-db.test.ts.
 */
import { describe, it, expect } from "vitest";
import {
  planBackfill,
  renderHumanSummary,
  deterministicId,
  type SqlClient,
  type BackfillReport,
} from "../src/modules/workforce-core/backfill.js";

/** A stub SqlClient that returns canned rows per source table. */
function stub(rows: {
  plans?: Array<Record<string, unknown>>;
  sposts?: Array<Record<string, unknown>>;
  emps?: Array<Record<string, unknown>>;
}): SqlClient {
  return {
    async unsafe(query: string): Promise<Array<Record<string, unknown>>> {
      if (/from manpower\.plans/i.test(query)) return rows.plans ?? [];
      if (/from reservation\.hrms_sanctioned_posts/i.test(query)) return rows.sposts ?? [];
      if (/from employee\.hrms_employees/i.test(query)) return rows.emps ?? [];
      // set_config / counts / txid: harmless defaults
      return [];
    },
  };
}

const T = "11111111-1111-1111-1111-111111111111";

describe("planBackfill — employee mapping edge cases", () => {
  it("flags employees with no department and no date_of_joining", async () => {
    const sql = stub({
      emps: [
        { id: "aaaaaaaa-0000-0000-0000-000000000001", department_id: null, date_of_joining: "2020-01-01", status: "active" },
        { id: "aaaaaaaa-0000-0000-0000-000000000002", department_id: "dept-1", date_of_joining: null, status: "active" },
        { id: "aaaaaaaa-0000-0000-0000-000000000003", department_id: "dept-1", date_of_joining: "2020-01-01", status: "active" },
      ],
    });
    const plan = await planBackfill({ sql, tenantId: T, apply: false });
    expect(plan.ledger.length).toBe(1); // only the third
    expect(plan.unmapped.filter((u) => u.source === "employee").length).toBe(2);
    expect(plan.unmapped.some((u) => /no department_id/.test(u.reason))).toBe(true);
    expect(plan.unmapped.some((u) => /no date_of_joining/.test(u.reason))).toBe(true);
  });

  it("reports a duplicate employee row as an overlap conflict", async () => {
    const sql = stub({
      emps: [
        { id: "aaaaaaaa-0000-0000-0000-000000000009", department_id: "dept-1", date_of_joining: "2020-01-01", status: "active" },
        { id: "aaaaaaaa-0000-0000-0000-000000000009", department_id: "dept-2", date_of_joining: "2021-01-01", status: "active" },
      ],
    });
    const plan = await planBackfill({ sql, tenantId: T, apply: false });
    expect(plan.ledger.length).toBe(1);
    expect(plan.conflicts.some((c) => c.kind === "employee_overlap")).toBe(true);
  });

  it("ledger id is deterministic per (tenant, employee)", async () => {
    const sql = stub({ emps: [{ id: "e1", department_id: "d1", date_of_joining: "2020-01-01", status: "active" }] });
    const plan = await planBackfill({ sql, tenantId: T, apply: false });
    expect(plan.ledger[0].id).toBe(deterministicId(`ledger:${T}:e1`));
  });
});

describe("planBackfill — positions path", () => {
  it("skips inactive / office-less positions and maps active ones", async () => {
    const plan = await planBackfill({
      sql: stub({}),
      tenantId: T,
      apply: false,
      tenantPositions: [
        { id: "p1", orgUnitId: "o1", code: "C1", title: "A", grade: "L4", status: "active" },
        { id: "p2", orgUnitId: null, code: "C2", title: "B", grade: null, status: "active" },
        { id: "p3", orgUnitId: "o1", code: "C3", title: "C", grade: null, status: "inactive" },
      ],
    });
    expect(plan.posts.length).toBe(1);
    expect(plan.posts[0].postNo).toBe("POS-C1");
    expect(plan.posts[0].source).toBe("tenant.positions");
    expect(plan.unmapped.filter((u) => u.source === "tenant.positions").length).toBe(2);
  });
});

describe("renderHumanSummary", () => {
  it("prints a clean verdict when there are no conflicts", () => {
    const report: BackfillReport = {
      tenantId: T,
      mode: "dry-run",
      generatedAt: new Date().toISOString(),
      ledgerFlagEnabled: false,
      rowsRead: { manpowerPlans: 1, sanctionedPosts: 0, tenantPositions: 1, employees: 2 },
      postsPlanned: 2,
      ledgerPlanned: 2,
      occupancyPlanned: 2,
      postsWritten: 0,
      ledgerWritten: 0,
      occupancyWritten: 0,
      unmapped: [],
      conflicts: [],
      proof: { readOnly: true, txidBefore: null, txidAfter: null, rowCountsBefore: { a: 0 }, rowCountsAfter: { a: 0 } },
    };
    const s = renderHumanSummary(report);
    expect(s).toContain("backfill dry run is clean");
    expect(s).toContain("DRY RUN — wrote nothing");
    expect(s).toContain("row counts unchanged=true");
  });

  it("flags conflicts in the verdict", () => {
    const report: BackfillReport = {
      tenantId: T,
      mode: "dry-run",
      generatedAt: new Date().toISOString(),
      ledgerFlagEnabled: false,
      rowsRead: { manpowerPlans: 0, sanctionedPosts: 0, tenantPositions: 0, employees: 0 },
      postsPlanned: 0,
      ledgerPlanned: 0,
      occupancyPlanned: 0,
      postsWritten: 0,
      ledgerWritten: 0,
      occupancyWritten: 0,
      unmapped: [],
      conflicts: [{ kind: "duplicate_post_no", ref: "POS-X", detail: "dup" }],
      proof: { readOnly: true, txidBefore: null, txidAfter: null, rowCountsBefore: {}, rowCountsAfter: {} },
    };
    expect(renderHumanSummary(report)).toContain("conflicts present");
  });
});
