/**
 * lifecycle/routes.ts batch name-resolution — regression test (GAP-HR-SF-17).
 *
 * GET /v1/hrms/lifecycle/promotions and GET /v1/hrms/lifecycle/transfers
 * used to return raw employeeId/fromDeptId/toDeptId/fromDesigId/toDesigId
 * with no resolved display name, forcing the web layer to either show a
 * raw UUID or make N+1 follow-up calls. Verifies:
 *   1. the enriched *Name fields are present and correctly resolved
 *      (happy path), and the raw id fields are preserved unchanged
 *      (still needed by the frontend for actions).
 *   2. a resolved name NEVER leaks across tenants: a row whose FK ids
 *      happen to reference another tenant's employee/department/
 *      designation resolves to the "—" fallback, not that tenant's real
 *      data. Real writes can't produce this (a tenant's own command path
 *      only ever references its own lookups), so the row is inserted
 *      directly — this isolates the READ path's own tenant-scoped
 *      resolution (batchEmployees/batchDepartments/batchDesignations ->
 *      employee/repo.ts) as the thing under test.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { withTenantScope } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { hrmsEmployees, hrmsDepartments, hrmsDesignations } from "../src/modules/employee/schema.js";
import { hrmsTransfers, hrmsPromotions } from "../src/modules/lifecycle/schema.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT_A = randomUUID();
const TENANT_B = randomUUID();
const HR_ACTOR = randomUUID();

function auth(sub: string, roles: string[]): { authorization: string } {
  const jwt = signToken({ sub, tid: TENANT_A, roles, sid: "sess-sf17-batch-resolve" }, SECRET, 3600);
  return { authorization: `Bearer ${jwt}` };
}

async function seedDepartment(tenantId: string, name: string): Promise<string> {
  const id = randomUUID();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await withTenantScope(db, tenantId, (tx: any) => tx.insert(hrmsDepartments).values({
    id, tenantId, code: `DEPT-${id.slice(0, 8)}`, name, createdBy: HR_ACTOR, updatedBy: HR_ACTOR,
  }));
  return id;
}

async function seedDesignation(tenantId: string, name: string): Promise<string> {
  const id = randomUUID();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await withTenantScope(db, tenantId, (tx: any) => tx.insert(hrmsDesignations).values({
    id, tenantId, code: `DESIG-${id.slice(0, 8)}`, name, createdBy: HR_ACTOR, updatedBy: HR_ACTOR,
  }));
  return id;
}

async function seedEmployee(tenantId: string, fullName: string, departmentId: string, designationId: string): Promise<string> {
  const id = randomUUID();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await withTenantScope(db, tenantId, (tx: any) => tx.insert(hrmsEmployees).values({
    id, tenantId,
    employeeNo: `REG-${id.slice(0, 8)}`,
    fullName, departmentId, designationId,
    dateOfJoining: "2020-01-15",
    userRef: randomUUID(),
    createdBy: HR_ACTOR, updatedBy: HR_ACTOR,
  }));
  return id;
}

let app: FastifyInstance;

// Tenant A fixtures — the tenant every API call below is made as.
let deptA: string;
let deptToA: string;
let desigFromA: string;
let desigToA: string;
let empA: string;

// Tenant B fixtures — used ONLY to prove a cross-tenant id never resolves
// to tenant B's real name inside tenant A's response.
let deptB: string;
let desigB: string;
let empB: string;

let transferId: string;
let promotionId: string;
let crossTenantTransferId: string;
let crossTenantPromotionId: string;

beforeAll(async () => {
  app = await buildApp();

  deptA = await seedDepartment(TENANT_A, "Finance Wing A");
  deptToA = await seedDepartment(TENANT_A, "Admin Wing A");
  desigFromA = await seedDesignation(TENANT_A, "Section Officer");
  desigToA = await seedDesignation(TENANT_A, "Under Secretary");
  empA = await seedEmployee(TENANT_A, "Priya Sharma", deptA, desigFromA);

  deptB = await seedDepartment(TENANT_B, "Tenant-B Secret Wing");
  desigB = await seedDesignation(TENANT_B, "Tenant-B Secret Grade");
  empB = await seedEmployee(TENANT_B, "Tenant-B Secret Employee", deptB, desigB);

  transferId = randomUUID();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await withTenantScope(db, TENANT_A, (tx: any) => tx.insert(hrmsTransfers).values({
    id: transferId, tenantId: TENANT_A, employeeId: empA,
    fromDeptId: deptA, toDeptId: deptToA,
    effectiveDate: "2026-01-01", createdBy: HR_ACTOR, updatedBy: HR_ACTOR,
  }));

  promotionId = randomUUID();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await withTenantScope(db, TENANT_A, (tx: any) => tx.insert(hrmsPromotions).values({
    id: promotionId, tenantId: TENANT_A, employeeId: empA,
    fromDesigId: desigFromA, toDesigId: desigToA,
    effectiveDate: "2026-02-01", createdBy: HR_ACTOR, updatedBy: HR_ACTOR,
  }));

  // Defensive fixtures: tenant A rows whose FK ids equal tenant B's ids.
  // Not producible through the real write path, which only ever writes ids
  // from within the same tenant's own lookups — inserted directly so the
  // isolation assertions below test the READ path's own scoping rather
  // than relying on a cross-tenant write path existing.
  crossTenantTransferId = randomUUID();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await withTenantScope(db, TENANT_A, (tx: any) => tx.insert(hrmsTransfers).values({
    id: crossTenantTransferId, tenantId: TENANT_A, employeeId: empB,
    fromDeptId: deptB, toDeptId: deptB,
    effectiveDate: "2026-03-01", createdBy: HR_ACTOR, updatedBy: HR_ACTOR,
  }));

  crossTenantPromotionId = randomUUID();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await withTenantScope(db, TENANT_A, (tx: any) => tx.insert(hrmsPromotions).values({
    id: crossTenantPromotionId, tenantId: TENANT_A, employeeId: empB,
    fromDesigId: desigB, toDesigId: desigB,
    effectiveDate: "2026-03-01", createdBy: HR_ACTOR, updatedBy: HR_ACTOR,
  }));
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

describe("GET /v1/hrms/lifecycle/transfers — batch name resolution (GAP-HR-SF-17)", () => {
  it("resolves employeeName and from/toDepartmentName alongside the raw ids", async () => {
    const r = await app.inject({
      method: "GET", url: "/v1/hrms/lifecycle/transfers",
      headers: auth(HR_ACTOR, ["hr_admin"]),
    });
    expect(r.statusCode).toBe(200);
    const row = (r.json().data as Array<Record<string, unknown>>).find((d) => d.id === transferId);
    expect(row).toBeTruthy();
    // Raw ids preserved — still needed by the frontend for actions.
    expect(row!.employeeId).toBe(empA);
    expect(row!.fromDeptId).toBe(deptA);
    expect(row!.toDeptId).toBe(deptToA);
    // Resolved display names added.
    expect(row!.employeeName).toBe("Priya Sharma");
    expect(row!.fromDepartmentName).toBe("Finance Wing A");
    expect(row!.toDepartmentName).toBe("Admin Wing A");
  });

  it("never leaks another tenant's real name for a cross-tenant id — falls back to the placeholder instead", async () => {
    const r = await app.inject({
      method: "GET", url: "/v1/hrms/lifecycle/transfers",
      headers: auth(HR_ACTOR, ["hr_admin"]),
    });
    expect(r.statusCode).toBe(200);
    const row = (r.json().data as Array<Record<string, unknown>>).find((d) => d.id === crossTenantTransferId);
    expect(row).toBeTruthy();
    expect(row!.employeeName).not.toBe("Tenant-B Secret Employee");
    expect(row!.fromDepartmentName).not.toBe("Tenant-B Secret Wing");
    expect(row!.employeeName).toBe("—");
    expect(row!.fromDepartmentName).toBe("—");
  });
});

describe("GET /v1/hrms/lifecycle/promotions — batch name resolution (GAP-HR-SF-17)", () => {
  it("resolves employeeName and from/toDesignationName alongside the raw ids", async () => {
    const r = await app.inject({
      method: "GET", url: "/v1/hrms/lifecycle/promotions",
      headers: auth(HR_ACTOR, ["hr_admin"]),
    });
    expect(r.statusCode).toBe(200);
    const row = (r.json().data as Array<Record<string, unknown>>).find((d) => d.id === promotionId);
    expect(row).toBeTruthy();
    expect(row!.employeeId).toBe(empA);
    expect(row!.employeeName).toBe("Priya Sharma");
    expect(row!.fromDesignationName).toBe("Section Officer");
    expect(row!.toDesignationName).toBe("Under Secretary");
  });

  it("never leaks another tenant's real name for a cross-tenant id — falls back to the placeholder instead", async () => {
    const r = await app.inject({
      method: "GET", url: "/v1/hrms/lifecycle/promotions",
      headers: auth(HR_ACTOR, ["hr_admin"]),
    });
    expect(r.statusCode).toBe(200);
    const row = (r.json().data as Array<Record<string, unknown>>).find((d) => d.id === crossTenantPromotionId);
    expect(row).toBeTruthy();
    expect(row!.employeeName).not.toBe("Tenant-B Secret Employee");
    expect(row!.fromDesignationName).not.toBe("Tenant-B Secret Grade");
    expect(row!.employeeName).toBe("—");
    expect(row!.fromDesignationName).toBe("—");
  });
});
