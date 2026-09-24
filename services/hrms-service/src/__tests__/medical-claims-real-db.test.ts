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
import { signToken } from "@civitasone/auth";
import { withRawTenantGuc } from "@civitasone/db";
import { buildApp } from "../app.js";
import { sqlClient } from "../shared/db.js";

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

let app: Awaited<ReturnType<typeof buildApp>>;

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

  app = await buildApp();
});

afterAll(async () => {
  await cleanup();
  await app.close();
  await sqlClient.end();
});

describe("medical claims — real round-trip against medical.hrms_medical_claims", () => {
  let claimId: string;
  let otherClaimId: string;

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
});
