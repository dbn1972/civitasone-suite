/**
 * GET /v1/hrms/staffing-plan -- real-DB regression test for the
 * GAP-HR-STAFFING-PLAN-01/02/03/04/05 fix cluster (gap-features/routes.ts's
 * staffing-plan handler only -- this file deliberately does not touch any
 * other handler in that shared file).
 *
 * Named staffing-plan.routes.test.ts (not the generic routes.test.ts) on
 * purpose: gap-features/routes.ts is being edited concurrently by sibling
 * fixers for certifications/expenses/salary-structure, and a shared generic
 * test filename would be a likely collision point across those parallel
 * PRs.
 *
 * manpower.plans and employee.hrms_departments both carry FORCE ROW LEVEL
 * SECURITY (tenant_isolation policy keyed off manpower.current_tenant_id() /
 * the equivalent employee-schema helper), so every direct seed/read/cleanup
 * query here goes through withRawTenantGuc, same as
 * hrms-claims-schema-real-db.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { withRawTenantGuc } from "@civitasone/db";
import { buildApp } from "../../app.js";
import { sqlClient } from "../../shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "dddddddd-0860-4000-8000-000000000860";
const ACTOR_ID = "dddddddd-0860-4000-8000-0000000000c1";
const DEPT_ID = "dddddddd-0860-4000-8000-0000000000d1";
const NO_DEPT_UNIT_ID = randomUUID(); // never inserted into hrms_departments -- simulates an unresolvable unit link

function tok(roles: string[]) {
  return signToken({ sub: ACTOR_ID, tid: TENANT, roles, sid: "sess-staffing-plan-test" }, SECRET);
}

const hrToken = tok(["hr_admin"]);
// GAP-HR-STAFFING-PLAN-04: a role the broader /hr layout gate admits to the
// page shell (apps/web's workRoles.ts HR_ROLES) but this endpoint's own
// backend guard does not.
const managerToken = tok(["manager"]);

let app: Awaited<ReturnType<typeof buildApp>>;

function asTenant<T>(fn: (tx: typeof sqlClient) => Promise<T>): Promise<T> {
  return withRawTenantGuc(sqlClient, TENANT, fn);
}

async function cleanup(): Promise<void> {
  await asTenant((tx) => tx`DELETE FROM manpower.plans WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_departments WHERE tenant_id = ${TENANT}`);
}

async function seed(): Promise<void> {
  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_departments (id, tenant_id, code, name, created_by, updated_by)
    VALUES (${DEPT_ID}, ${TENANT}, 'FIN', 'Finance', ${ACTOR_ID}, ${ACTOR_ID})
  `);

  // 2025 / Finance / Clerk -- approved, sanctioned 80 filled 70 -> exactly
  // 87.5% (GAP-HR-STAFFING-PLAN-01's own worked example). approved_at wins
  // over submitted_at in the COALESCE (GAP-02).
  await asTenant((tx) => tx`
    INSERT INTO manpower.plans
      (id, tenant_id, plan_year, unit_id, cadre, sanctioned_strength, filled_strength,
       status, created_by, submitted_at, approved_at, updated_at)
    VALUES
      (${randomUUID()}, ${TENANT}, 2025, ${DEPT_ID}, 'Clerk', 80, 70,
       'approved', ${ACTOR_ID}, '2025-02-01T10:00:00Z', '2025-03-04T10:00:00Z', '2025-03-04T10:00:00Z')
  `);

  // 2025 / Finance / Officer -- same department, different cadre (GAP-03),
  // still draft: neither submitted_at nor approved_at set, so lastReview
  // must fall back to updated_at (GAP-02).
  await asTenant((tx) => tx`
    INSERT INTO manpower.plans
      (id, tenant_id, plan_year, unit_id, cadre, sanctioned_strength, filled_strength,
       status, created_by, updated_at)
    VALUES
      (${randomUUID()}, ${TENANT}, 2025, ${DEPT_ID}, 'Officer', 50, 50,
       'draft', ${ACTOR_ID}, '2025-04-15T09:00:00Z')
  `);

  // 2025 / no resolvable department / Constable -- 0 sanctioned (GAP-01's
  // zero-sanctioned per-row case must stay a clean 0, not NaN/error), and
  // submitted (not approved) so lastReview must pick submitted_at, not
  // updated_at (COALESCE priority order).
  await asTenant((tx) => tx`
    INSERT INTO manpower.plans
      (id, tenant_id, plan_year, unit_id, cadre, sanctioned_strength, filled_strength,
       status, created_by, submitted_at, updated_at)
    VALUES
      (${randomUUID()}, ${TENANT}, 2025, ${NO_DEPT_UNIT_ID}, 'Constable', 0, 0,
       'pending_approval', ${ACTOR_ID}, '2025-05-01T08:00:00Z', '2025-05-02T00:00:00Z')
  `);

  // 2024 / Finance / Clerk -- an older plan_year for the SAME department +
  // cadre as row 1. Exists only to prove GAP-04's year filter actually
  // excludes it from both the default (latest-year) response and its
  // totals.
  await asTenant((tx) => tx`
    INSERT INTO manpower.plans
      (id, tenant_id, plan_year, unit_id, cadre, sanctioned_strength, filled_strength,
       status, created_by, approved_at, updated_at)
    VALUES
      (${randomUUID()}, ${TENANT}, 2024, ${DEPT_ID}, 'Clerk', 80, 40,
       'approved', ${ACTOR_ID}, '2024-03-01T10:00:00Z', '2024-03-01T10:00:00Z')
  `);
}

beforeAll(async () => {
  const rows = await sqlClient<{ present: boolean; table_schema: string; table_name: string }[]>`
    SELECT (t.table_schema IS NOT NULL) AS present, want.table_schema, want.table_name
    FROM (VALUES
      ('manpower', 'plans'),
      ('employee', 'hrms_departments')
    ) AS want(table_schema, table_name)
    LEFT JOIN information_schema.tables t
      ON t.table_schema = want.table_schema AND t.table_name = want.table_name
  `;
  const missing = rows.filter((r) => !r.present);
  if (missing.length > 0) {
    throw new Error(
      "Missing table(s) in this database (DATABASE_URL=" +
        `${process.env.DATABASE_URL ?? "<default from vitest.config.ts>"}): ` +
        missing.map((m) => `${m.table_schema}.${m.table_name}`).join(", ") +
        ". Apply services/hrms-service/migrations/0062_manpower_planning.sql before running this suite.",
    );
  }

  await cleanup();
  await seed();
  app = await buildApp();
});

afterAll(async () => {
  await cleanup();
  await app.close();
  await sqlClient.end();
});

type ApiRow = {
  id: string;
  department: string | null;
  cadre: string;
  planYear: number;
  sanctionedPosts: number;
  filled: number;
  vacant: number;
  fillPercentage: number;
  lastReview: string;
  status: string;
};

describe("GET /v1/hrms/staffing-plan — role gate (GAP-HR-STAFFING-PLAN-04)", () => {
  it("403s a role the broader /hr layout admits but this endpoint does not (e.g. manager)", async () => {
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/staffing-plan",
      headers: { authorization: `Bearer ${managerToken}` },
    });
    expect(r.statusCode).toBe(403);
    const body = JSON.parse(r.body);
    expect(body.message).toMatch(/requires one of/i);
  });

  it("200s for hr_admin", async () => {
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/staffing-plan",
      headers: { authorization: `Bearer ${hrToken}` },
    });
    expect(r.statusCode).toBe(200);
  });
});

describe("GET /v1/hrms/staffing-plan — year scoping (GAP-HR-STAFFING-PLAN-04)", () => {
  it("defaults to the most recent plan_year and excludes older years from both rows and totals", async () => {
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/staffing-plan",
      headers: { authorization: `Bearer ${hrToken}` },
    });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.meta.planYear).toBe(2025);
    expect(body.meta.availableYears).toEqual([2025, 2024]);

    const rows = body.data as ApiRow[];
    expect(rows).toHaveLength(3); // the 2024 Clerk row must NOT be present
    expect(rows.every((row) => row.planYear === 2025)).toBe(true);

    const totalSanctioned = rows.reduce((s, r2) => s + Number(r2.sanctionedPosts), 0);
    const totalFilled = rows.reduce((s, r2) => s + Number(r2.filled), 0);
    // 80+50+0 and 70+50+0 -- if the old cross-year bug were still present
    // this would silently include the 2024 row's 80/40 too (210/160).
    expect(totalSanctioned).toBe(130);
    expect(totalFilled).toBe(120);
  });

  it("?year= scopes to an older plan_year explicitly", async () => {
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/staffing-plan?year=2024",
      headers: { authorization: `Bearer ${hrToken}` },
    });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.meta.planYear).toBe(2024);
    expect(body.meta.availableYears).toEqual([2025, 2024]);

    const rows = body.data as ApiRow[];
    expect(rows).toHaveLength(1);
    const [onlyRow] = rows;
    if (!onlyRow) throw new Error("expected exactly one 2024 row");
    expect(onlyRow.cadre).toBe("Clerk");
    expect(onlyRow.planYear).toBe(2024);
    expect(onlyRow.fillPercentage).toBe(50); // 40/80*100
  });
});

describe("GET /v1/hrms/staffing-plan — per-row fields (GAP-HR-STAFFING-PLAN-01/02/03)", () => {
  it("returns fillPercentage as a real number, not a numeric-as-string (GAP-01)", async () => {
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/staffing-plan",
      headers: { authorization: `Bearer ${hrToken}` },
    });
    const rows = JSON.parse(r.body).data as ApiRow[];
    const clerk = rows.find((row) => row.cadre === "Clerk");
    if (!clerk) throw new Error("expected 2025 Clerk row not found");
    expect(typeof clerk.fillPercentage).toBe("number");
    expect(clerk.fillPercentage).toBe(87.5);
  });

  it("keeps a 0-sanctioned row's fillPercentage a clean 0, not NaN/error (GAP-01 edge case)", async () => {
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/staffing-plan",
      headers: { authorization: `Bearer ${hrToken}` },
    });
    const rows = JSON.parse(r.body).data as ApiRow[];
    const constable = rows.find((row) => row.cadre === "Constable");
    if (!constable) throw new Error("expected Constable row not found");
    expect(constable.fillPercentage).toBe(0);
  });

  it("returns department and cadre as independent fields, not COALESCEd together (GAP-03)", async () => {
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/staffing-plan",
      headers: { authorization: `Bearer ${hrToken}` },
    });
    const rows = JSON.parse(r.body).data as ApiRow[];
    const clerk = rows.find((row) => row.cadre === "Clerk");
    const officer = rows.find((row) => row.cadre === "Officer");
    if (!clerk || !officer) throw new Error("expected Clerk and Officer rows not found");
    // Same department, different cadre -- both fields present and distinct
    // from one another, so the web layer can tell them apart.
    expect(clerk.department).toBe("Finance");
    expect(officer.department).toBe("Finance");
    expect(clerk.cadre).toBe("Clerk");
    expect(officer.cadre).toBe("Officer");
  });

  it("returns a null department (not the cadre echoed back) when the unit has no resolvable department link (GAP-03)", async () => {
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/staffing-plan",
      headers: { authorization: `Bearer ${hrToken}` },
    });
    const rows = JSON.parse(r.body).data as ApiRow[];
    const constable = rows.find((row) => row.cadre === "Constable");
    if (!constable) throw new Error("expected Constable row not found");
    expect(constable.department).toBeNull();
  });

  it("prioritises approved_at > submitted_at > updated_at for lastReview (GAP-02)", async () => {
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/staffing-plan",
      headers: { authorization: `Bearer ${hrToken}` },
    });
    const rows = JSON.parse(r.body).data as ApiRow[];
    const clerk = rows.find((row) => row.cadre === "Clerk"); // has approved_at
    const officer = rows.find((row) => row.cadre === "Officer"); // draft, only updated_at
    const constable = rows.find((row) => row.cadre === "Constable"); // submitted, no approved_at
    if (!clerk || !officer || !constable) throw new Error("expected seed rows not found");

    expect(new Date(clerk.lastReview).toISOString()).toBe(new Date("2025-03-04T10:00:00Z").toISOString());
    expect(new Date(officer.lastReview).toISOString()).toBe(new Date("2025-04-15T09:00:00Z").toISOString());
    expect(new Date(constable.lastReview).toISOString()).toBe(new Date("2025-05-01T08:00:00Z").toISOString());
  });
});
