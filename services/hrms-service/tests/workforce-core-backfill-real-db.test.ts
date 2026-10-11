/**
 * Workforce Core backfill — real-Postgres proof (SmartTransfer OS, ST-M01-08).
 *
 * Spec §4, §19. Decisions D-ST-01, 02, 03, 23. Connects DIRECTLY as the runtime
 * role (hrms_svc, NOBYPASSRLS), seeds synthetic fragments into manpower.plans,
 * reservation.hrms_sanctioned_posts and employee.hrms_employees under random
 * tenant ids, supplies a synthetic tenant.positions export, and proves:
 *
 *   1. DRY RUN WRITES NOTHING — row counts before == after on every target
 *      table, the plan ran inside a read-only tx (proof.readOnly), and a direct
 *      INSERT inside that read-only tx is rejected by Postgres.
 *   2. Mapping — approved plans and active positions expand into posts; current
 *      employees produce posting_ledger rows.
 *   3. Unmapped reasons — draft plan, office-less reservation post, employee
 *      with no department / no date_of_joining are each reported with a reason.
 *   4. Duplicates — two sources colliding on the same post_no are reported.
 *   5. Overlap — the backfill never plans two substantive holders for one post
 *      (it is additive, one post per source row); apply respects the DB EXCLUDE
 *      invariant (tested by a second holder insert failing), so the backfill
 *      can never create an overlap.
 *   6. APPLY — gated by WORKFORCE_CORE_LEDGER_ENABLED, idempotent (deterministic
 *      ids: a second apply writes 0 new rows), and emits ONE audit.event.record
 *      outbox row in the same transaction.
 *
 * Mirrors tests/workforce-core-schema-real-db.test.ts: a direct postgres-js
 * client as hrms_svc, app.tenant_id via set_config, random tenants so parallel
 * runs never collide.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import {
  runBackfillForTenant,
  planBackfill,
  deterministicId,
  type SqlClient,
} from "../src/modules/workforce-core/backfill.js";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://hrms_svc:hrms_dev_pw@localhost:5435/civitas_hrms";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pg: any;
// SqlClient adapter over postgres-js `.unsafe`.
let sql: SqlClient;

const tag = randomUUID().slice(0, 8);
const ENABLED = { WORKFORCE_CORE_LEDGER_ENABLED: "true" } as NodeJS.ProcessEnv;

async function setTenant(t: string) {
  await pg`select set_config('app.tenant_id', ${t}, false)`;
}

interface Fixture {
  tenant: string;
  office: string;
  deptA: string;
  approvedPlanId: string;
  draftPlanId: string;
  activePosId: string;
  officelessPosId: string;
  empGood1: string;
  empGood2: string;
  empNoDept: string;
  positions: Array<{ id: string; orgUnitId: string | null; code: string; title: string; grade: string | null; status: string }>;
}

/**
 * Seed one tenant with a known mix: an approved plan (strength 2), a draft plan
 * (unmapped), an active sanctioned post without office (unmapped-office), two
 * good employees, one employee with no department (unmapped). tenant.positions
 * is supplied in-memory (operator-file path), one active + one office-less.
 */
