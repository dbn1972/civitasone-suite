/**
 * Real-Postgres coverage for this PR's three confirmation-page fixes:
 *
 *   GAP-HR-CONFIRMATION-01 (partial): GET /v1/hrms/confirmations now
 *     resolves each row's real designation (previously always "—" — the
 *     backend never joined it at all).
 *   GAP-HR-CONFIRMATION-02: PATCH .../confirm now requires a real orderRef,
 *     rejects a postdated or pre-joining confirmationDate, and persists a
 *     service-book entry (not just an audit line) carrying that orderRef.
 *   GAP-HR-CONFIRMATION-05: the new PATCH .../probation-extension endpoint
 *     records an extension, and a subsequent GET /v1/hrms/confirmations
 *     reflects the new probation end instead of the unconditional +2y
 *     default.
 *
 * Exercised via app.inject() + the real async command→consumer path
 * (registerEmployeeConsumers + drain), same pattern as tests/
 * employee-status-guards-real-db.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../shared/db.js";
import { queue } from "../shared/infra.js";
import { buildApp } from "../app.js";
import { registerEmployeeConsumers } from "../modules/employee/consumer.js";
import { hrmsEmployees, hrmsDepartments, hrmsDesignations } from "../modules/employee/schema.js";
import { hrmsServiceBookEntries } from "../modules/service-book/schema.js";
import type { FastifyInstance } from "fastify";
import type { MemoryQueue } from "@civitasone/queue";

registerEmployeeConsumers(queue);

async function drain(): Promise<void> {
  await (queue as unknown as MemoryQueue).drain();
}

const TENANT = randomUUID();
const ACTOR = randomUUID();
const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const deptId = randomUUID();
const desigId = randomUUID();

const tok = (roles = ["hr_admin"]) => signToken({ sub: ACTOR, tid: TENANT, roles, sid: "s" }, SECRET);
const auth = (roles = ["hr_admin"]) => ({ authorization: `Bearer ${tok(roles)}`, "content-type": "application/json" });

let app: FastifyInstance;

async function seedEmployee(name: string, dateOfJoining: string): Promise<string> {
  const id = randomUUID();
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(hrmsEmployees).values({
      id, tenantId: TENANT, employeeNo: `E-${id.slice(0, 8)}`, fullName: name,
      departmentId: deptId, designationId: desigId, dateOfJoining,
      status: "probation", employeeType: "permanent", createdBy: ACTOR, updatedBy: ACTOR,
    });
  }));
  return id;
}

async function readEmployeeStatus(id: string): Promise<string | undefined> {
  const rows = await runWithTenant(TENANT, () => db.transaction((tx) => tx.select({ status: hrmsEmployees.status })
    .from(hrmsEmployees).where(and(eq(hrmsEmployees.id, id), eq(hrmsEmployees.tenantId, TENANT))).limit(1)));
  return rows[0]?.status;
}

async function readServiceBookEntries(employeeId: string): Promise<Array<{ entryType: string; documentRef: string | null; effectiveDate: string }>> {
  return runWithTenant(TENANT, () => db.transaction((tx) => tx.select({
    entryType: hrmsServiceBookEntries.entryType,
    documentRef: hrmsServiceBookEntries.documentRef,
    effectiveDate: hrmsServiceBookEntries.effectiveDate,
  }).from(hrmsServiceBookEntries).where(and(eq(hrmsServiceBookEntries.tenantId, TENANT), eq(hrmsServiceBookEntries.employeeId, employeeId)))));
}

beforeAll(async () => {
  app = await buildApp();
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(hrmsDepartments).values({ id: deptId, tenantId: TENANT, code: "CFD1", name: "Confirmation Test Dept", createdBy: ACTOR, updatedBy: ACTOR });
    await tx.insert(hrmsDesignations).values({ id: desigId, tenantId: TENANT, code: "CFDS1", name: "Confirmation Test Designation", createdBy: ACTOR, updatedBy: ACTOR });
  }));
});

afterAll(async () => {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(hrmsServiceBookEntries).where(eq(hrmsServiceBookEntries.tenantId, TENANT));
    await tx.delete(hrmsEmployees).where(eq(hrmsEmployees.tenantId, TENANT));
    await tx.delete(hrmsDesignations).where(eq(hrmsDesignations.tenantId, TENANT));
    await tx.delete(hrmsDepartments).where(eq(hrmsDepartments.tenantId, TENANT));
  }));
  await app.close();
  await sqlClient.end();
});

describe("GET /v1/hrms/confirmations — GAP-HR-CONFIRMATION-01 (partial)", () => {
  it("resolves the real designation instead of always '—'", async () => {
    const id = await seedEmployee("Confirmation Designation Check", "2024-01-01");
    const r = await app.inject({ method: "GET", url: "/v1/hrms/confirmations", headers: auth() });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body) as { data: Array<{ id: string; designation?: string }> };
    const row = body.data.find((d) => d.id === id);
    expect(row?.designation).toBe("Confirmation Test Designation");
  });
});

describe("PATCH /v1/hrms/employees/:id/confirm — GAP-HR-CONFIRMATION-02", () => {
  it("rejects a confirmation with no order reference", async () => {
    const id = await seedEmployee("No OrderRef Case", "2024-01-01");
    const r = await app.inject({
      method: "PATCH", url: `/v1/hrms/employees/${id}/confirm`,
      headers: auth(), payload: { confirmationDate: "2026-01-15" },
    });
    expect(r.statusCode).toBe(400);
  });

  it("rejects a confirmation date before the employee's date of joining", async () => {
    const id = await seedEmployee("Pre-Joining Date Case", "2024-06-01");
    const r = await app.inject({
      method: "PATCH", url: `/v1/hrms/employees/${id}/confirm`,
      headers: auth(), payload: { confirmationDate: "2024-01-01", orderRef: "CONFIRM/2026/900" },
    });
    expect(r.statusCode).toBe(400);
  });

  it("rejects a confirmation date in the future", async () => {
    const id = await seedEmployee("Future Date Case", "2024-01-01");
    const r = await app.inject({
      method: "PATCH", url: `/v1/hrms/employees/${id}/confirm`,
      headers: auth(), payload: { confirmationDate: "2099-01-01", orderRef: "CONFIRM/2026/901" },
    });
    expect(r.statusCode).toBe(400);
  });

  it("confirms with a valid order reference and remark, and persists a service-book entry carrying the order reference", async () => {
    const id = await seedEmployee("Happy Path Confirm", "2024-01-01");
    const r = await app.inject({
      method: "PATCH", url: `/v1/hrms/employees/${id}/confirm`,
      headers: auth(),
      payload: { confirmationDate: "2026-01-15", orderRef: "CONFIRM/2026/902", remark: "Satisfactory service record" },
    });
    expect(r.statusCode).toBe(202);
    await drain();

    expect(await readEmployeeStatus(id)).toBe("confirmed");

    const entries = await readServiceBookEntries(id);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.entryType).toBe("confirmation");
    expect(entries[0]?.documentRef).toBe("CONFIRM/2026/902");
  });
});

describe("PATCH /v1/hrms/employees/:id/probation-extension — GAP-HR-CONFIRMATION-05", () => {
  it("rejects a new end date that does not move the probation end later", async () => {
    const id = await seedEmployee("Extension Reject Case", "2024-01-01");
    // Default probation end for a 2024-01-01 joiner is 2026-01-01.
    const r = await app.inject({
      method: "PATCH", url: `/v1/hrms/employees/${id}/probation-extension`,
      headers: auth(), payload: { newEndDate: "2025-01-01", reason: "Not actually later" },
    });
    expect(r.statusCode).toBe(400);
  });

  it("rejects extending an employee who is not on probation", async () => {
    const id = await seedEmployee("Already Confirmed Case", "2024-01-01");
    await app.inject({
      method: "PATCH", url: `/v1/hrms/employees/${id}/confirm`,
      headers: auth(), payload: { confirmationDate: "2026-01-15", orderRef: "CONFIRM/2026/903" },
    });
    await drain();

    const r = await app.inject({
      method: "PATCH", url: `/v1/hrms/employees/${id}/probation-extension`,
      headers: auth(), payload: { newEndDate: "2027-01-01", reason: "Should not apply" },
    });
    expect(r.statusCode).toBe(409);
  });

  it("records the extension, and a later GET /confirmations reflects the new probation end", async () => {
    const id = await seedEmployee("Extension Happy Path", "2024-01-01");
    const r = await app.inject({
      method: "PATCH", url: `/v1/hrms/employees/${id}/probation-extension`,
      headers: auth(), payload: { newEndDate: "2027-06-01", reason: "Performance improvement plan ongoing", orderRef: "EXT/2026/010" },
    });
    expect(r.statusCode).toBe(202);
    await drain();

    const listRes = await app.inject({ method: "GET", url: "/v1/hrms/confirmations", headers: auth() });
    const body = JSON.parse(listRes.body) as { data: Array<{ id: string; probationEnd: string; dueDate: string }> };
    const row = body.data.find((d) => d.id === id);
    expect(row?.probationEnd).toBe("2027-06-01");
    expect(row?.dueDate).toBe("2027-06-01");
  });
});
