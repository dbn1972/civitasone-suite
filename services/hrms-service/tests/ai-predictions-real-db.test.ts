/**
 * AI Predictions module — real-DB regression test (no mocks).
 *
 * GET /v1/hrms/ai/attrition-risk, /v1/hrms/ai/succession and
 * /v1/hrms/ai/leave-prediction all 500'd for EVERY role, including
 * super_admin, because their queries referenced tables that never existed:
 * employee.apar_records (attrition-risk, succession) and
 * employee.hrms_leave_apps (leave-prediction — also missing/renamed columns
 * once the schema prefix itself is fixed). See routes.ts's inline comments
 * on each fixed query for the full analysis of what the real tables
 * (appraisal.hrms_appraisals/hrms_apar_scores, leave.hrms_leave_apps) look
 * like and why the query logic (not just the table name) had to change.
 *
 * This module had zero test coverage before this file (it's excluded from
 * the coverage gate — see vitest.config.ts's "AI/ML modules not under test"
 * — which is exactly how a wrong-table-reference 500 shipped and stayed
 * invisible). A mocked-DB test would assert whatever shape the mock hands
 * back and could never have caught a wrong table/column reference either —
 * same rationale as tests/apar-identity-resolution.test.ts — so this seeds
 * real rows into a real Postgres (fresh random tenant per run for hermetic
 * isolation) and drives the actual HTTP routes end-to-end with app.inject,
 * no mocks anywhere. Per REL-035 (vitest.config.ts), DATABASE_URL must point
 * at your own disposable Postgres when running this outside CI — it no
 * longer silently falls back to the shared dev instance.
 *
 * Beyond "does it 200": fixtures give one employee a strong, real APAR
 * history + long tenure (should rank as a succession candidate, should NOT
 * be flagged as attrition risk) and another a <2yr tenure with no APAR
 * history at all (should be flagged as attrition risk). A query that runs
 * without crashing but silently returns meaningless data — e.g. joining the
 * wrong column, or not excluding ungraded appraisals — would still be
 * caught by the score assertions below, not just a bare status-code check.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { withTenantScope } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db } from "../src/shared/db.js";
import { hrmsEmployees, hrmsDepartments, hrmsDesignations } from "../src/modules/employee/schema.js";
import { hrmsAppraisals } from "../src/modules/appraisals/schema.js";
import { hrmsAparScores } from "../src/modules/apar/schema.js";
import { hrmsLeaveApps } from "../src/modules/leave/schema.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
// Fresh tenant per run: every query under test is tenant-scoped (RLS +
// WHERE tenant_id = ...), so this gives hermetic isolation from any other
// data in whatever Postgres DATABASE_URL points at, without needing
// explicit cleanup — same convention apar-identity-resolution.test.ts uses.
const TENANT = randomUUID();
const ACTOR = randomUUID();

function auth(roles: string[]): { authorization: string } {
  const jwt = signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-ai-predictions" }, SECRET, 3600);
  return { authorization: `Bearer ${jwt}` };
}

let app: FastifyInstance;
let deptId: string;
let strongEmployeeId: string; // long tenure, 3 strong finalised APARs -> succession candidate, NOT attrition risk
let weakEmployeeId: string;   // <2yr tenure, zero APAR history -> attrition risk, heavy upcoming-month leave history

beforeAll(async () => {
  app = await buildApp();

  await withTenantScope(db, TENANT, async (tx) => {
    deptId = randomUUID();
    await tx.insert(hrmsDepartments).values({
      id: deptId, tenantId: TENANT, code: "ENG", name: "Engineering",
      createdBy: ACTOR, updatedBy: ACTOR,
    });

    const desigSeniorId = randomUUID(); // level 5 — succession's target position ("dg.level >= 5")
    const desigJuniorId = randomUUID(); // level 4 — one level below target ("BETWEEN target-2 AND target-1")
    await tx.insert(hrmsDesignations).values([
      { id: desigSeniorId, tenantId: TENANT, code: "DIR", name: "Director", level: 5, createdBy: ACTOR, updatedBy: ACTOR },
      { id: desigJuniorId, tenantId: TENANT, code: "MGR", name: "Manager", level: 4, createdBy: ACTOR, updatedBy: ACTOR },
    ]);

    strongEmployeeId = randomUUID();
    weakEmployeeId = randomUUID();
    await tx.insert(hrmsEmployees).values([
      // Incumbent in the level-5 target position, so succession's
      // target_positions CTE has a row to work from.
      {
        id: randomUUID(), tenantId: TENANT, employeeNo: "ENG-INCUMBENT", fullName: "Incumbent Director",
        departmentId: deptId, designationId: desigSeniorId, dateOfJoining: "2010-01-01",
        status: "confirmed", createdBy: ACTOR, updatedBy: ACTOR,
      },
      {
        id: strongEmployeeId, tenantId: TENANT, employeeNo: "ENG-STRONG", fullName: "Strong Performer",
        departmentId: deptId, designationId: desigJuniorId, dateOfJoining: "2012-01-01",
        status: "confirmed", createdBy: ACTOR, updatedBy: ACTOR,
      },
      {
        id: weakEmployeeId, tenantId: TENANT, employeeNo: "ENG-WEAK", fullName: "New Joiner",
        departmentId: deptId, designationId: desigJuniorId,
        dateOfJoining: new Date(Date.now() - 180 * 24 * 3600 * 1000).toISOString().slice(0, 10),
        status: "confirmed", createdBy: ACTOR, updatedBy: ACTOR,
      },
    ]);

    // strongEmployee: 3 finalised, high (9/10) APAR appraisals across the
    // last 3 cycles -> real overall_grade rows for the fixed query to find.
    for (const period of ["2023-24", "2024-25", "2025-26"]) {
      const appraisalId = randomUUID();
      await tx.insert(hrmsAppraisals).values({
        id: appraisalId, tenantId: TENANT, employeeId: strongEmployeeId, appraisalPeriod: period,
        status: "completed", overallGrade: "9.0", overallBand: "Outstanding",
        createdBy: ACTOR, updatedBy: ACTOR,
      });
      await tx.insert(hrmsAparScores).values({
        id: randomUUID(), tenantId: TENANT, appraisalId, attribute: "overall",
        weight: "1", score: 9, scoredBy: ACTOR, createdBy: ACTOR, updatedBy: ACTOR,
      });
    }
    // weakEmployee has zero appraisal rows at all (never appraised yet —
    // COALESCE's "no score on record" default path).

    // weakEmployee: approved leave in the same calendar month as "next
    // month", across all 3 years in the lookback window, so
    // leave-prediction's real query against leave.hrms_leave_apps
    // (from_date/to_date/days_applied — not start_date/end_date) has real
    // historical rows to average.
    const nextMonth = new Date();
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    const mm = String(nextMonth.getMonth() + 1).padStart(2, "0");
    for (const y of [2023, 2024, 2025]) {
      await tx.insert(hrmsLeaveApps).values({
        id: randomUUID(), tenantId: TENANT, employeeId: weakEmployeeId,
        leaveTypeId: randomUUID(), allocId: randomUUID(),
        fromDate: `${y}-${mm}-10`, toDate: `${y}-${mm}-14`, daysApplied: 5,
        status: "approved", createdBy: ACTOR, updatedBy: ACTOR,
      });
    }
  });
});

afterAll(async () => {
  await app.close();
});

describe("GET /v1/hrms/ai/attrition-risk (real DB)", () => {
  it("200s for super_admin and gives the new joiner a materially higher score than the tenured performer", async () => {
    const r = await app.inject({
      method: "GET", url: "/v1/hrms/ai/attrition-risk?minScore=0&limit=100",
      headers: auth(["super_admin"]),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(Array.isArray(body.data)).toBe(true);

    const weakRow = body.data.find((row: { id: string }) => row.id === weakEmployeeId);
    const strongRow = body.data.find((row: { id: string }) => row.id === strongEmployeeId);
    expect(weakRow).toBeTruthy();
    expect(strongRow).toBeTruthy();

    // weakEmployee: tenure < 2yr (+40) + real overall_grade absent so the
    // APAR term falls back to its default 70, which is not < 60 (+0).
    // strongEmployee: tenure > 2yr (+0) + real overall_grade 9.0 * 10 = 90,
    // not < 60 (+0).
    // Both also pick up the SAME constant +30 from the existing
    // "no promotion in 3yr" NOT EXISTS subquery, which self-joins
    // hrms_employees to itself by id and so can never see a prior
    // designation to compare against — it is unconditionally true for every
    // row. That is a pre-existing logic bug independent of the
    // table-reference bugs this PR fixes; flagged separately, not changed
    // here. It nets out as a wash between the two rows either way (applies
    // equally to both), which is why the *relative* comparison below is the
    // meaningful assertion rather than either absolute number.
    expect(weakRow.risk_score).toBe(70);
    expect(strongRow.risk_score).toBe(30);
    expect(weakRow.risk_score).toBeGreaterThan(strongRow.risk_score);
  });

  it("200s for hr_officer too, not just super_admin", async () => {
    const r = await app.inject({
      method: "GET", url: "/v1/hrms/ai/attrition-risk",
      headers: auth(["hr_officer"]),
    });
    expect(r.statusCode).toBe(200);
  });
});

describe("GET /v1/hrms/ai/succession (real DB)", () => {
  it("200s for super_admin and ranks the real, high-APAR candidate above the ungraded one", async () => {
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/ai/succession?departmentId=${deptId}`,
      headers: auth(["super_admin"]),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.data.length).toBeGreaterThan(0);

    const strong = body.data.find((row: { candidate_id: string }) => row.candidate_id === strongEmployeeId);
    expect(strong).toBeTruthy();
    // avg_apar_score is the real overall_grade (9.0 on a 1..10 scale)
    // projected ×10 -> 90, not the old nonexistent apar_records.score.
    expect(Number(strong.avg_apar_score)).toBeCloseTo(90, 0);
    expect(Number(strong.suitability_score)).toBeGreaterThan(80);

    const weak = body.data.find((row: { candidate_id: string }) => row.candidate_id === weakEmployeeId);
    if (weak) {
      expect(Number(weak.avg_apar_score)).toBe(0); // COALESCE default, no appraisal rows at all
      expect(Number(strong.suitability_score)).toBeGreaterThan(Number(weak.suitability_score));
    }
  });

  it("200s for manager too, not just super_admin", async () => {
    const r = await app.inject({
      method: "GET", url: "/v1/hrms/ai/succession",
      headers: auth(["manager"]),
    });
    expect(r.statusCode).toBe(200);
  });
});

describe("GET /v1/hrms/ai/leave-prediction (real DB)", () => {
  it("200s for super_admin and predicts next month's leave from 3 years of real leave.hrms_leave_apps history", async () => {
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/ai/leave-prediction?departmentId=${deptId}`,
      headers: auth(["super_admin"]),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json().data;
    // historical groups by (employee_id, EXTRACT(MONTH FROM from_date)) --
    // month-of-year only, not year -- so weakEmployee's 3 same-month
    // applications (one per seeded year, 2023/2024/2025) collapse into a
    // single row: leave_count=3 total applications, total_days=15 (5 days
    // each). Only weakEmployee has data in this calendar month, so the
    // outer AVG (across employees) just reflects that one row as-is.
    expect(body.prediction.avg_leave_applications).toBeCloseTo(3, 1);
    expect(body.prediction.avg_leave_days).toBeCloseTo(15, 1);
    expect(body.prediction.employees_with_history).toBeGreaterThanOrEqual(1);
    expect(body.confidence).toBe("medium");
  });

  it("200s for hr_admin too, not just super_admin", async () => {
    const r = await app.inject({
      method: "GET", url: "/v1/hrms/ai/leave-prediction",
      headers: auth(["hr_admin"]),
    });
    expect(r.statusCode).toBe(200);
  });
});
