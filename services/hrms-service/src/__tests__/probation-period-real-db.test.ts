/**
 * GAP-HR-CONFIRMATION-05 -- real-DB coverage (no mocks) for the configurable
 * probation period and the extension audit trail:
 *
 *   - GET /v1/hrms/confirmations derives probationEnd from the employee TYPE's
 *     configured probation months (tenant master row, else the canonical
 *     catalogue), not a fixed 2 years; a type that configures nothing keeps the
 *     legacy 24 months.
 *   - PATCH .../probation-extension pre-checks against that SAME period, writes
 *     an extension row AND an audit event, and moves probationEnd/dueDate.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant, withRawTenantGuc } from "@civitasone/db";
import { db, sqlClient } from "../shared/db.js";
import { queue } from "../shared/infra.js";
import { buildApp } from "../app.js";
import { registerEmployeeConsumers } from "../modules/employee/consumer.js";
import { hrmsEmployees, hrmsDepartments, hrmsDesignations, hrmsProbationExtensions } from "../modules/employee/schema.js";
import type { FastifyInstance } from "fastify";
import type { MemoryQueue } from "@civitasone/queue";

registerEmployeeConsumers(queue);
const drain = (): Promise<void> => (queue as unknown as MemoryQueue).drain();

const TENANT = randomUUID();
const ACTOR = randomUUID();
const SECRET = process.env.JWT_SECRET as string; // set by this service vitest.config.ts
const deptId = randomUUID();
const desigId = randomUUID();
const auth = (): { authorization: string; "content-type": string } => ({
  authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles: ["hr_admin"], sid: "s" }, SECRET)}`,
  "content-type": "application/json",
});

let app: FastifyInstance;

async function seedEmployee(name: string, dateOfJoining: string, employeeType: string): Promise<string> {
  const id = randomUUID();
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(hrmsEmployees).values({
      id, tenantId: TENANT, employeeNo: `E-${id.slice(0, 8)}`, fullName: name,
      departmentId: deptId, designationId: desigId, dateOfJoining,
      status: "probation", employeeType, createdBy: ACTOR, updatedBy: ACTOR,
    });
  }));
  return id;
}

async function confirmationRow(id: string): Promise<{ probationEnd: string; dueDate: string; probationMonths: number } | undefined> {
  const r = await app.inject({ method: "GET", url: "/v1/hrms/confirmations", headers: auth() });
  expect(r.statusCode).toBe(200);
  const body = JSON.parse(r.body) as { data: Array<{ id: string; probationEnd: string; dueDate: string; probationMonths: number }> };
  return body.data.find((d) => d.id === id);
}

beforeAll(async () => {
  app = await buildApp();
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(hrmsDepartments).values({ id: deptId, tenantId: TENANT, code: "PPD1", name: "Probation Period Dept", createdBy: ACTOR, updatedBy: ACTOR });
    await tx.insert(hrmsDesignations).values({ id: desigId, tenantId: TENANT, code: "PPS1", name: "Probation Period Designation", createdBy: ACTOR, updatedBy: ACTOR });
  }));
  await withRawTenantGuc(sqlClient, TENANT, async (tx) => {
    await tx`INSERT INTO employee.hrms_employee_types (tenant_id, code, name, default_probation_months, created_by)
             VALUES (${TENANT}, 'PROB12', 'Twelve-month probation', 12, ${ACTOR}), (${TENANT}, 'PROB0', 'Unconfigured probation', 0, ${ACTOR})`;
  });
});

afterAll(async () => {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(hrmsProbationExtensions).where(eq(hrmsProbationExtensions.tenantId, TENANT));
    await tx.delete(hrmsEmployees).where(eq(hrmsEmployees.tenantId, TENANT));
    await tx.delete(hrmsDesignations).where(eq(hrmsDesignations.tenantId, TENANT));
    await tx.delete(hrmsDepartments).where(eq(hrmsDepartments.tenantId, TENANT));
  }));
  await withRawTenantGuc(sqlClient, TENANT, async (tx) => {
    await tx`DELETE FROM employee.hrms_employee_types WHERE tenant_id = ${TENANT}`;
  });
  await app.close();
  await sqlClient.end();
});

describe("GET /v1/hrms/confirmations -- probation period from the employee-type master", () => {
  it("an employee whose type has a 12-month probation policy gets probationEnd = joining + 12 months", async () => {
    const id = await seedEmployee("Twelve Month Policy", "2024-01-01", "PROB12");
    const row = await confirmationRow(id);
    expect(row).toMatchObject({ probationEnd: "2025-01-01", dueDate: "2025-01-01", probationMonths: 12 });
  });

  it("the canonical catalogue period applies when the employeeType is a canonical category (contractual = 6 months)", async () => {
    const id = await seedEmployee("Contractual Six Month", "2024-01-01", "contractual");
    const row = await confirmationRow(id);
    expect(row).toMatchObject({ probationEnd: "2024-07-01", probationMonths: 6 });
  });

  it("a type that configures no period, and the legacy 'permanent' type, keep the previous 24 months", async () => {
    const unconfigured = await seedEmployee("Unconfigured Type", "2024-01-01", "PROB0");
    const legacy = await seedEmployee("Legacy Permanent", "2024-01-01", "permanent");
    expect(await confirmationRow(unconfigured)).toMatchObject({ probationEnd: "2026-01-01", probationMonths: 24 });
    expect(await confirmationRow(legacy)).toMatchObject({ probationEnd: "2026-01-01", probationMonths: 24 });
  });
});

describe("PATCH /v1/hrms/employees/:id/probation-extension -- uses the configured period and writes an audit event", () => {
  it("pre-checks against the type's own probation end: a date that is not later than a 12-month end is rejected, one that is later is accepted", async () => {
    const twelve = await seedEmployee("Extension Twelve", "2024-01-01", "PROB12");
    const legacy = await seedEmployee("Extension Legacy", "2024-01-01", "permanent");
    const payload = { newEndDate: "2025-06-01", reason: "Performance improvement plan ongoing" };

    // 2025-06-01 is after a 12-month end (2025-01-01) but BEFORE the legacy 24-month end (2026-01-01).
    const ok = await app.inject({ method: "PATCH", url: `/v1/hrms/employees/${twelve}/probation-extension`, headers: auth(), payload });
    expect(ok.statusCode).toBe(202);
    const rejected = await app.inject({ method: "PATCH", url: `/v1/hrms/employees/${legacy}/probation-extension`, headers: auth(), payload });
    expect(rejected.statusCode).toBe(400);
    await drain();
  });

  it("writes the extension row and an audit event (probation_extend) carrying previous and new end, and moves probationEnd and dueDate", async () => {
    const id = await seedEmployee("Extension Audit", "2024-01-01", "PROB12");
    const r = await app.inject({
      method: "PATCH", url: `/v1/hrms/employees/${id}/probation-extension`, headers: auth(),
      payload: { newEndDate: "2025-09-01", reason: "Training not yet completed", orderRef: "EXT/2025/044" },
    });
    expect(r.statusCode).toBe(202);
    await drain();

    const ext = await runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(hrmsProbationExtensions).where(eq(hrmsProbationExtensions.employeeId, id))));
    expect(ext).toHaveLength(1);
    expect(ext[0]).toMatchObject({ previousEndDate: "2025-01-01", newEndDate: "2025-09-01", orderRef: "EXT/2025/044", createdBy: ACTOR });

    const events = await withRawTenantGuc(sqlClient, TENANT, (tx) => tx`
      SELECT payload FROM _outbox.messages
      WHERE tenant_id = ${TENANT} AND topic = 'audit.event.record' AND payload->>'resourceId' = ${id}`);
    expect(events).toHaveLength(1);
    const payload = (typeof events[0]!.payload === "string" ? JSON.parse(events[0]!.payload as string) : events[0]!.payload) as Record<string, unknown>;
    expect(payload).toMatchObject({ action: "probation_extend", resourceType: "employee", previousEndDate: "2025-01-01", newEndDate: "2025-09-01" });

    expect(await confirmationRow(id)).toMatchObject({ probationEnd: "2025-09-01", dueDate: "2025-09-01" });
  });
});
