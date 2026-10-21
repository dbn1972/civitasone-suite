/**
 * GAP-HR-DPC-02: GET /v1/hrms/lifecycle/promotions?status= takes ONE status or a
 * comma-separated LIST. The DPC page used to ask for `status=pending` -- a status
 * no live write path ever creates (create -> completed / pending_effective, the
 * eOffice submit -> pending_approval) -- so its batch card was always empty and
 * every in-flight promotion was excluded.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { withRawTenantGuc } from "@civitasone/db";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { sqlClient } from "../shared/db.js";

// vitest.config.ts injects JWT_SECRET for every service suite; no literal here (gitleaks scans every commit)
const SECRET = process.env.JWT_SECRET as string;
const TENANT = randomUUID();
const SEED = randomUUID();
const DEPT = randomUUID();
const FROM = randomUUID();
const TO = randomUUID();
const EMP = randomUUID();

const hr = { authorization: `Bearer ${signToken({ sub: randomUUID(), tid: TENANT, roles: ["hr_admin"], sid: "s-dpc-list" }, SECRET, 3600)}` };
const asTenant = <T>(fn: (tx: typeof sqlClient) => Promise<T>) => withRawTenantGuc(sqlClient, TENANT, fn);
let app: FastifyInstance;

const STATUSES = ["pending", "pending_approval", "pending_effective", "completed", "cancelled"] as const;
const idByStatus: Record<string, string> = {};

beforeAll(async () => {
  app = await buildApp();
  await asTenant((tx) => tx`INSERT INTO employee.hrms_departments (id, tenant_id, code, name, created_by, updated_by) VALUES (${DEPT}, ${TENANT}, 'DPL', 'Revenue Department', ${SEED}, ${SEED})`);
  await asTenant((tx) => tx`INSERT INTO employee.hrms_designations (id, tenant_id, code, name, created_by, updated_by) VALUES (${FROM}, ${TENANT}, 'DPLF', 'Section Officer', ${SEED}, ${SEED})`);
  await asTenant((tx) => tx`INSERT INTO employee.hrms_designations (id, tenant_id, code, name, created_by, updated_by) VALUES (${TO}, ${TENANT}, 'DPLT', 'Under Secretary', ${SEED}, ${SEED})`);
  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_employees (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, created_by, updated_by)
    VALUES (${EMP}, ${TENANT}, 'DPL-1', 'Promotion Candidate L', ${DEPT}, ${FROM}, '2015-01-01', ${SEED}, ${SEED})`);
  for (const [i, status] of STATUSES.entries()) {
    const id = randomUUID();
    idByStatus[status] = id;
    await asTenant((tx) => tx`
      INSERT INTO lifecycle.hrms_promotions (id, tenant_id, employee_id, from_desig_id, to_desig_id, effective_date, status, new_basic_minor, created_by, updated_by)
      VALUES (${id}, ${TENANT}, ${EMP}, ${FROM}, ${TO}, ${`2026-0${i + 1}-01`}, ${status}, ${5000000 + i}, ${SEED}, ${SEED})`);
  }
});

afterAll(async () => {
  await asTenant((tx) => tx`DELETE FROM lifecycle.hrms_promotions WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_employees WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_designations WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_departments WHERE tenant_id = ${TENANT}`);
  await app.close();
  await sqlClient.end();
});

const list = async (qs: string) => app.inject({ method: "GET", url: `/v1/hrms/lifecycle/promotions${qs}`, headers: hr });
const ids = (res: { json: () => unknown }) => (res.json() as { data: Array<{ id: string }> }).data.map((d) => d.id).sort();

describe("GET /v1/hrms/lifecycle/promotions?status=<list> (GAP-HR-DPC-02)", () => {
  it("a comma-separated list returns exactly the in-flight rows, enriched with names", async () => {
    const res = await list("?status=pending,pending_approval,pending_effective");
    expect(res.statusCode, res.body).toBe(200);
    expect(ids(res)).toEqual([idByStatus.pending, idByStatus.pending_approval, idByStatus.pending_effective].sort());
    const rows = res.json().data as Array<Record<string, unknown>>;
    for (const r of rows) {
      expect(r).toMatchObject({
        employeeName: "Promotion Candidate L", department: "Revenue Department",
        fromDesignationName: "Section Officer", toDesignationName: "Under Secretary",
      });
      expect(typeof r.newBasicMinor).toBe("string"); // bigint serialised, not a 500
    }
  });

  it("the live-workflow status pending_approval alone matches (the old status=pending filter never would have)", async () => {
    const res = await list("?status=pending_approval");
    expect(ids(res)).toEqual([idByStatus.pending_approval]);
  });

  it("a single status behaves exactly as before", async () => {
    expect(ids(await list("?status=pending"))).toEqual([idByStatus.pending]);
    expect(ids(await list("?status=completed"))).toEqual([idByStatus.completed]);
  });

  it("tolerates spaces and duplicates in the list", async () => {
    const res = await list("?status=pending_effective%2C%20pending_effective%2Ccancelled");
    expect(ids(res)).toEqual([idByStatus.pending_effective, idByStatus.cancelled].sort());
  });

  it("no filter still returns every row", async () => {
    expect((await list("")).json().data).toHaveLength(STATUSES.length);
  });

  it("an unknown status is a 400, never a silent empty list", async () => {
    const res = await list("?status=pending,bogus");
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_FAILED");
    expect((await list("?status=")).statusCode).toBe(400);
  });

  it("stays HR-only", async () => {
    const emp = { authorization: `Bearer ${signToken({ sub: randomUUID(), tid: TENANT, roles: ["employee"], sid: "s" }, SECRET, 3600)}` };
    const res = await app.inject({ method: "GET", url: "/v1/hrms/lifecycle/promotions?status=pending", headers: emp });
    expect(res.statusCode).toBe(403);
  });
});
