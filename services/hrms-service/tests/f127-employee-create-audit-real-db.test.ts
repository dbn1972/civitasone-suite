/**
 * UAT F127: POST /v1/hrms/employees (the single-row create the "Add Employee"
 * wizard uses) inserts the employee in employee/commands.ts and never reaches
 * employee/consumer.ts, so no employee-create audit event was written (the audit
 * DB held 1 hrms employee-create event against 120 employees created on screen).
 * This pins, against the real DB through the Fastify app: exactly one
 * `audit.event.record` outbox row per create, ids only, with the caller as actor,
 * committed with the employee row; and a refused create writes neither.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import type { FastifyInstance } from "fastify";
import { db, sqlClient } from "../src/shared/db.js";
import { buildApp } from "../src/app.js";
import { hrmsEmployees, hrmsDepartments, hrmsDesignations } from "../src/modules/employee/schema.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const HR = randomUUID();
const deptId = randomUUID();
const desigId = randomUUID();
const headers = () => ({
  authorization: `Bearer ${signToken({ sub: HR, tid: TENANT, roles: ["hr_admin"], sid: "s-f127" }, SECRET)}`,
  "content-type": "application/json",
});
const asTenant = <T>(fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>) =>
  runWithTenant(TENANT, () => db.transaction(fn));

type AuditRow = { actor_id: string; topic: string; event_type: string; payload: Record<string, unknown> };

async function employeeAuditRows(resourceId: string): Promise<AuditRow[]> {
  return (await asTenant((tx) => tx.execute(sql`
    SELECT actor_id::text AS actor_id, topic, event_type, payload
      FROM _outbox.messages
     WHERE tenant_id = ${TENANT}::uuid AND topic = 'audit.event.record'
       AND payload->>'resourceType' = 'employee' AND payload->>'resourceId' = ${resourceId}
  `))) as unknown as AuditRow[];
}

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await asTenant(async (tx) => {
    await tx.insert(hrmsDepartments).values({ id: deptId, tenantId: TENANT, code: `F${TENANT.slice(0, 6)}`, name: "Dept", createdBy: HR, updatedBy: HR });
    await tx.insert(hrmsDesignations).values({ id: desigId, tenantId: TENANT, code: `FD${TENANT.slice(0, 6)}`, name: "Desig", createdBy: HR, updatedBy: HR });
  });
});

afterAll(async () => {
  await asTenant(async (tx) => {
    await tx.execute(sql`DELETE FROM _outbox.messages WHERE tenant_id = ${TENANT}::uuid`);
    await tx.delete(hrmsEmployees).where(eq(hrmsEmployees.tenantId, TENANT));
    await tx.delete(hrmsDesignations).where(eq(hrmsDesignations.tenantId, TENANT));
    await tx.delete(hrmsDepartments).where(eq(hrmsDepartments.tenantId, TENANT));
  });
  await app.close();
  await sqlClient.end();
});

const body = (over: Record<string, unknown> = {}) => ({
  employeeNo: `F127-${randomUUID().slice(0, 8)}`, fullName: "Audit Joiner", departmentId: deptId, designationId: desigId,
  dateOfJoining: "2026-11-01", pan: "ABCDE1234F", ...over,
});

describe("employee create audit event (UAT F127)", () => {
  it("POST /v1/hrms/employees writes exactly one employee-create audit event (ids only) with the employee row", async () => {
    const r = await app.inject({ method: "POST", url: "/v1/hrms/employees", headers: headers(), payload: body() });
    expect(r.statusCode).toBe(202);
    const id = (r.json() as { id: string }).id;

    const emp = await asTenant((tx) => tx.select().from(hrmsEmployees).where(eq(hrmsEmployees.id, id)));
    expect(emp).toHaveLength(1);

    const rows = await employeeAuditRows(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actor_id).toBe(HR);
    expect(rows[0]!.event_type).toBe("audit.event.record");
    expect(rows[0]!.payload).toMatchObject({ service: "hrms", action: "create", resourceType: "employee", resourceId: id, outcome: "success" });
    // ids only: no PII from the create body rides on the audit event.
    const text = JSON.stringify(rows[0]!.payload);
    expect(text).not.toContain("Audit Joiner");
    expect(text).not.toContain("ABCDE1234F");
  });

  it("a create refused by the database (duplicate employee number) writes no audit event", async () => {
    const employeeNo = `F127-DUP-${randomUUID().slice(0, 6)}`;
    const first = await app.inject({ method: "POST", url: "/v1/hrms/employees", headers: headers(), payload: body({ employeeNo }) });
    expect(first.statusCode).toBe(202);
    const before = await asTenant((tx) => tx.execute(sql`
      SELECT count(*)::int AS n FROM _outbox.messages WHERE tenant_id = ${TENANT}::uuid AND topic = 'audit.event.record'
    `)) as unknown as Array<{ n: number }>;

    const dup = await app.inject({ method: "POST", url: "/v1/hrms/employees", headers: headers(), payload: body({ employeeNo }) });
    expect(dup.statusCode).toBeGreaterThanOrEqual(400);

    const after = await asTenant((tx) => tx.execute(sql`
      SELECT count(*)::int AS n FROM _outbox.messages WHERE tenant_id = ${TENANT}::uuid AND topic = 'audit.event.record'
    `)) as unknown as Array<{ n: number }>;
    expect(after[0]!.n).toBe(before[0]!.n);
  });
});