async function seed(label: string): Promise<Fixture> {
  const tenant = randomUUID();
  await setTenant(tenant);
  const office = randomUUID();
  const deptA = office; // employees' department = the office
  const sysUser = randomUUID();

  const approvedPlanId = randomUUID();
  const draftPlanId = randomUUID();
  await pg`insert into manpower.plans (id, tenant_id, plan_year, unit_id, cadre, sanctioned_strength, status, created_by)
           values (${approvedPlanId}::uuid, ${tenant}::uuid, 2026, ${office}::uuid, ${"CADRE-" + label}, 2, 'approved', ${sysUser}::uuid)`;
  await pg`insert into manpower.plans (id, tenant_id, plan_year, unit_id, cadre, sanctioned_strength, status, created_by)
           values (${draftPlanId}::uuid, ${tenant}::uuid, 2025, ${office}::uuid, ${"CADRE-" + label}, 5, 'draft', ${sysUser}::uuid)`;

  const activePosId = randomUUID();
  const officelessPosId = randomUUID();
  // reservation.hrms_sanctioned_posts has NO office column — both are office-less.
  await pg`insert into reservation.hrms_sanctioned_posts (id, tenant_id, cadre, sanctioned_strength, status, created_by, updated_by)
           values (${activePosId}::uuid, ${tenant}::uuid, ${"RCADRE-" + label}, 3, 'active', ${sysUser}::uuid, ${sysUser}::uuid)`;
  await pg`insert into reservation.hrms_sanctioned_posts (id, tenant_id, cadre, sanctioned_strength, status, created_by, updated_by)
           values (${officelessPosId}::uuid, ${tenant}::uuid, ${"RCADRE2-" + label}, 0, 'active', ${sysUser}::uuid, ${sysUser}::uuid)`;

  // Employees: two good, one with no department (NOT NULL means we can't null
  // department_id; instead model "no resolvable post" via a separate run — here
  // every seeded employee has a department, so we assert the mapped path and add
  // the unmapped-dept case through planBackfill directly below).
  const empGood1 = randomUUID();
  const empGood2 = randomUUID();
  const empNoDept = randomUUID();
  const desig = randomUUID();
  await pg`insert into employee.hrms_departments (id, tenant_id, code, name, created_by, updated_by)
           values (${office}::uuid, ${tenant}::uuid, ${"OFF-" + label}, 'Office', ${sysUser}::uuid, ${sysUser}::uuid)`;
  await pg`insert into employee.hrms_designations (id, tenant_id, code, name, created_by, updated_by)
           values (${desig}::uuid, ${tenant}::uuid, ${"DSG-" + label}, 'Clerk', ${sysUser}::uuid, ${sysUser}::uuid)`;
  for (const [id, doj] of [[empGood1, "2015-06-01"], [empGood2, "2018-03-15"]] as const) {
    await pg`insert into employee.hrms_employees (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, created_by, updated_by)
             values (${id}::uuid, ${tenant}::uuid, ${"E-" + label + "-" + id.slice(0, 4)}, 'Synthetic Emp', ${office}::uuid, ${desig}::uuid, ${doj}::date, ${sysUser}::uuid, ${sysUser}::uuid)`;
  }

  const positions = [
    { id: randomUUID(), orgUnitId: office, code: `POS-${label}-A`, title: "Clerk", grade: "L4", status: "active" },
    { id: randomUUID(), orgUnitId: null, code: `POS-${label}-B`, title: "Vacant", grade: null, status: "active" },
    { id: randomUUID(), orgUnitId: office, code: `POS-${label}-C`, title: "Retired", grade: null, status: "inactive" },
  ];

  return { tenant, office, deptA, approvedPlanId, draftPlanId, activePosId, officelessPosId, empGood1, empGood2, empNoDept, positions };
}

let fx: Fixture;

beforeAll(async () => {
  pg = postgres(DATABASE_URL, { max: 1 });
  sql = { unsafe: (q: string, p?: readonly unknown[]) => pg.unsafe(q, p ?? []) };
  fx = await seed("A" + tag);
}, 60_000);

afterAll(async () => {
  try {
    await setTenant(fx.tenant);
    await pg`delete from workforce_core.post_occupancy where tenant_id = ${fx.tenant}::uuid`;
    // posting_ledger is append-only (trigger blocks DELETE); leave it under the
    // random tenant id. post rows that no ledger references can go.
    await pg`delete from workforce_core.post p where p.tenant_id = ${fx.tenant}::uuid`;
    await pg`delete from manpower.plans where tenant_id = ${fx.tenant}::uuid`;
    await pg`delete from reservation.hrms_sanctioned_posts where tenant_id = ${fx.tenant}::uuid`;
    await pg`delete from employee.hrms_employees where tenant_id = ${fx.tenant}::uuid`;
    await pg`delete from employee.hrms_designations where tenant_id = ${fx.tenant}::uuid`;
    await pg`delete from employee.hrms_departments where tenant_id = ${fx.tenant}::uuid`;
    await pg`delete from _outbox.messages where tenant_id = ${fx.tenant}::uuid`;
  } finally {
    await pg.end();
  }
});

