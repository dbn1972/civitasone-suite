/**
 * Medical Claims — real-DB round-trip regression test.
 *
 * WHY THIS EXISTS: `medical/routes.ts` queried `employee.medical_claims` — a
 * schema/table that never existed anywhere — while migration
 * 0040_medical_claims.sql (and the Drizzle schema.ts it was generated from,
 * `hrmsMedicalClaims` in ./schema.ts) actually created and have always
 * agreed on `medical.hrms_medical_claims`. Every request to
 * POST/GET /v1/hrms/medical/claims, PATCH .../approve and
 * GET /v1/hrms/medical/history 500'd in production with Postgres 42P01
 * (relation does not exist). The approve/history handlers additionally read
 * and wrote non-existent `decided_by`/`decided_at` columns instead of the
 * real `approved_by`/`approved_at`.
 *
 * Fixing only the table/column names is not sufficient: this table has RLS
 * ENABLEd and FORCEd, and this module talks to `sqlClient` directly with no
 * `db.transaction()` in the call path, so without `withRawTenantGuc` every
 * query would run with no `app.tenant_id` GUC set — which fails CLOSED
 * (empty reads, row-security violation on write), not loudly. See
 * `@civitasone/db`'s `withRawTenantGuc` (already used the same way by this
 * service's workforce-planning module).
 *
 * This test runs the real Fastify app against the real Postgres instance
 * (DATABASE_URL from vitest.config.ts) and proves a claim submitted via the
 * live HTTP route actually reaches `medical.hrms_medical_claims` and can be
 * read back, approved, and shows up in history — not just that the SQL
 * parses against `tsc`.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { withRawTenantGuc } from "@civitasone/db";
import { buildApp } from "../app.js";
import { sqlClient } from "../shared/db.js";
import { queue } from "../shared/infra.js";
import { registerMedicalConsumers } from "../modules/medical/consumer.js";

// GAP-HR-MEDICAL-01: buildApp() registers routes only, not consumers (each
// runs in a separate worker process in production) — the new list-read
// audit event is published via the queue and recorded by medical/consumer.
// ts's own subscriber, so this file needs it registered against the SAME
// global `queue` singleton routes.ts publishes to. Same convention as
// disciplinary-case-create-readable-real-db.test.ts's registerF3_
// disciplinary_Consumers(queue) call.
registerMedicalConsumers(queue);

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "cccccccc-0040-4000-8000-000000000040";
const EMPLOYEE_ID = "cccccccc-0040-4000-8000-0000000000e1";
// IDOR-fix fixtures: a second, real employee NOT linked to selfToken, plus
// the department/designation hrms_employees requires, and a filler actor
// for created_by/updated_by on those seed rows.
const OTHER_EMPLOYEE_ID = "cccccccc-0040-4000-8000-0000000000e2";
const DEPT_ID = "cccccccc-0040-4000-8000-0000000000d1";
const DESIG_ID = "cccccccc-0040-4000-8000-0000000000d2";
const SEED_ACTOR = "cccccccc-0040-4000-8000-0000000000f9";

function tok(roles: string[], sub: string) {
  return signToken({ sub, tid: TENANT, roles, sid: "sess-medical-claims-test" }, SECRET);
}

// `sub` becomes `ctx.actorId` (packages/auth/src/index.ts), which routes.ts
// writes straight into the uuid `created_by`/`updated_by`/`approved_by`
// columns — it must be a real UUID, not a human-readable test label.
const SELF_SUB = "cccccccc-0040-4000-8000-0000000000f1";
const selfToken = tok(["employee"], SELF_SUB);
const hrToken = tok(["hr_admin"], "cccccccc-0040-4000-8000-0000000000f2");

// GAP-HR-MEDICAL-01 fixtures: a manager linked to MANAGER_SUB, two direct
// reports (manager_id = MANAGER_ID), an unlinked manager token (no
// hrms_employees row at all), and a dedicated employee for pagination
// coverage. OTHER_EMPLOYEE_ID/otherClaimId (declared above) double as the
// "exists in-tenant but is NOT a report" outsider case for the manager tests.
const MANAGER_SUB = "cccccccc-0040-4000-8000-0000000000f3";
const UNLINKED_MGR_SUB = "cccccccc-0040-4000-8000-0000000000f4";
const MANAGER_ID = "cccccccc-0040-4000-8000-0000000000e3";
const REPORT1_ID = "cccccccc-0040-4000-8000-0000000000e4";
const REPORT2_ID = "cccccccc-0040-4000-8000-0000000000e5";
const PAGINATION_EMPLOYEE_ID = "cccccccc-0040-4000-8000-0000000000e6";
const managerToken = tok(["manager"], MANAGER_SUB);
const unlinkedMgrToken = tok(["manager"], UNLINKED_MGR_SUB);

let app: Awaited<ReturnType<typeof buildApp>>;
// Set by the first describe block below; read by the GAP-HR-MEDICAL-01
// describe blocks further down (hoisted to module scope so both can see
// them — a per-describe `let` is not visible outside its own closure).
let claimId: string;
let otherClaimId: string;

// medical.hrms_medical_claims is FORCE RLS: this test's own verification
// queries need the same app.tenant_id GUC the fixed route now sets via
// withRawTenantGuc, or Postgres rejects them exactly like the unfixed route
// used to fail (proof, from the test side, of why that wrapping matters).
function asTenant<T>(fn: (tx: typeof sqlClient) => Promise<T>): Promise<T> {
  return withRawTenantGuc(sqlClient, TENANT, fn);
}

async function cleanup(): Promise<void> {
  await asTenant((tx) => tx`DELETE FROM medical.hrms_medical_claims WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_employees WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_designations WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_departments WHERE tenant_id = ${TENANT}`);
}

beforeAll(async () => {
  // Fail fast with an actionable message if this environment's migration was
  // never applied, instead of every test below drowning in a raw 42P01.
  const [row] = await sqlClient<{ present: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'medical' AND table_name = 'hrms_medical_claims'
    ) AS present
  `;
  if (!row?.present) {
    throw new Error(
      "medical.hrms_medical_claims does not exist in this database (DATABASE_URL=" +
        `${process.env.DATABASE_URL ?? "<default from vitest.config.ts>"}). ` +
        "Apply services/hrms-service/migrations/0040_medical_claims.sql " +
        "(npx drizzle-kit migrate, per migrations/README.md) before running this suite.",
    );
  }

  await cleanup(); // idempotency: wipe any leftovers from a previously crashed run

  // IDOR-fix fixture: link SELF_SUB (selfToken's JWT `sub`, i.e. ctx.actorId)
  // to a real hrms_employees row via user_ref — the same actor->employee
  // resolution medical/routes.ts's resolveSelfScopedEmployeeId now performs
  // via actor-link.ts's resolveEmployeeForActor. Plus a second, UNLINKED
  // employee (OTHER_EMPLOYEE_ID) to prove selfToken cannot pivot onto it.
  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_departments (id, tenant_id, code, name, created_by, updated_by)
    VALUES (${DEPT_ID}, ${TENANT}, 'MEDTEST', 'Medical Test Dept', ${SEED_ACTOR}, ${SEED_ACTOR})
  `);
  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_designations (id, tenant_id, code, name, created_by, updated_by)
    VALUES (${DESIG_ID}, ${TENANT}, 'MEDTEST', 'Medical Test Designation', ${SEED_ACTOR}, ${SEED_ACTOR})
  `);
  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_employees
      (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, user_ref, created_by, updated_by)
    VALUES
      (${EMPLOYEE_ID}, ${TENANT}, 'MEDTEST-001', 'Medical Test Self Employee', ${DEPT_ID}, ${DESIG_ID}, '2020-01-01', ${SELF_SUB}, ${SEED_ACTOR}, ${SEED_ACTOR})
  `);
  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_employees
      (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, created_by, updated_by)
    VALUES
      (${OTHER_EMPLOYEE_ID}, ${TENANT}, 'MEDTEST-002', 'Medical Test Other Employee', ${DEPT_ID}, ${DESIG_ID}, '2020-01-01', ${SEED_ACTOR}, ${SEED_ACTOR})
  `);

  // GAP-HR-MEDICAL-01 fixtures: MANAGER_ID linked to managerToken's `sub` via
  // user_ref, two direct reports (manager_id = MANAGER_ID). OTHER_EMPLOYEE_ID
  // above doubles as the "exists in-tenant but is not a report" outsider.
  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_employees
      (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, user_ref, created_by, updated_by)
    VALUES
      (${MANAGER_ID}, ${TENANT}, 'MEDTEST-003', 'Medical Test Manager', ${DEPT_ID}, ${DESIG_ID}, '2019-01-01', ${MANAGER_SUB}, ${SEED_ACTOR}, ${SEED_ACTOR})
  `);
  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_employees
      (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, manager_id, created_by, updated_by)
    VALUES
      (${REPORT1_ID}, ${TENANT}, 'MEDTEST-004', 'Medical Test Report One', ${DEPT_ID}, ${DESIG_ID}, '2021-01-01', ${MANAGER_ID}, ${SEED_ACTOR}, ${SEED_ACTOR}),
      (${REPORT2_ID}, ${TENANT}, 'MEDTEST-005', 'Medical Test Report Two', ${DEPT_ID}, ${DESIG_ID}, '2021-06-01', ${MANAGER_ID}, ${SEED_ACTOR}, ${SEED_ACTOR})
  `);
  // Dedicated employee for pagination coverage — kept separate from every
  // other fixture above so an exact-count/exact-slice assertion can never be
  // perturbed by claims another test in this file seeds.
  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_employees
      (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, created_by, updated_by)
    VALUES
      (${PAGINATION_EMPLOYEE_ID}, ${TENANT}, 'MEDTEST-006', 'Medical Test Pagination Employee', ${DEPT_ID}, ${DESIG_ID}, '2020-01-01', ${SEED_ACTOR}, ${SEED_ACTOR})
  `);

  app = await buildApp();
});

afterAll(async () => {
  await cleanup();
  await app.close();
  await sqlClient.end();
});

describe("medical claims — real round-trip against medical.hrms_medical_claims", () => {
  it("POST /v1/hrms/medical/claims — 201, and the row actually exists in medical.hrms_medical_claims", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/v1/hrms/medical/claims",
      headers: { authorization: `Bearer ${selfToken}`, "content-type": "application/json" },
      body: JSON.stringify({
        employeeId: EMPLOYEE_ID,
        claimType: "outdoor",
        amountMinor: 250000,
        hospitalName: "AIIMS Test Wing",
        diagnosis: "Routine checkup — regression test",
        documents: [],
      }),
    });

    expect(r.statusCode).toBe(201);
    const body = JSON.parse(r.body);
    expect(body.data.status).toBe("pending");
    expect(body.data.employeeId).toBe(EMPLOYEE_ID);
    claimId = body.data.id;
    expect(claimId).toBeTruthy();

    // Prove it round-tripped through the real table, not a mock.
    const [dbRow] = await asTenant((tx) => tx`
      SELECT id, tenant_id, employee_id, status, hospital_name
      FROM medical.hrms_medical_claims WHERE id = ${claimId}
    `);
    // `expect(...).toBeTruthy()` does not narrow for tsc — dbRow stays
    // `Row | undefined` afterwards and every property access below would be
    // TS18048. A real control-flow guard (throw) is required to narrow it.
    if (!dbRow) throw new Error(`expected a row in medical.hrms_medical_claims for id ${claimId}`);
    expect(dbRow.tenant_id).toBe(TENANT);
    expect(dbRow.employee_id).toBe(EMPLOYEE_ID);
    expect(dbRow.status).toBe("pending");
    expect(dbRow.hospital_name).toBe("AIIMS Test Wing");
  });

  it("POST /v1/hrms/medical/claims — 400 for the old OPD/IPD/dental/optical vocabulary (must stay indoor/outdoor/reimbursement/advance)", async () => {
    // Regression guard: claimType previously accepted OPD/IPD/dental/optical
    // at the Zod layer, but the DB's hrms_medical_claims_type_check constraint
    // only ever allowed indoor/outdoor/reimbursement/advance — so every
    // valid-looking request was guaranteed to 500 on INSERT. Locking this to
    // 400 (Zod rejects it up front) so it can't silently regress back to a
    // vocabulary the real table will never accept.
    const r = await app.inject({
      method: "POST",
      url: "/v1/hrms/medical/claims",
      headers: { authorization: `Bearer ${selfToken}`, "content-type": "application/json" },
      body: JSON.stringify({
        employeeId: EMPLOYEE_ID,
        claimType: "OPD",
        amountMinor: 250000,
        hospitalName: "AIIMS Test Wing",
        diagnosis: "Should be rejected before it ever reaches the DB",
        documents: [],
      }),
    });
    expect(r.statusCode).toBe(400);
  });

  it("GET /v1/hrms/medical/claims — 200, and lists the row just inserted", async () => {
    const r = await app.inject({
      method: "GET",
      url: `/v1/hrms/medical/claims?employeeId=${EMPLOYEE_ID}`,
      headers: { authorization: `Bearer ${selfToken}` },
    });

    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    const found = (body.data as Array<{ id: string; status: string; hospital_name: string }>)
      .find((c) => c.id === claimId);
    expect(found).toBeTruthy();
    expect(found?.status).toBe("pending");
    expect(found?.hospital_name).toBe("AIIMS Test Wing");
  });

  // ── IDOR regression suite ────────────────────────────────────────────
  // medical claims/insurance/history leaked tenant-wide to any bare
  // "employee" caller: employeeId was either optional-and-unchecked (claims
  // list) or required-but-never-compared-to-the-actor (history/insurance).
  // These prove the fix: the leak is closed AND the caller's own data still
  // returns correctly, for both the self-service and privileged (HR) roles.

  it("HR files a claim for a SECOND employee — fixture for the IDOR tests below", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/v1/hrms/medical/claims",
      headers: { authorization: `Bearer ${hrToken}`, "content-type": "application/json" },
      body: JSON.stringify({
        employeeId: OTHER_EMPLOYEE_ID,
        claimType: "indoor",
        amountMinor: 300000,
        hospitalName: "Safdarjung Test Wing",
        diagnosis: "Unrelated employee's claim — must never appear in selfToken's results",
        documents: [],
      }),
    });
    expect(r.statusCode).toBe(201);
    otherClaimId = JSON.parse(r.body).data.id;
    expect(otherClaimId).toBeTruthy();
  });

  it("GET /v1/hrms/medical/claims — employee caller is scoped to their own claim even when requesting another employee's id (IDOR closed)", async () => {
    const r = await app.inject({
      method: "GET",
      url: `/v1/hrms/medical/claims?employeeId=${OTHER_EMPLOYEE_ID}`,
      headers: { authorization: `Bearer ${selfToken}` },
    });
    expect(r.statusCode).toBe(200);
    const ids = (JSON.parse(r.body).data as Array<{ id: string }>).map((c) => c.id);
    expect(ids).toContain(claimId);          // their own claim: still returned correctly
    expect(ids).not.toContain(otherClaimId); // NOT silently redirected onto someone else's
  });

  it("GET /v1/hrms/medical/claims — employee caller omitting employeeId does not leak tenant-wide (the audit's actual trigger)", async () => {
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/medical/claims",
      headers: { authorization: `Bearer ${selfToken}` },
    });
    expect(r.statusCode).toBe(200);
    const ids = (JSON.parse(r.body).data as Array<{ id: string }>).map((c) => c.id);
    expect(ids).toContain(claimId);
    expect(ids).not.toContain(otherClaimId);
  });

  it("GET /v1/hrms/medical/claims — HR's broader (tenant-wide) access is preserved", async () => {
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/medical/claims",
      headers: { authorization: `Bearer ${hrToken}` },
    });
    expect(r.statusCode).toBe(200);
    const ids = (JSON.parse(r.body).data as Array<{ id: string }>).map((c) => c.id);
    expect(ids).toContain(claimId);
    expect(ids).toContain(otherClaimId);
  });

  it("PATCH /v1/hrms/medical/claims/:id/approve — 200, and writes approved_by/approved_at (not decided_by/decided_at)", async () => {
    const r = await app.inject({
      method: "PATCH",
      url: `/v1/hrms/medical/claims/${claimId}/approve`,
      headers: { authorization: `Bearer ${hrToken}`, "content-type": "application/json" },
      body: JSON.stringify({ status: "approved", approvedAmountMinor: 200000 }),
    });

    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.data.status).toBe("approved");
    expect(body.data.approvedAmountMinor).toBe(200000);

    const [dbRow] = await asTenant((tx) => tx`
      SELECT status, approved_by, approved_at, approved_amount_minor::text AS approved_amount_minor
      FROM medical.hrms_medical_claims WHERE id = ${claimId}
    `);
    if (!dbRow) throw new Error(`expected a row in medical.hrms_medical_claims for id ${claimId}`);
    expect(dbRow.status).toBe("approved");
    expect(dbRow.approved_by).toBeTruthy();
    expect(dbRow.approved_at).toBeTruthy();
    expect(dbRow.approved_amount_minor).toBe("200000");
  });

  it("GET /v1/hrms/medical/history — 200, and shows the approved claim with approved_at populated", async () => {
    const r = await app.inject({
      method: "GET",
      url: `/v1/hrms/medical/history?employeeId=${EMPLOYEE_ID}`,
      headers: { authorization: `Bearer ${selfToken}` },
    });

    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    const found = (body.data as Array<{ id: string; status: string; approved_at: string | null }>)
      .find((c) => c.id === claimId);
    expect(found).toBeTruthy();
    expect(found?.status).toBe("approved");
    expect(found?.approved_at).toBeTruthy();
  });

  it("GET /v1/hrms/medical/history — employee caller cannot see another employee's history, still sees their own (IDOR closed)", async () => {
    const r = await app.inject({
      method: "GET",
      url: `/v1/hrms/medical/history?employeeId=${OTHER_EMPLOYEE_ID}`,
      headers: { authorization: `Bearer ${selfToken}` },
    });
    expect(r.statusCode).toBe(200);
    const ids = (JSON.parse(r.body).data as Array<{ id: string }>).map((c) => c.id);
    expect(ids).toContain(claimId);
    expect(ids).not.toContain(otherClaimId);
  });

  it("GET /v1/hrms/medical/history — HR's broader access is preserved", async () => {
    const r = await app.inject({
      method: "GET",
      url: `/v1/hrms/medical/history?employeeId=${OTHER_EMPLOYEE_ID}`,
      headers: { authorization: `Bearer ${hrToken}` },
    });
    expect(r.statusCode).toBe(200);
    const ids = (JSON.parse(r.body).data as Array<{ id: string }>).map((c) => c.id);
    expect(ids).toContain(otherClaimId);
  });

  it("PATCH .../approve — 404 for a claim id that does not exist (still queries the real table, not a stub)", async () => {
    const r = await app.inject({
      method: "PATCH",
      url: `/v1/hrms/medical/claims/00000000-dead-4000-8000-ffffffffffff/approve`,
      headers: { authorization: `Bearer ${hrToken}`, "content-type": "application/json" },
      body: JSON.stringify({ status: "approved" }),
    });
    expect(r.statusCode).toBe(404);
  });

  it("GET /v1/hrms/medical/claims — 401 without a token", async () => {
    const r = await app.inject({
      method: "GET",
      url: `/v1/hrms/medical/claims?employeeId=${EMPLOYEE_ID}`,
    });
    expect([401, 403]).toContain(r.statusCode);
  });

  // ── CREATE-forgery regression ────────────────────────────────────────
  // Audit finding: the POST create-claim route trusted `employeeId` straight
  // from the request body for every SELF_ROLES caller, including a bare
  // "employee" — so any employee could submit a claim under a colleague's
  // identity. Fixed by routing employeeId through the same
  // resolveSelfScopedEmployeeId helper the read routes already use: HR/
  // finance/manager keep the ability to file on behalf of a given employee
  // (see "HR files a claim for a SECOND employee" above), but a bare
  // "employee" caller is always forced onto their own linked record.

  it("POST /v1/hrms/medical/claims — a bare employee caller cannot forge a colleague's employeeId", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/v1/hrms/medical/claims",
      headers: { authorization: `Bearer ${selfToken}`, "content-type": "application/json" },
      body: JSON.stringify({
        employeeId: OTHER_EMPLOYEE_ID, // attempted impersonation of a colleague
        claimType: "outdoor",
        amountMinor: 999900,
        hospitalName: "Forgery Attempt Hospital",
        diagnosis: "Attempted impersonation of another employee's claim",
        documents: [],
      }),
    });

    expect(r.statusCode).toBe(201);
    const body = JSON.parse(r.body);
    // Forced onto the caller's OWN linked employee, never the requested id.
    expect(body.data.employeeId).toBe(EMPLOYEE_ID);
    expect(body.data.employeeId).not.toBe(OTHER_EMPLOYEE_ID);

    const [dbRow] = await asTenant((tx) => tx`
      SELECT employee_id FROM medical.hrms_medical_claims WHERE id = ${body.data.id}
    `);
    if (!dbRow) throw new Error(`expected a row in medical.hrms_medical_claims for id ${body.data.id}`);
    expect(dbRow.employee_id).toBe(EMPLOYEE_ID);
    expect(dbRow.employee_id).not.toBe(OTHER_EMPLOYEE_ID);
  });

  // ── Double-approval race regression ──────────────────────────────────
  // Audit finding: the approve handler SELECTed the current status, then
  // UPDATEd unconditionally (WHERE id/tenant_id only, inside one
  // sqlClient.begin() transaction — see withRawTenantGuc) — two concurrent
  // approve requests against the same 'pending' claim could both pass the
  // SELECT-based check before either committed, and both "succeed",
  // double-processing the claim. Fixed by re-asserting status = 'pending'
  // inside the UPDATE's own WHERE clause and checking RETURNING for zero
  // rows.
  //
  // A Promise.all over two app.inject() calls was tried first and turned out
  // NOT to reliably force the race window on these fast localhost queries —
  // in practice one request's whole read-then-write sequence consistently
  // finished before the other's read even ran, so it never actually
  // exercised concurrent access (that version is why this suite instead
  // drives two manually-interleaved raw connections below: deterministic,
  // not dependent on scheduler luck). Both tests below reserve two
  // independent physical connections (sqlClient.reserve()) and manually
  // step through BEGIN → SELECT (both see 'pending') → UPDATE/COMMIT →
  // UPDATE/COMMIT, so the "both readers observed pending before either
  // writer committed" window is guaranteed, not hoped for.

  it("REPRODUCTION: the pre-fix shape (blind UPDATE, no status guard) lets two concurrent transactions both approve the same claim", async () => {
    const buggyClaimId = randomUUID();
    await asTenant((tx) => tx`
      INSERT INTO medical.hrms_medical_claims (
        id, tenant_id, employee_id, claim_type, amount_minor, hospital_name,
        diagnosis, documents, status, created_by, updated_by
      ) VALUES (
        ${buggyClaimId}, ${TENANT}, ${EMPLOYEE_ID}, 'outdoor', 150000, 'Race Repro Hospital',
        'Reproduces the pre-fix race on the OLD unconditional-UPDATE shape', '[]', 'pending',
        ${SEED_ACTOR}, ${SEED_ACTOR}
      )
    `);

    const conn1 = await sqlClient.reserve();
    const conn2 = await sqlClient.reserve();
    try {
      await conn1`BEGIN`;
      await conn1`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
      await conn2`BEGIN`;
      await conn2`SELECT set_config('app.tenant_id', ${TENANT}, true)`;

      // Both transactions independently read 'pending' — neither has
      // written yet, so under READ COMMITTED both see the same pre-race state.
      const [read1] = await conn1`SELECT status FROM medical.hrms_medical_claims WHERE id = ${buggyClaimId} AND tenant_id = ${TENANT}`;
      const [read2] = await conn2`SELECT status FROM medical.hrms_medical_claims WHERE id = ${buggyClaimId} AND tenant_id = ${TENANT}`;
      if (!read1 || !read2) throw new Error(`expected both connections to read a row for id ${buggyClaimId}`);
      expect(read1.status).toBe("pending");
      expect(read2.status).toBe("pending");

      // The ORIGINAL routes.ts shape: WHERE id/tenant_id only, no status
      // guard, no RETURNING check — exactly what this file's routes.ts
      // looked like before the fix in this PR.
      await conn1`
        UPDATE medical.hrms_medical_claims
        SET status = 'approved', approved_amount_minor = 150000, approved_at = NOW()
        WHERE id = ${buggyClaimId} AND tenant_id = ${TENANT}
      `;
      await conn1`COMMIT`;

      // conn2 already believes (from read2, above) that this claim is
      // 'pending' — exactly the stale belief the real HTTP handler's own
      // prior existing.status !== 'pending' check relied on. Its blind
      // UPDATE, with no guard, "succeeds" anyway.
      const upd2 = await conn2`
        UPDATE medical.hrms_medical_claims
        SET status = 'approved', approved_amount_minor = 150000, approved_at = NOW()
        WHERE id = ${buggyClaimId} AND tenant_id = ${TENANT}
      `;
      await conn2`COMMIT`;

      // THE BUG: both writers "won" — the second approval silently
      // clobbered/re-applied over the first with no error, proving the
      // pre-fix shape really does double-process a concurrent approval.
      expect(upd2.count).toBe(1);
    } finally {
      conn1.release();
      conn2.release();
    }
  });

  it("PATCH .../approve real SQL shape — two literally-concurrent transactions racing the same 'pending' claim: exactly one commits, the guard serializes the other (real Postgres, no mocking)", async () => {
    const raceClaimId = randomUUID();
    await asTenant((tx) => tx`
      INSERT INTO medical.hrms_medical_claims (
        id, tenant_id, employee_id, claim_type, amount_minor, hospital_name,
        diagnosis, documents, status, created_by, updated_by
      ) VALUES (
        ${raceClaimId}, ${TENANT}, ${EMPLOYEE_ID}, 'outdoor', 150000, 'Race Test Hospital',
        'Manual two-connection race fixture for the fixed guarded UPDATE', '[]', 'pending',
        ${SEED_ACTOR}, ${SEED_ACTOR}
      )
    `);

    const conn1 = await sqlClient.reserve();
    const conn2 = await sqlClient.reserve();
    try {
      await conn1`BEGIN`;
      await conn1`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
      await conn2`BEGIN`;
      await conn2`SELECT set_config('app.tenant_id', ${TENANT}, true)`;

      const [read1] = await conn1`SELECT status FROM medical.hrms_medical_claims WHERE id = ${raceClaimId} AND tenant_id = ${TENANT}`;
      const [read2] = await conn2`SELECT status FROM medical.hrms_medical_claims WHERE id = ${raceClaimId} AND tenant_id = ${TENANT}`;
      if (!read1 || !read2) throw new Error(`expected both connections to read a row for id ${raceClaimId}`);
      expect(read1.status).toBe("pending");
      expect(read2.status).toBe("pending"); // conn2 ALSO sees pending — the exact race window

      // conn1 commits the fixed (guarded) UPDATE first — routes.ts's exact
      // post-fix SQL shape.
      const upd1 = await conn1`
        UPDATE medical.hrms_medical_claims
        SET status = 'approved', approved_amount_minor = 150000, approved_at = NOW()
        WHERE id = ${raceClaimId} AND tenant_id = ${TENANT} AND status = 'pending'
        RETURNING id
      `;
      await conn1`COMMIT`;
      expect(upd1.length).toBe(1); // conn1 wins

      // conn2 still "believes" pending (from read2 above) and attempts the
      // identical guarded UPDATE. Postgres re-validates the WHERE clause
      // against the row's CURRENT (post-conn1-commit) state when conn2's
      // UPDATE statement runs — the guard, not conn2's stale read, decides
      // the outcome.
      const upd2 = await conn2`
        UPDATE medical.hrms_medical_claims
        SET status = 'approved', approved_amount_minor = 150000, approved_at = NOW()
        WHERE id = ${raceClaimId} AND tenant_id = ${TENANT} AND status = 'pending'
        RETURNING id
      `;
      await conn2`COMMIT`;
      expect(upd2.length).toBe(0); // conn2 loses the race — zero rows matched, exactly as the route now throws 409 on
    } finally {
      conn1.release();
      conn2.release();
    }

    // Final state: exactly one approval landed, never double-processed.
    const [finalRow] = await asTenant((tx) => tx`
      SELECT status, approved_amount_minor::text AS approved_amount_minor
      FROM medical.hrms_medical_claims WHERE id = ${raceClaimId}
    `);
    if (!finalRow) throw new Error(`expected a row in medical.hrms_medical_claims for id ${raceClaimId}`);
    expect(finalRow.status).toBe("approved");
    expect(finalRow.approved_amount_minor).toBe("150000");
  });

  it("PATCH .../approve — the real HTTP route rejects approving an already-approved claim with 409 WRONG_STATE", async () => {
    // Sanity check at the HTTP layer (not timing-sensitive): once a claim is
    // no longer 'pending', a second approve attempt through the actual route
    // gets the 409 the guarded UPDATE now produces.
    const r = await app.inject({
      method: "PATCH",
      url: `/v1/hrms/medical/claims/${claimId}/approve`, // already approved by an earlier test in this file
      headers: { authorization: `Bearer ${hrToken}`, "content-type": "application/json" },
      body: JSON.stringify({ status: "approved", approvedAmountMinor: 200000 }),
    });
    expect(r.statusCode).toBe(409);
    expect(JSON.parse(r.body).code).toBe("WRONG_STATE");
  });
});

// ── GAP-HR-MEDICAL-01 regression suite ────────────────────────────────────
// First-pass claim: managers and HR see every employee's medical claims
// tenant-wide (hospital, amounts, dependant relation) — resolveSelfScoped-
// EmployeeId returned `requested` unchanged for [...HR_ROLES, "manager"],
// and the list route's employee_id filter was skipped whenever that was
// undefined. Fixed for the LIST route specifically (submit/insurance/
// history's own manager behavior is deliberately unchanged — see
// tests/medical-routes.test.ts's "managers can submit claims" and
// "managers' access by employeeId is preserved (unaffected...)" specs):
// manager is now scoped to direct reports only, mirroring the codebase-wide
// "my team is direct reports, not self" convention (manager-employee-read-
// scope-real-db.test.ts:146, loans-advances-manager-scope-real-db.test.ts,
// leave/routes.ts's resolveNonHrEmployeeScope) — fails CLOSED to an empty
// list when the manager has no resolvable hrms_employees link, exactly like
// those precedents. Also covers the diagnosis/documents/remarks field drop
// and the new DPDP audit-on-read emission.
describe("GET /v1/hrms/medical/claims — GAP-HR-MEDICAL-01: manager scope", () => {
  let managerOwnClaimId: string;
  let report1ClaimId: string;
  let report2ClaimId: string;

  async function seedClaim(employeeId: string, hospitalName: string): Promise<string> {
    const id = randomUUID();
    await asTenant((tx) => tx`
      INSERT INTO medical.hrms_medical_claims (
        id, tenant_id, employee_id, claim_type, amount_minor, hospital_name,
        diagnosis, documents, status, created_by, updated_by
      ) VALUES (
        ${id}, ${TENANT}, ${employeeId}, 'outdoor', 100000, ${hospitalName},
        'Manager-scope test fixture', '[]', 'pending', ${SEED_ACTOR}, ${SEED_ACTOR}
      )
    `);
    return id;
  }

  beforeAll(async () => {
    managerOwnClaimId = await seedClaim(MANAGER_ID, "Manager Own Claim Hospital");
    report1ClaimId = await seedClaim(REPORT1_ID, "Report One Hospital");
    report2ClaimId = await seedClaim(REPORT2_ID, "Report Two Hospital");
  });

  it("REPRODUCTION: confirms today's fixed behavior is not accidentally still tenant-wide — a manager token must not see the pre-existing otherClaimId/claimId fixtures from the describe block above either", async () => {
    // This is the same request the "leak" acceptance criterion is about;
    // written first (before the narrower assertions below) as the direct
    // reproduction of GAP-HR-MEDICAL-01's verified evidence: a manager
    // caller omitting employeeId used to get every tenant claim back.
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/medical/claims",
      headers: { authorization: `Bearer ${managerToken}` },
    });
    expect(r.statusCode).toBe(200);
    const ids = (JSON.parse(r.body).data as Array<{ id: string }>).map((c) => c.id);
    expect(ids).not.toContain(claimId);      // EMPLOYEE_ID's claim — not a report of MANAGER_ID
    expect(ids).not.toContain(otherClaimId); // OTHER_EMPLOYEE_ID's claim — not a report either
  });

  it("manager with 2 direct reports sees exactly their reports' claims — not the outsider's, not their own", async () => {
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/medical/claims",
      headers: { authorization: `Bearer ${managerToken}` },
    });
    expect(r.statusCode).toBe(200);
    const ids = (JSON.parse(r.body).data as Array<{ id: string }>).map((c) => c.id);
    expect(ids).toContain(report1ClaimId);
    expect(ids).toContain(report2ClaimId);
    expect(ids).not.toContain(otherClaimId);      // not a report — must never leak tenant-wide
    expect(ids).not.toContain(managerOwnClaimId); // "my team" = direct reports, not self
  });

  it("manager explicitly requesting a non-report's employeeId still does not leak it (silently narrowed, same 'ignore an over-broad ask' shape this route already uses for a bare employee)", async () => {
    const r = await app.inject({
      method: "GET",
      url: `/v1/hrms/medical/claims?employeeId=${OTHER_EMPLOYEE_ID}`,
      headers: { authorization: `Bearer ${managerToken}` },
    });
    expect(r.statusCode).toBe(200);
    const ids = (JSON.parse(r.body).data as Array<{ id: string }>).map((c) => c.id);
    expect(ids).not.toContain(otherClaimId);
  });

  it("manager-only token with NO resolvable employee link fails CLOSED to an empty list (never falls back to tenant-wide)", async () => {
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/medical/claims",
      headers: { authorization: `Bearer ${unlinkedMgrToken}` },
    });
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body).data).toEqual([]);
  });

  it("HR's tenant-wide access is unaffected by the manager scope fix", async () => {
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/medical/claims",
      headers: { authorization: `Bearer ${hrToken}` },
    });
    expect(r.statusCode).toBe(200);
    const ids = (JSON.parse(r.body).data as Array<{ id: string }>).map((c) => c.id);
    expect(ids).toContain(report1ClaimId);
    expect(ids).toContain(report2ClaimId);
    expect(ids).toContain(managerOwnClaimId);
    expect(ids).toContain(otherClaimId);
  });

  it("a bare employee's own list is still unaffected by any of the manager-scope changes", async () => {
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/medical/claims",
      headers: { authorization: `Bearer ${selfToken}` },
    });
    expect(r.statusCode).toBe(200);
    const ids = (JSON.parse(r.body).data as Array<{ id: string }>).map((c) => c.id);
    expect(ids).toContain(claimId);
    expect(ids).not.toContain(managerOwnClaimId);
    expect(ids).not.toContain(report1ClaimId);
    expect(ids).not.toContain(report2ClaimId);
  });

  it("list response no longer includes diagnosis, documents or remarks — those stay detail-route-only", async () => {
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/medical/claims",
      headers: { authorization: `Bearer ${hrToken}` },
    });
    expect(r.statusCode).toBe(200);
    const rows = JSON.parse(r.body).data as Array<Record<string, unknown>>;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row).not.toHaveProperty("diagnosis");
      expect(row).not.toHaveProperty("documents");
      expect(row).not.toHaveProperty("remarks");
    }
  });
});

describe("GET /v1/hrms/medical/claims — GAP-HR-MEDICAL-01: pagination and DPDP audit trail", () => {
  const claimIds: string[] = [];

  beforeAll(async () => {
    // Three claims, 1s apart by explicit created_at so ORDER BY created_at
    // DESC is deterministic (concurrent NOW() calls could otherwise tie).
    const baseTime = Date.now();
    for (let i = 0; i < 3; i++) {
      const id = randomUUID();
      await asTenant((tx) => tx`
        INSERT INTO medical.hrms_medical_claims (
          id, tenant_id, employee_id, claim_type, amount_minor, hospital_name,
          diagnosis, documents, status, created_at, created_by, updated_by
        ) VALUES (
          ${id}, ${TENANT}, ${PAGINATION_EMPLOYEE_ID}, 'outdoor', 100000, ${"Pagination Hospital " + i},
          'Pagination test fixture', '[]', 'pending', ${new Date(baseTime + i * 1000).toISOString()},
          ${SEED_ACTOR}, ${SEED_ACTOR}
        )
      `);
      claimIds.push(id); // index 0 = oldest; DESC order returns them reversed
    }
  });

  it("limit/offset page through a single employee's claims deterministically (already-implemented server-side; now under regression coverage)", async () => {
    const page1 = await app.inject({
      method: "GET",
      url: `/v1/hrms/medical/claims?employeeId=${PAGINATION_EMPLOYEE_ID}&limit=2&offset=0`,
      headers: { authorization: `Bearer ${hrToken}` },
    });
    expect(page1.statusCode).toBe(200);
    const page1Ids = (JSON.parse(page1.body).data as Array<{ id: string }>).map((c) => c.id);
    expect(page1Ids).toEqual([claimIds[2], claimIds[1]]); // newest-first, 2 rows

    const page2 = await app.inject({
      method: "GET",
      url: `/v1/hrms/medical/claims?employeeId=${PAGINATION_EMPLOYEE_ID}&limit=2&offset=2`,
      headers: { authorization: `Bearer ${hrToken}` },
    });
    expect(page2.statusCode).toBe(200);
    const page2Ids = (JSON.parse(page2.body).data as Array<{ id: string }>).map((c) => c.id);
    expect(page2Ids).toEqual([claimIds[0]]); // the remaining, oldest row
  });

  it("limit above 100 is rejected (400), not silently clamped", async () => {
    const r = await app.inject({
      method: "GET",
      url: `/v1/hrms/medical/claims?employeeId=${PAGINATION_EMPLOYEE_ID}&limit=101`,
      headers: { authorization: `Bearer ${hrToken}` },
    });
    expect(r.statusCode).toBe(400);
  });

  async function latestListAuditRow(): Promise<{ payload: Record<string, unknown> } | undefined> {
    const [row] = await asTenant((tx) => tx`
      SELECT payload FROM _outbox.messages
      WHERE tenant_id = ${TENANT} AND topic = 'audit.event.record'
        AND payload->>'resourceType' = 'medical_claim' AND payload->>'action' = 'list'
      ORDER BY created_at DESC LIMIT 1
    `);
    return row as { payload: Record<string, unknown> } | undefined;
  }

  // The list route publishes the audit event (fire-and-forget: queue.
  // publish() resolves before its consumer runs — see MemoryQueue's own doc
  // comment in services/queue-service/src/bus.ts) rather than writing it
  // synchronously. drain() forces every in-flight delivery for this queue
  // instance to finish before the DB assertions below run — same idiom as
  // disciplinary-case-create-readable-real-db.test.ts.
  async function drainQueue(): Promise<void> {
    await (queue as unknown as { drain: () => Promise<void> }).drain();
  }

  it("an HR list read emits an audit.event.record row with the actor, filter and row count", async () => {
    const r = await app.inject({
      method: "GET",
      url: `/v1/hrms/medical/claims?employeeId=${PAGINATION_EMPLOYEE_ID}&status=pending`,
      headers: { authorization: `Bearer ${hrToken}` },
    });
    expect(r.statusCode).toBe(200);
    await drainQueue();

    const auditRow = await latestListAuditRow();
    if (!auditRow) throw new Error("expected an audit.event.record row after an HR list call");
    expect(auditRow.payload.action).toBe("list");
    expect(auditRow.payload.resourceType).toBe("medical_claim");
    expect(auditRow.payload.rowCount).toBe(3);
    expect((auditRow.payload.filter as { employeeId: string | null }).employeeId).toBe(PAGINATION_EMPLOYEE_ID);
  });

  it("a manager list read also emits an audit event (DPDP: any privileged bulk read of others' health data is audited)", async () => {
    const [before] = await asTenant((tx) => tx`
      SELECT count(*)::int AS n FROM _outbox.messages
      WHERE tenant_id = ${TENANT} AND topic = 'audit.event.record'
        AND payload->>'resourceType' = 'medical_claim' AND payload->>'action' = 'list'
    `);
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/medical/claims",
      headers: { authorization: `Bearer ${managerToken}` },
    });
    expect(r.statusCode).toBe(200);
    await drainQueue();
    const [after] = await asTenant((tx) => tx`
      SELECT count(*)::int AS n FROM _outbox.messages
      WHERE tenant_id = ${TENANT} AND topic = 'audit.event.record'
        AND payload->>'resourceType' = 'medical_claim' AND payload->>'action' = 'list'
    `);
    expect(after?.n).toBe((before?.n ?? 0) + 1);
  });

  it("a bare employee's own-claims list read does NOT emit an audit event (only HR/manager reads of others' data are DPDP-audited)", async () => {
    const [before] = await asTenant((tx) => tx`
      SELECT count(*)::int AS n FROM _outbox.messages
      WHERE tenant_id = ${TENANT} AND topic = 'audit.event.record'
        AND payload->>'resourceType' = 'medical_claim' AND payload->>'action' = 'list'
    `);
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/medical/claims",
      headers: { authorization: `Bearer ${selfToken}` },
    });
    expect(r.statusCode).toBe(200);
    await drainQueue();
    const [after] = await asTenant((tx) => tx`
      SELECT count(*)::int AS n FROM _outbox.messages
      WHERE tenant_id = ${TENANT} AND topic = 'audit.event.record'
        AND payload->>'resourceType' = 'medical_claim' AND payload->>'action' = 'list'
    `);
    expect(after?.n).toBe(before?.n);
  });
});
