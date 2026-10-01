/**
 * GET /v1/hrms/certifications expiry computation — real-DB round-trip
 * (GAP-HR-CERTIFICATIONS-01).
 *
 * The route used to hard-code `NULL::date AS "expiryDate", 'valid' AS
 * status` for every row, so expiry tracking could never fire against live
 * data regardless of what was actually recorded. This test seeds real
 * training.hrms_trainings.validity_months (migration 0164) +
 * training.hrms_nominations.completed_date and asserts the route computes
 * a correct expiryDate from them (completed_date + validity_months),
 * returns null when either input is missing, and no longer returns a
 * fabricated `status` field at all (status is derived client-side from
 * expiryDate via the single shared apps/web/src/lib/certifications.ts).
 *
 * Dates are fixed, not "now"-relative, so this test is deterministic
 * regardless of which day it runs on.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { withRawTenantGuc } from "@civitasone/db";
import { buildApp } from "../app.js";
import { sqlClient } from "../shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

const TENANT     = "facade00-0f1a-4000-8000-000000000e9c";
const SEED_ACTOR = "facade00-0f1a-4000-8000-0000000000ef";
const DEPT_ID    = "facade00-0f1a-4000-8000-0000000000d9";
const DESIG_ID   = "facade00-0f1a-4000-8000-0000000000da";
const EMP_ID     = "facade00-0f1a-4000-8000-0000000000eb";

const TRAINING_WITH_VALIDITY_ID    = "facade00-0f1a-4000-8000-0000000000c1";
const TRAINING_NO_VALIDITY_ID      = "facade00-0f1a-4000-8000-0000000000c2";

const HR_SUB = "certs-expiry-hr-e9c";
const hrToken = signToken({ sub: HR_SUB, tid: TENANT, roles: ["hr_admin"], sid: "sess-certs-expiry-test" }, SECRET);

let app: Awaited<ReturnType<typeof buildApp>>;

function asTenant<T>(fn: (tx: typeof sqlClient) => Promise<T>): Promise<T> {
  return withRawTenantGuc(sqlClient, TENANT, fn);
}

async function cleanup(): Promise<void> {
  await asTenant((tx) => tx`DELETE FROM training.hrms_nominations WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM training.hrms_trainings WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_employees WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_designations WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_departments WHERE tenant_id = ${TENANT}`);
}

beforeAll(async () => {
  await cleanup();

  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_departments (id, tenant_id, code, name, created_by, updated_by)
    VALUES (${DEPT_ID}, ${TENANT}, 'CERTEXP', 'Certifications Expiry Test Dept', ${SEED_ACTOR}, ${SEED_ACTOR})
  `);
  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_designations (id, tenant_id, code, name, created_by, updated_by)
    VALUES (${DESIG_ID}, ${TENANT}, 'CERTEXP', 'Certifications Expiry Test Designation', ${SEED_ACTOR}, ${SEED_ACTOR})
  `);
  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_employees
      (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, user_ref, created_by, updated_by)
    VALUES (${EMP_ID}, ${TENANT}, 'CERTEXP-001', 'Certs Expiry Employee', ${DEPT_ID}, ${DESIG_ID}, '2020-01-01', ${HR_SUB}, ${SEED_ACTOR}, ${SEED_ACTOR})
  `);

  // Training WITH a recorded validity period (12 months).
  await asTenant((tx) => tx`
    INSERT INTO training.hrms_trainings (id, tenant_id, title, from_date, to_date, validity_months, created_by, updated_by)
    VALUES (${TRAINING_WITH_VALIDITY_ID}, ${TENANT}, 'Certs Expiry Training (12mo validity)', '2025-01-10', '2025-01-11', 12, ${SEED_ACTOR}, ${SEED_ACTOR})
  `);
  // Training with NO recorded validity (validity_months left NULL -- the
  // real post-migration state for every pre-existing programme).
  await asTenant((tx) => tx`
    INSERT INTO training.hrms_trainings (id, tenant_id, title, from_date, to_date, created_by, updated_by)
    VALUES (${TRAINING_NO_VALIDITY_ID}, ${TENANT}, 'Certs Expiry Training (no validity)', '2025-02-10', '2025-02-11', ${SEED_ACTOR}, ${SEED_ACTOR})
  `);

  // Completed the validity-tracked training on a FIXED date -> expiryDate
  // must be exactly completed_date + 12 months, computed in SQL.
  await asTenant((tx) => tx`
    INSERT INTO training.hrms_nominations (id, tenant_id, training_id, employee_id, status, certificate_ref, completed_date, created_by, updated_by)
    VALUES (gen_random_uuid(), ${TENANT}, ${TRAINING_WITH_VALIDITY_ID}, ${EMP_ID}, 'completed', 'CERT-WITH-VALIDITY', '2025-01-15', ${SEED_ACTOR}, ${SEED_ACTOR})
  `);
  // Completed the no-validity training -> expiryDate must be null.
  await asTenant((tx) => tx`
    INSERT INTO training.hrms_nominations (id, tenant_id, training_id, employee_id, status, certificate_ref, completed_date, created_by, updated_by)
    VALUES (gen_random_uuid(), ${TENANT}, ${TRAINING_NO_VALIDITY_ID}, ${EMP_ID}, 'completed', 'CERT-NO-VALIDITY', '2025-02-15', ${SEED_ACTOR}, ${SEED_ACTOR})
  `);

  app = await buildApp();
});

afterAll(async () => {
  await cleanup();
  await app.close();
  await sqlClient.end();
});

describe("GET /v1/hrms/certifications — real expiryDate computation (GAP-HR-CERTIFICATIONS-01)", () => {
  it("computes expiryDate = completed_date + validity_months when both are known", async () => {
    const r = await app.inject({
      method: "GET", url: "/v1/hrms/certifications",
      headers: { authorization: `Bearer ${hrToken}` },
    });
    expect(r.statusCode).toBe(200);
    const rows = JSON.parse(r.body).data as Array<{ certificateRef?: string; certificate_ref?: string; expiryDate: string | null; trainingId: string; status?: unknown }>;
    const withValidity = rows.find((row) => row.trainingId === TRAINING_WITH_VALIDITY_ID);
    expect(withValidity).toBeTruthy();
    // 2025-01-15 + 12 months = 2026-01-15
    expect(String(withValidity!.expiryDate).slice(0, 10)).toBe("2026-01-15");
  });

  it("returns expiryDate null when the training has no recorded validity_months", async () => {
    const r = await app.inject({
      method: "GET", url: "/v1/hrms/certifications",
      headers: { authorization: `Bearer ${hrToken}` },
    });
    expect(r.statusCode).toBe(200);
    const rows = JSON.parse(r.body).data as Array<{ trainingId: string; expiryDate: string | null }>;
    const noValidity = rows.find((row) => row.trainingId === TRAINING_NO_VALIDITY_ID);
    expect(noValidity).toBeTruthy();
    expect(noValidity!.expiryDate).toBeNull();
  });

  it("no longer returns a fabricated status field", async () => {
    const r = await app.inject({
      method: "GET", url: "/v1/hrms/certifications",
      headers: { authorization: `Bearer ${hrToken}` },
    });
    const rows = JSON.parse(r.body).data as Array<Record<string, unknown>>;
    for (const row of rows) {
      expect(row.status).toBeUndefined();
    }
  });

  it("also returns trainingId (used by the web layer for the GAP-HR-CERTIFICATIONS-03 renewal link)", async () => {
    const r = await app.inject({
      method: "GET", url: "/v1/hrms/certifications",
      headers: { authorization: `Bearer ${hrToken}` },
    });
    const rows = JSON.parse(r.body).data as Array<{ trainingId: string }>;
    expect(rows.every((row) => typeof row.trainingId === "string" && row.trainingId.length > 0)).toBe(true);
  });
});