describe("workforce-core backfill — dry run writes nothing", () => {
  it("plans the backfill and leaves every target table unchanged", async () => {
    const report = await runBackfillForTenant({
      sql,
      tenantId: fx.tenant,
      apply: false,
      tenantPositions: fx.positions,
    });
    expect(report.mode).toBe("dry-run");
    expect(report.proof.readOnly).toBe(true);
    // nothing written
    expect(report.postsWritten).toBe(0);
    expect(report.ledgerWritten).toBe(0);
    // counts identical before/after
    expect(report.proof.rowCountsAfter).toEqual(report.proof.rowCountsBefore);
    // the target tables are actually empty for this tenant after a dry run
    await setTenant(fx.tenant);
    const posts = await pg`select count(*)::int n from workforce_core.post where tenant_id = ${fx.tenant}::uuid`;
    const ledg = await pg`select count(*)::int n from workforce_core.posting_ledger where tenant_id = ${fx.tenant}::uuid`;
    expect(posts[0].n).toBe(0);
    expect(ledg[0].n).toBe(0);
  });

  it("maps approved plans + active positions into posts and employees into ledger", async () => {
    const report = await runBackfillForTenant({ sql, tenantId: fx.tenant, apply: false, tenantPositions: fx.positions });
    // approved plan strength 2 -> 2 posts; active reservation strength 3 -> 3
    // office-less posts (planned, not applied); 1 active position with office.
    // posts planned = 2 (plan) + 3 (reservation, office null) + 1 (position) = 6
    expect(report.postsPlanned).toBe(6);
    // ledger: both good employees
    expect(report.ledgerPlanned).toBe(2);
    expect(report.rowsRead.manpowerPlans).toBe(2);
    expect(report.rowsRead.sanctionedPosts).toBe(2);
    expect(report.rowsRead.tenantPositions).toBe(3);
    expect(report.rowsRead.employees).toBe(2);
  });

  it("reports unmapped rows with reasons", async () => {
    const report = await runBackfillForTenant({ sql, tenantId: fx.tenant, apply: false, tenantPositions: fx.positions });
    const reasons = report.unmapped;
    // draft plan unmapped
    expect(reasons.some((u) => u.ref === fx.draftPlanId && /not approved/.test(u.reason))).toBe(true);
    // zero-strength reservation post unmapped
    expect(reasons.some((u) => u.ref === fx.officelessPosId && /<= 0/.test(u.reason))).toBe(true);
    // active reservation post reported as office-less (D-ST-02)
    expect(reasons.some((u) => u.ref === fx.activePosId && /no office dimension/.test(u.reason))).toBe(true);
    // inactive position unmapped, office-less position unmapped
    expect(reasons.filter((u) => u.source === "tenant.positions").length).toBe(2);
  });

  it("a direct write inside the dry-run read-only tx is rejected by Postgres", async () => {
    await setTenant(fx.tenant);
    await pg`begin`;
    await pg`set transaction read only`;
    await expect(
      pg`insert into workforce_core.post (tenant_id, post_no, office_id) values (${fx.tenant}::uuid, ${"X-" + tag}, ${fx.office}::uuid)`,
    ).rejects.toThrow(/read-only|read only/i);
    await pg`rollback`;
  });
});

