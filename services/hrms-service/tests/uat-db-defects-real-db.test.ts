/**
 * UAT DB test report g1-hrms (2026-10-29): writes accepted with 2xx/202 and then lost or dead-lettered in the worker.
 * Real DB, real routes, the real queue consumers drained in-process (no mocks).
 *  3. reservation-attributes {category:"UR"} violated hrms_candidates_category_check (allows GEN) -> row never updated
 *  4. duplicate job-opening refNo -> 202 then unique-violation dead letter  (now 409)
 *  5. application for a nonexistent opening -> 202 then FK dead letter      (now 404)
 *  6. contract for a non-"contract" employee -> 202 then silent rejection   (now 422); the 202 id is now the contract id
 *  8. module error handlers dropped fieldErrors
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { withRawTenantGuc } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerF3_recruitment_Consumers } from "../src/modules/recruitment/f3-consumer.js";
import { registerRecruitmentConsumers } from "../src/modules/recruitment/consumer.js";
import { registerContractConsumers } from "../src/modules/contracts/consumer.js";
import { toStoredCategory } from "../src/modules/recruitment/reference-domain.js";

registerF3_recruitment_Consumers(queue);
registerRecruitmentConsumers(queue);
registerContractConsumers(queue);
const drain = (): Promise<void> => (queue as unknown as { drain: () => Promise<void> }).drain();

const SECRET = process.env.JWT_SECRET ?? "";
const T = "5e7c0003-0000-4000-8000-000000000001";
const ACTOR = "5e7c0003-0000-4000-8000-0000000000a1";
const DEPT = "5e7c0003-0000-4000-8000-0000000000d1";
const DESIG = "5e7c0003-0000-4000-8000-0000000000d2";
const CONTRACT_EMP = "5e7c0003-0000-4000-8000-0000000000e1";
const PERM_EMP = "5e7c0003-0000-4000-8000-0000000000e2";
const CAND = "5e7c0003-0000-4000-8000-0000000000c1";
const hr = { authorization: `Bearer ${signToken({ sub: ACTOR, tid: T, roles: ["hr_admin"], sid: "sess-uat-db" }, SECRET)}` };

const asTenant = <R>(fn: (tx: typeof sqlClient) => Promise<R>) => withRawTenantGuc(sqlClient, T, fn);
let app: Awaited<ReturnType<typeof buildApp>>;

async function cleanup(): Promise<void> {
  await asTenant(async (tx) => {
    await tx`DELETE FROM candidate.hrms_candidates WHERE tenant_id = ${T}`;
    await tx`DELETE FROM recruitment.hrms_applications WHERE tenant_id = ${T}`;
    await tx`DELETE FROM recruitment.hrms_job_openings WHERE tenant_id = ${T}`;
    await tx`DELETE FROM contracts.hrms_contracts WHERE tenant_id = ${T}`;
    await tx`DELETE FROM employee.hrms_employees WHERE tenant_id = ${T}`;
    await tx`DELETE FROM employee.hrms_designations WHERE tenant_id = ${T}`;
    await tx`DELETE FROM employee.hrms_departments WHERE tenant_id = ${T}`;
  });
}

beforeAll(async () => {
  app = await buildApp();
  await cleanup();
  await asTenant(async (tx) => {
    await tx`INSERT INTO employee.hrms_departments (id, tenant_id, code, name, created_by, updated_by) VALUES (${DEPT}, ${T}, 'D', 'Dept', ${ACTOR}, ${ACTOR})`;
    await tx`INSERT INTO employee.hrms_designations (id, tenant_id, code, name, created_by, updated_by) VALUES (${DESIG}, ${T}, 'G', 'Grade', ${ACTOR}, ${ACTOR})`;
    for (const [id, no, type] of [[CONTRACT_EMP, "UDB-1", "contract"], [PERM_EMP, "UDB-2", "permanent"]] as const) {
      await tx`INSERT INTO employee.hrms_employees (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, email, status, employee_type, created_by, updated_by)
               VALUES (${id}, ${T}, ${no}, ${"Emp " + no}, ${DEPT}, ${DESIG}, '2024-01-01', ${no.toLowerCase() + "@example.gov.in"}, 'confirmed', ${type}, ${ACTOR}, ${ACTOR})`;
    }
    await tx`INSERT INTO candidate.hrms_candidates (id, tenant_id, email, normalized_email, status, created_by, updated_by) VALUES (${CAND}, ${T}, 'c@example.gov.in', 'c@example.gov.in', 'draft', ${ACTOR}, ${ACTOR})`;
  });
});
afterAll(async () => { await cleanup(); await app.close(); await sqlClient.end(); });

describe("item 3: reservation-attributes category is stored as the schema's value", () => {
  it("toStoredCategory maps the unreserved synonym UR to GEN and upper-cases the rest", () => {
    expect(toStoredCategory("UR")).toBe("GEN");
    expect(toStoredCategory(" ur ")).toBe("GEN");
    expect(toStoredCategory("gen")).toBe("GEN");
    expect(toStoredCategory("obc")).toBe("OBC");
    expect(toStoredCategory("")).toBeNull();
    expect(toStoredCategory(undefined)).toBeNull();
  });
  const category = async () => (await asTenant((tx) => tx`SELECT category FROM candidate.hrms_candidates WHERE id = ${CAND}`))[0]!.category;
  it("PUT {category:'UR'} answers 200 AND the row is updated (no CHECK violation in the worker)", async () => {
    const res = await app.inject({ method: "PUT", url: `/v1/hrms/candidates/${CAND}/reservation-attributes`, headers: hr, payload: { category: "UR" } });
    expect(res.statusCode).toBe(200);
    await drain();
    expect(await category()).toBe("GEN");
  });
  it("a reserved category with its certificate persists upper-cased", async () => {
    const res = await app.inject({ method: "PUT", url: `/v1/hrms/candidates/${CAND}/reservation-attributes`, headers: hr, payload: { category: "obc", reservationDocs: ["cert-1"] } });
    expect(res.statusCode).toBe(200);
    await drain();
    expect(await category()).toBe("OBC");
  });
});

describe("items 4 + 5: job openings and applications are validated before they are accepted", () => {
  const opening = (refNo: string) => ({ refNo, title: "Clerk", departmentId: DEPT });
  let openingId = "";
  it("first POST /job-openings is accepted and lands; a duplicate refNo is 409 DUPLICATE_REF_NO", async () => {
    const first = await app.inject({ method: "POST", url: "/v1/hrms/job-openings", headers: hr, payload: opening("UDB-REF-1") });
    expect(first.statusCode).toBe(202);
    openingId = first.json().id;
    await drain();
    const rows = await asTenant((tx) => tx`SELECT id FROM recruitment.hrms_job_openings WHERE tenant_id = ${T} AND ref_no = 'UDB-REF-1'`);
    expect(rows).toHaveLength(1);
    const dup = await app.inject({ method: "POST", url: "/v1/hrms/job-openings", headers: hr, payload: opening("UDB-REF-1") });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().code).toBe("DUPLICATE_REF_NO");
  });
  it("POST /applications for a nonexistent opening is 404, for an existing one 202", async () => {
    const missing = await app.inject({ method: "POST", url: "/v1/hrms/applications", headers: hr, payload: { jobOpeningId: "5e7c0003-0000-4000-8000-0000000000ff", applicantName: "Nobody" } });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().code).toBe("JOB_OPENING_NOT_FOUND");
    const rows = await asTenant((tx) => tx`SELECT id FROM recruitment.hrms_job_openings WHERE tenant_id = ${T} AND ref_no = 'UDB-REF-1'`);
    const ok = await app.inject({ method: "POST", url: "/v1/hrms/applications", headers: hr, payload: { jobOpeningId: rows[0]!.id, applicantName: "Somebody" } });
    expect(ok.statusCode).toBe(202);
    expect(openingId).not.toBe("");
  });
});

describe("item 6: contracts", () => {
  const body = (employeeId: string) => ({ employeeId, startDate: "2026-01-01", endDate: "2026-12-31", terms: { role: "Analyst", compensationMinor: "5000000" } });
  it("a non-'contract' employee is rejected before acceptance (422)", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/hrms/contracts", headers: hr, payload: body(PERM_EMP) });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("EMPLOYEE_NOT_CONTRACT_TYPE");
  });
  it("an unknown employee is 404", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/hrms/contracts", headers: hr, payload: body("5e7c0003-0000-4000-8000-0000000000fe") });
    expect(res.statusCode).toBe(404);
  });
  it("the 202 id IS the contract id: it is readable and usable on /contracts/:id/activate", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/hrms/contracts", headers: hr, payload: body(CONTRACT_EMP) });
    expect(res.statusCode).toBe(202);
    const id = res.json().id;
    await drain();
    const read = await app.inject({ method: "GET", url: `/v1/hrms/contracts/${id}`, headers: hr });
    expect(read.statusCode).toBe(200);
    expect(read.json().data.id).toBe(id);
    const act = await app.inject({ method: "POST", url: `/v1/hrms/contracts/${id}/activate`, headers: hr, payload: { version: 1 } });
    expect(act.statusCode).toBe(202);
    await drain();
    const after = await app.inject({ method: "GET", url: `/v1/hrms/contracts/${id}`, headers: hr });
    expect(after.json().data.status).toBe("active");
    // an active contract blocks a second create up front
    const again = await app.inject({ method: "POST", url: "/v1/hrms/contracts", headers: hr, payload: body(CONTRACT_EMP) });
    expect(again.statusCode).toBe(409);
  });
  it("activate / terminate on an unknown contract id are 404, not a silent 202", async () => {
    const unknown = "5e7c0003-0000-4000-8000-0000000000fd";
    expect((await app.inject({ method: "POST", url: `/v1/hrms/contracts/${unknown}/activate`, headers: hr, payload: { version: 1 } })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: `/v1/hrms/contracts/${unknown}/terminate`, headers: hr, payload: { version: 1, reason: "x" } })).statusCode).toBe(404);
  });
});

describe("item 8: validation failures name the offending fields", () => {
  for (const [method, url] of [
    ["POST", `/v1/hrms/employees/${CONTRACT_EMP}/nominees`],
    ["POST", `/v1/hrms/employees/${CONTRACT_EMP}/addresses`],
    ["POST", "/v1/hrms/contracts"],
    ["POST", "/v1/hrms/lifecycle/transfers"],
    ["POST", "/v1/hrms/shifts"],
    ["POST", "/v1/hrms/apar"],
    ["POST", "/v1/hrms/assessments/questions"],
  ] as const) {
    it(`${method} ${url} {} -> 400 with fieldErrors`, async () => {
      const res = await app.inject({ method, url, headers: hr, payload: {} });
      expect(res.statusCode).toBe(400);
      const b = res.json();
      expect(b.code).toBe("VALIDATION_FAILED");
      expect(Array.isArray(b.fieldErrors) && b.fieldErrors.length > 0).toBe(true);
    });
  }
});
