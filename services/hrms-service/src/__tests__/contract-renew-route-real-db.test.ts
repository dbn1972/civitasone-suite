/**
 * POST /v1/hrms/contracts/:id/renew creates the renewal -- through the ROUTE, real DB (no mocks).
 * Before the fix the route published the command without a resource id (the consumer inserted the renewal with
 * id = undefined) and without newTerms (new_terms is NOT NULL), so a renewal started with just {newEndDate}
 * answered 202 and then silently created nothing.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { withRawTenantGuc } from "@civitasone/db";
import type { MemoryQueue } from "@civitasone/queue";
import { buildApp } from "../app.js";
import { sqlClient } from "../shared/db.js";
import { queue } from "../shared/infra.js";
import { registerContractConsumers } from "../modules/contracts/consumer.js";

registerContractConsumers(queue);

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "facade00-5d5d-4000-8000-000000006a01";
const SEED = "facade00-5d5d-4000-8000-0000000061ff";
const DEPT = "facade00-5d5d-4000-8000-0000000061d1", DESIG = "facade00-5d5d-4000-8000-0000000061d2";
const HR_EMP = "facade00-5d5d-4000-8000-0000000061e1", STAFF_EMP = "facade00-5d5d-4000-8000-0000000061e2";
const SUB_HR = "facade00-5d5d-4000-8000-0000000061a1";
const CONTRACT = "facade00-5d5d-4000-8000-0000000061c1";

const hr = () => ({ authorization: `Bearer ${signToken({ sub: SUB_HR, tid: TENANT, roles: ["hr_admin"], sid: "sess-renew" }, SECRET)}` });
const asTenant = <T>(fn: (tx: typeof sqlClient) => Promise<T>): Promise<T> => withRawTenantGuc(sqlClient, TENANT, fn);
let app: Awaited<ReturnType<typeof buildApp>>;

async function cleanup(): Promise<void> {
  for (const t of ["contracts.hrms_contract_renewals", "contracts.hrms_contracts", "employee.hrms_employees", "employee.hrms_designations", "employee.hrms_departments"]) {
    await asTenant((tx) => tx.unsafe(`DELETE FROM ${t} WHERE tenant_id = '${TENANT}'`));
  }
}

beforeAll(async () => {
  await cleanup();
  await asTenant((tx) => tx`INSERT INTO employee.hrms_departments (id, tenant_id, code, name, created_by, updated_by) VALUES (${DEPT}, ${TENANT}, 'PMU', 'Programme Management Unit', ${SEED}, ${SEED})`);
  await asTenant((tx) => tx`INSERT INTO employee.hrms_designations (id, tenant_id, code, name, level, created_by, updated_by) VALUES (${DESIG}, ${TENANT}, 'PA', 'Project Associate', 5, ${SEED}, ${SEED})`);
  for (const [id, no, name, sub, type] of [[HR_EMP, "REN-HR", "Kavita Menon", SUB_HR, "permanent"], [STAFF_EMP, "REN-001", "Anil Kumar Verma", null, "contract"]] as const) {
    await asTenant((tx) => tx`INSERT INTO employee.hrms_employees (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, employee_type, user_ref, created_by, updated_by)
      VALUES (${id}, ${TENANT}, ${no}, ${name}, ${DEPT}, ${DESIG}, '2025-04-01', ${type}, ${sub}, ${SEED}, ${SEED})`);
  }
  await asTenant((tx) => tx`INSERT INTO contracts.hrms_contracts (id, tenant_id, employee_id, contract_no, start_date, end_date, status, terms, created_by, updated_by)
    VALUES (${CONTRACT}, ${TENANT}, ${STAFF_EMP}, 'CON-REN-0001', '2026-04-01', '2027-03-31', 'active', ${JSON.stringify({ role: "Project Analyst", compensationMinor: "6500000", currency: "INR" })}::jsonb, ${SEED}, ${SEED})`);
  app = await buildApp();
});
afterAll(async () => { await cleanup(); await app.close(); await sqlClient.end(); });

describe("POST /v1/hrms/contracts/:id/renew", () => {
  it("renewing with only newEndDate creates the renewal, and the returned id reads back (200)", async () => {
    const r = await app.inject({ method: "POST", url: `/v1/hrms/contracts/${CONTRACT}/renew`, headers: hr(), payload: { newEndDate: "2028-03-31", reason: "Project phase 2 sanctioned" } });
    expect(r.statusCode).toBe(202);
    const { id } = r.json() as { id: string };
    await (queue as unknown as MemoryQueue).drain();
    const rows = await asTenant((tx) => tx`SELECT id, status, new_end_date::text, new_terms FROM contracts.hrms_contract_renewals WHERE contract_id = ${CONTRACT}`);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(id);
    expect(rows[0]!.status).toBe("pending_approval");
    expect(rows[0]!.new_end_date).toBe("2028-03-31");
    // no terms supplied: the current terms are carried forward
    expect((rows[0]!.new_terms as { role: string }).role).toBe("Project Analyst");
    const g = await app.inject({ method: "GET", url: `/v1/hrms/contracts/renewals/${id}`, headers: hr() });
    expect(g.statusCode).toBe(200);
    expect((g.json() as { data: { id: string } }).data.id).toBe(id);
  });

  it("supplied terms overlay the carried-forward ones", async () => {
    await asTenant((tx) => tx`DELETE FROM contracts.hrms_contract_renewals WHERE contract_id = ${CONTRACT}`);
    const r = await app.inject({ method: "POST", url: `/v1/hrms/contracts/${CONTRACT}/renew`, headers: hr(), payload: { newEndDate: "2028-03-31", newTerms: { role: "Senior Project Analyst" } } });
    expect(r.statusCode).toBe(202);
    await (queue as unknown as MemoryQueue).drain();
    const t = (await asTenant((tx) => tx`SELECT new_terms FROM contracts.hrms_contract_renewals WHERE contract_id = ${CONTRACT}`))[0]!.new_terms as Record<string, string>;
    expect(t).toMatchObject({ role: "Senior Project Analyst", compensationMinor: "6500000", currency: "INR" });
  });
});