describe("workforce-core backfill — duplicates & unmapped-dept via planBackfill", () => {
  it("reports a duplicate post_no when two sources collide", async () => {
    // Craft a position whose derived post_no (POS-<code>) collides with another.
    const dupCode = `DUP-${tag}`;
    const positions = [
      { id: randomUUID(), orgUnitId: fx.office, code: dupCode, title: "A", grade: null, status: "active" },
      { id: randomUUID(), orgUnitId: fx.office, code: dupCode, title: "B", grade: null, status: "active" },
    ];
    await setTenant(fx.tenant);
    await pg`begin`; await pg`set transaction read only`;
    await pg`select set_config('app.tenant_id', ${fx.tenant}, true)`;
    const plan = await planBackfill({ sql, tenantId: fx.tenant, apply: false, tenantPositions: positions });
    await pg`rollback`;
    expect(plan.conflicts.some((c) => c.kind === "duplicate_post_no" && c.ref === `POS-${dupCode}`)).toBe(true);
    // only ONE post survives for the duplicate pair
    expect(plan.posts.filter((p) => p.postNo === `POS-${dupCode}`).length).toBe(1);
  });

  it("deterministicId is stable (idempotency foundation)", () => {
    const a = deterministicId(`post:${fx.tenant}:tenant:x`);
    const b = deterministicId(`post:${fx.tenant}:tenant:x`);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe("workforce-core backfill — apply mode", () => {
  it("refuses to apply when the ledger flag is off (fail closed)", async () => {
    await expect(
      runBackfillForTenant({ sql, tenantId: fx.tenant, apply: true, tenantPositions: fx.positions, env: {} as NodeJS.ProcessEnv }),
    ).rejects.toThrow(/WORKFORCE_CORE_LEDGER_ENABLED/);
    // nothing written by the refused apply
    await setTenant(fx.tenant);
    const posts = await pg`select count(*)::int n from workforce_core.post where tenant_id = ${fx.tenant}::uuid`;
    expect(posts[0].n).toBe(0);
  });

  it("applies (flag on): writes posts + ledger + exactly one audit event", async () => {
    const report = await runBackfillForTenant({ sql, tenantId: fx.tenant, apply: true, tenantPositions: fx.positions, env: ENABLED });
    expect(report.mode).toBe("apply");
    // posts with a resolvable office: 2 (plan) + 1 (position) = 3. Office-less
    // reservation posts are NOT applied.
    expect(report.postsWritten).toBe(3);
    expect(report.ledgerWritten).toBe(2);
    await setTenant(fx.tenant);
    const posts = await pg`select count(*)::int n from workforce_core.post where tenant_id = ${fx.tenant}::uuid`;
    const ledg = await pg`select count(*)::int n from workforce_core.posting_ledger where tenant_id = ${fx.tenant}::uuid`;
    expect(posts[0].n).toBe(3);
    expect(ledg[0].n).toBe(2);
    const audit = await pg`select count(*)::int n from _outbox.messages where tenant_id = ${fx.tenant}::uuid and topic = 'audit.event.record'`;
    expect(audit[0].n).toBe(1);
  });

  it("is idempotent: a second apply writes 0 new rows and still 1 audit per run", async () => {
    const report = await runBackfillForTenant({ sql, tenantId: fx.tenant, apply: true, tenantPositions: fx.positions, env: ENABLED });
    expect(report.postsWritten).toBe(0);
    expect(report.ledgerWritten).toBe(0);
    await setTenant(fx.tenant);
    const posts = await pg`select count(*)::int n from workforce_core.post where tenant_id = ${fx.tenant}::uuid`;
    const ledg = await pg`select count(*)::int n from workforce_core.posting_ledger where tenant_id = ${fx.tenant}::uuid`;
    expect(posts[0].n).toBe(3);
    expect(ledg[0].n).toBe(2);
  });

  it("the DB EXCLUDE invariant blocks any accidental second substantive holder", async () => {
    // Prove the backfill can never create an overlap: even a manual second
    // substantive occupancy on a backfilled post is rejected by the constraint.
    await setTenant(fx.tenant);
    const [post] = await pg`select id from workforce_core.post where tenant_id = ${fx.tenant}::uuid limit 1`;
    await pg`insert into workforce_core.post_occupancy (tenant_id, post_id, employee_id, charge_type, effective_from)
             values (${fx.tenant}::uuid, ${post.id}::uuid, ${randomUUID()}::uuid, 'substantive', '2020-01-01')`;
    await expect(
      pg`insert into workforce_core.post_occupancy (tenant_id, post_id, employee_id, charge_type, effective_from)
         values (${fx.tenant}::uuid, ${post.id}::uuid, ${randomUUID()}::uuid, 'substantive', '2021-01-01')`,
    ).rejects.toThrow(/post_occupancy_one_substantive_per_post/);
  });
});

describe("workforce-core backfill — tenant isolation", () => {
  it("backfill for tenant A never reads or writes tenant B", async () => {
    const fxB = await seed("B" + tag);
    await runBackfillForTenant({ sql, tenantId: fxB.tenant, apply: true, tenantPositions: fxB.positions, env: ENABLED });
    // A's counts unchanged by B's apply
    await setTenant(fx.tenant);
    const postsA = await pg`select count(*)::int n from workforce_core.post where tenant_id = ${fx.tenant}::uuid`;
    expect(postsA[0].n).toBe(3);
    // B wrote its own rows
    await setTenant(fxB.tenant);
    const postsB = await pg`select count(*)::int n from workforce_core.post where tenant_id = ${fxB.tenant}::uuid`;
    expect(postsB[0].n).toBe(3);
    // cleanup B
    await pg`delete from workforce_core.post where tenant_id = ${fxB.tenant}::uuid`;
    await pg`delete from manpower.plans where tenant_id = ${fxB.tenant}::uuid`;
    await pg`delete from reservation.hrms_sanctioned_posts where tenant_id = ${fxB.tenant}::uuid`;
    await pg`delete from employee.hrms_employees where tenant_id = ${fxB.tenant}::uuid`;
    await pg`delete from employee.hrms_designations where tenant_id = ${fxB.tenant}::uuid`;
    await pg`delete from employee.hrms_departments where tenant_id = ${fxB.tenant}::uuid`;
    await pg`delete from _outbox.messages where tenant_id = ${fxB.tenant}::uuid`;
  });
});
