/**
 * GAP-HR-EMPLOYEES-IMPORT-05 -- end to end against a real database: a bulk
 * import row naming a managerEmployeeNo creates an employee whose reporting
 * manager is actually stored, and whose detail record shows "reportingTo".
 *
 * POST /v1/hrms/employees/bulk (resolves the number to an id, queues the create)
 *   -> hrms.employee.create consumer (inserts the row, managerId included)
 *   -> GET /v1/hrms/employees/:id (reportingTo resolved from managerId).
 * The consumer used to drop managerId, so the first and last link never met.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import type { MemoryQueue } from "@civitasone/queue";
import type { FastifyInstance } from "fastify";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { buildApp } from "../src/app.js";
import { registerEmployeeConsumers } from "../src/modules/employee/consumer.js";
import { hrmsEmployees, hrmsDepartments, hrmsDesignations } from "../src/modules/employee/schema.js";

registerEmployeeConsumers(queue);
const drain = () => (queue as unknown as MemoryQueue).drain();

const SECRET = process.env.JWT_SECRET ?? "";
const TENANT = randomUUID();
const OTHER_TENANT = randomUUID();
const HR = randomUUID();
const deptId = randomUUID();
const desigId = randomUUID();
const mgrId = randomUUID();
const otherTenantMgrId = randomUUID();
const hrHeaders = {
  authorization: `Bearer ${signToken({ sub: HR, tid: TENANT, roles: ["hr_admin"], sid: "s" }, SECRET)}`,
  "content-type": "application/json",
};
const asTenant = <T>(tenant: string, fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>) =>
  runWithTenant(tenant, () => db.transaction(fn));

let app: FastifyInstance;

const row = (employeeNo: string, over: Record<string, unknown> = {}) => ({
  employeeNo, fullName: `Imported ${employeeNo}`, departmentId: deptId, designationId: desigId,
  dateOfJoining: "2026-04-01", employeeType: "permanent", basicMinor: 4490050, ...over,
});
const bulk = (employees: unknown[]) => app.inject({ method: "POST", url: "/v1/hrms/employees/bulk", headers: hrHeaders, payload: { employees } });
const findByNo = async (no: string) => (await asTenant(TENANT, (tx) =>
  tx.select().from(hrmsEmployees).where(and(eq(hrmsEmployees.tenantId, TENANT), eq(hrmsEmployees.employeeNo, no)))))[0];

beforeAll(async () => {
  app = await buildApp();
  await asTenant(TENANT, async (tx) => {
    await tx.insert(hrmsDepartments).values({ id: deptId, tenantId: TENANT, code: `B${TENANT.slice(0, 6)}`, name: "Dept", createdBy: HR, updatedBy: HR });
    await tx.insert(hrmsDesignations).values({ id: desigId, tenantId: TENANT, code: `BD${TENANT.slice(0, 6)}`, name: "Desig", createdBy: HR, updatedBy: HR });
    await tx.insert(hrmsEmployees).values({
      id: mgrId, tenantId: TENANT, employeeNo: "BULK-MGR", fullName: "Boss Person", departmentId: deptId, designationId: desigId,
      dateOfJoining: "2015-01-01", status: "confirmed", employeeType: "permanent", basicMinor: 9_000_000n, createdBy: HR, updatedBy: HR,
    });
  });
  // The same employee number exists in ANOTHER tenant: it must never resolve.
  await asTenant(OTHER_TENANT, async (tx) => {
    await tx.insert(hrmsDepartments).values({ id: randomUUID(), tenantId: OTHER_TENANT, code: `O${OTHER_TENANT.slice(0, 6)}`, name: "Other", createdBy: HR, updatedBy: HR });
  });
});

afterAll(async () => {
  for (const t of [TENANT, OTHER_TENANT]) {
    await asTenant(t, async (tx) => {
      await tx.delete(hrmsEmployees).where(eq(hrmsEmployees.tenantId, t));
      await tx.delete(hrmsDesignations).where(eq(hrmsDesignations.tenantId, t));
      await tx.delete(hrmsDepartments).where(eq(hrmsDepartments.tenantId, t));
    });
  }
  await app.close();
  await sqlClient.end();
});

describe("bulk import managerEmployeeNo, end to end (GAP-HR-EMPLOYEES-IMPORT-05)", () => {
  it("stores the resolved manager on the new employee, whose detail record shows reportingTo", async () => {
    const res = await bulk([row("BULK-001", { managerEmployeeNo: "BULK-MGR" }), row("BULK-002")]);
    expect(res.statusCode).toBe(202);
    await drain();

    const withMgr = await findByNo("BULK-001");
    const without = await findByNo("BULK-002");
    expect(withMgr?.managerId).toBe(mgrId);
    expect(without).toBeDefined();
    expect(without?.managerId).toBeNull();

    const detail = await app.inject({ method: "GET", url: `/v1/hrms/employees/${withMgr!.id}`, headers: hrHeaders });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({ reportingTo: "Boss Person", managerId: mgrId });
    const detailNoMgr = (await app.inject({ method: "GET", url: `/v1/hrms/employees/${without!.id}`, headers: hrHeaders })).json();
    expect(detailNoMgr).not.toHaveProperty("reportingTo");
  });

  it("an unknown manager number is a row-level error and creates nobody", async () => {
    const res = await bulk([row("BULK-010", { managerEmployeeNo: "NOPE-1" })]);
    expect(res.statusCode).toBe(400);
    expect(res.json<{ fieldErrors: { field: string; message: string }[] }>().fieldErrors).toEqual([
      expect.objectContaining({ field: "employees.0.managerEmployeeNo", message: expect.stringContaining("Unknown manager employee number") }),
    ]);
    await drain();
    expect(await findByNo("BULK-010")).toBeUndefined();
  });

  it("does not resolve a manager number that exists only in another tenant", async () => {
    await asTenant(OTHER_TENANT, async (tx) => {
      const dept = (await tx.select().from(hrmsDepartments).where(eq(hrmsDepartments.tenantId, OTHER_TENANT)))[0]!;
      const desigId2 = randomUUID();
      await tx.insert(hrmsDesignations).values({ id: desigId2, tenantId: OTHER_TENANT, code: `OD${OTHER_TENANT.slice(0, 6)}`, name: "Other Desig", createdBy: HR, updatedBy: HR });
      await tx.insert(hrmsEmployees).values({
        id: otherTenantMgrId, tenantId: OTHER_TENANT, employeeNo: "OTHER-ONLY-MGR", fullName: "Elsewhere Boss", departmentId: dept.id, designationId: desigId2,
        dateOfJoining: "2015-01-01", status: "confirmed", employeeType: "permanent", basicMinor: 1n, createdBy: HR, updatedBy: HR,
      });
    });
    const res = await bulk([row("BULK-020", { managerEmployeeNo: "OTHER-ONLY-MGR" })]);
    expect(res.statusCode).toBe(400);
    await drain();
    expect(await findByNo("BULK-020")).toBeUndefined();
  });
});
