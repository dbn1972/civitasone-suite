/**
 * Loans & salary advances — real-DB manager-scope + maker-checker regression.
 *
 * SEC findings (loans-routes.ts):
 *  1. GET /v1/hrms/loans and GET /v1/hrms/salary-advances gave every
 *     ALL_ROLES-holding caller (including bare "manager"/"officer") an
 *     unfiltered, tenant-wide dump -- zero per-report scoping. Fixed via
 *     resolveManagerScope + directReportIds, mirroring employee/routes.ts's
 *     own resolveManagerScope (hrmsEmployees.managerId).
 *  2. POST /v1/hrms/salary-advances let any manager/officer name an
 *     arbitrary tenant-wide employeeId in the body -- the UI's employee
 *     picker fetches every employee in the tenant, and the backend inserted
 *     body.employeeId raw with no ownership check. Fixed by requiring a
 *     non-HR caller's employeeId to be one of their own direct reports.
 *  3. PATCH /v1/hrms/salary-advances/:id/approve required only HR_ROLES
 *     membership, with no check that the approver differs from the
 *     record's creator -- the same hr_admin who filed an advance could
 *     approve their own submission. Fixed with an explicit
 *     createdBy !== ctx.actorId check.
 *
 * Real DB (no mocks): employeeId/managerId/createdBy all live in different
 * id spaces from the JWT actorId (see actor-link.ts), and this codebase has
 * documented precedent (apar-identity-resolution.test.ts) that a mocked test
 * which conflates those spaces in its fixtures cannot catch this bug class.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { withTenantScope } from "@civitasone/db";
import { pgSchema, uuid, varchar, integer, bigint, timestamp, text, date } from "drizzle-orm/pg-core";
import { buildApp } from "../app.js";
import { db, sqlClient } from "../shared/db.js";
import { hrmsEmployees } from "../modules/employee/schema.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();

// Local table mirrors -- neither loans-routes.ts nor loans-consumer.ts
// exports its Drizzle table definition (each already independently
// redefines the same shape locally), so this test follows the same
// established convention rather than introducing a new shared export.
const employeeSchema = pgSchema("employee");
const hrmsLoans = employeeSchema.table("hrms_loans", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  employeeId: uuid("employee_id").notNull(),
  loanType: varchar("loan_type", { length: 32 }).notNull(),
  sanctionedAmountMinor: bigint("sanctioned_amount_minor", { mode: "bigint" }).notNull().default(0n),
  disbursedAmountMinor: bigint("disbursed_amount_minor", { mode: "bigint" }).notNull().default(0n),
  outstandingMinor: bigint("outstanding_minor", { mode: "bigint" }).notNull().default(0n),
  interestRateBps: integer("interest_rate_bps").notNull().default(0),
  emiMinor: bigint("emi_minor", { mode: "bigint" }).notNull().default(0n),
  totalEmis: integer("total_emis").notNull().default(0),
  emisPaid: integer("emis_paid").notNull().default(0),
  sanctionDate: date("sanction_date").notNull(),
  purpose: text("purpose"),
  status: varchar("status", { length: 16 }).notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  version: integer("version").notNull().default(1),
});
const hrmsSalaryAdvances = employeeSchema.table("hrms_salary_advances", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  employeeId: uuid("employee_id").notNull(),
  amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull().default(0n),
  purpose: varchar("purpose", { length: 200 }).notNull(),
  recoveryMonths: integer("recovery_months").notNull().default(1),
  emiMinor: bigint("emi_minor", { mode: "bigint" }).notNull().default(0n),
  recoveredMinor: bigint("recovered_minor", { mode: "bigint" }).notNull().default(0n),
  requestDate: date("request_date").notNull(),
  approvedBy: uuid("approved_by"),
  status: varchar("status", { length: 16 }).notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  version: integer("version").notNull().default(1),
});

function auth(sub: string, roles: string[]): { authorization: string } {
  return { authorization: `Bearer ${signToken({ sub, tid: TENANT, roles, sid: "sess-loans-scope" }, SECRET, 3600)}` };
}

async function seedEmployee(opts: { userRef?: string; fullName: string; managerId?: string; createdBy: string }): Promise<string> {
  const id = randomUUID();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await withTenantScope(db, TENANT, (tx: any) => tx.insert(hrmsEmployees).values({
    id, tenantId: TENANT,
    employeeNo: `REG-${id.slice(0, 8)}`,
    fullName: opts.fullName,
    departmentId: randomUUID(),
    designationId: randomUUID(),
    dateOfJoining: "2020-01-15",
    ...(opts.userRef ? { userRef: opts.userRef } : {}),
    ...(opts.managerId ? { managerId: opts.managerId } : {}),
    createdBy: opts.createdBy, updatedBy: opts.createdBy,
  }));
  return id;
}

async function seedLoan(opts: { employeeId: string; createdBy: string }): Promise<string> {
  const id = randomUUID();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await withTenantScope(db, TENANT, (tx: any) => tx.insert(hrmsLoans).values({
    id, tenantId: TENANT, employeeId: opts.employeeId,
    loanType: "personal", sanctionedAmountMinor: 10000000n, disbursedAmountMinor: 10000000n,
    outstandingMinor: 10000000n, interestRateBps: 0, emiMinor: 100000n, totalEmis: 100, emisPaid: 0,
    sanctionDate: "2026-01-15", status: "active",
    createdBy: opts.createdBy,
  }));
  return id;
}

async function seedAdvance(opts: { employeeId: string; createdBy: string; status?: string }): Promise<string> {
  const id = randomUUID();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await withTenantScope(db, TENANT, (tx: any) => tx.insert(hrmsSalaryAdvances).values({
    id, tenantId: TENANT, employeeId: opts.employeeId,
    amountMinor: 500000n, purpose: "Medical", recoveryMonths: 6, emiMinor: 83334n, recoveredMinor: 0n,
    requestDate: "2026-01-15", status: opts.status ?? "pending",
    createdBy: opts.createdBy,
  }));
  return id;
}

const MANAGER_ACTOR = randomUUID();
const UNLINKED_MGR_ACTOR = randomUUID();
const HR1_ACTOR = randomUUID();
const HR2_ACTOR = randomUUID();

let app: FastifyInstance;
let report1EmpId: string;
let report2EmpId: string;
let outsiderEmpId: string;

beforeAll(async () => {
  app = await buildApp();
  const managerEmpId = await seedEmployee({ userRef: MANAGER_ACTOR, fullName: "Manager Loans-Scope", createdBy: HR1_ACTOR });
  report1EmpId = await seedEmployee({ fullName: "Report One", managerId: managerEmpId, createdBy: HR1_ACTOR });
  report2EmpId = await seedEmployee({ fullName: "Report Two", managerId: managerEmpId, createdBy: HR1_ACTOR });
  // Same tenant, but does NOT report to the manager above -- the "exists but not yours" case.
  outsiderEmpId = await seedEmployee({ fullName: "Outsider", createdBy: HR1_ACTOR });
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

describe("GET /v1/hrms/loans — manager scope", () => {
  it("manager-only token sees a direct report's loan, not the outsider's", async () => {
    const r1 = await seedLoan({ employeeId: report1EmpId, createdBy: HR1_ACTOR });
    const outsiderLoan = await seedLoan({ employeeId: outsiderEmpId, createdBy: HR1_ACTOR });
    const r = await app.inject({ method: "GET", url: "/v1/hrms/loans", headers: auth(MANAGER_ACTOR, ["manager"]) });
    expect(r.statusCode).toBe(200);
    const ids = (r.json().data as Array<{ id: string }>).map((x) => x.id);
    expect(ids).toContain(r1);
    expect(ids).not.toContain(outsiderLoan);
  });

  it("hr_admin sees the outsider's loan too (unrestricted)", async () => {
    const outsiderLoan = await seedLoan({ employeeId: outsiderEmpId, createdBy: HR1_ACTOR });
    const r = await app.inject({ method: "GET", url: "/v1/hrms/loans", headers: auth(HR1_ACTOR, ["hr_admin"]) });
    expect(r.statusCode).toBe(200);
    const ids = (r.json().data as Array<{ id: string }>).map((x) => x.id);
    expect(ids).toContain(outsiderLoan);
  });

  it("manager-only token with no resolvable employee link fails CLOSED to an empty list", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/hrms/loans", headers: auth(UNLINKED_MGR_ACTOR, ["manager"]) });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toEqual([]);
  });
});

describe("GET /v1/hrms/salary-advances — manager scope", () => {
  it("manager-only token sees a direct report's advance, not the outsider's", async () => {
    const a1 = await seedAdvance({ employeeId: report2EmpId, createdBy: HR1_ACTOR });
    const outsiderAdv = await seedAdvance({ employeeId: outsiderEmpId, createdBy: HR1_ACTOR });
    const r = await app.inject({ method: "GET", url: "/v1/hrms/salary-advances", headers: auth(MANAGER_ACTOR, ["manager"]) });
    expect(r.statusCode).toBe(200);
    const ids = (r.json().data as Array<{ id: string }>).map((x) => x.id);
    expect(ids).toContain(a1);
    expect(ids).not.toContain(outsiderAdv);
  });
});

describe("POST /v1/hrms/salary-advances — IDOR prevention on employeeId", () => {
  it("manager can request an advance for their own direct report (202)", async () => {
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/salary-advances",
      headers: auth(MANAGER_ACTOR, ["manager"]),
      payload: { employeeId: report1EmpId, amountMinor: 200000, purpose: "Festival advance", recoveryMonths: 3 },
    });
    expect(r.statusCode).toBe(202);
  });

  it("manager CANNOT request an advance naming the outsider's employeeId (403, not 202)", async () => {
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/salary-advances",
      headers: auth(MANAGER_ACTOR, ["manager"]),
      payload: { employeeId: outsiderEmpId, amountMinor: 200000, purpose: "Festival advance", recoveryMonths: 3 },
    });
    expect(r.statusCode).toBe(403);
  });

  it("a manager-role caller with no resolvable employee link is forbidden even for a real report id (fails closed)", async () => {
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/salary-advances",
      headers: auth(UNLINKED_MGR_ACTOR, ["manager"]),
      payload: { employeeId: report1EmpId, amountMinor: 200000, purpose: "Festival advance", recoveryMonths: 3 },
    });
    expect(r.statusCode).toBe(403);
  });

  it("hr_admin can request an advance naming the outsider's employeeId (unrestricted)", async () => {
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/salary-advances",
      headers: auth(HR1_ACTOR, ["hr_admin"]),
      payload: { employeeId: outsiderEmpId, amountMinor: 200000, purpose: "HR-assisted request", recoveryMonths: 3 },
    });
    expect(r.statusCode).toBe(202);
  });
});

describe("PATCH /v1/hrms/salary-advances/:id/approve — maker-checker", () => {
  it("the hr_admin who created the advance cannot approve it themselves (403, not 202)", async () => {
    const advId = await seedAdvance({ employeeId: report1EmpId, createdBy: HR1_ACTOR });
    const r = await app.inject({
      method: "PATCH", url: `/v1/hrms/salary-advances/${advId}/approve`,
      headers: auth(HR1_ACTOR, ["hr_admin"]),
    });
    expect(r.statusCode).toBe(403);
  });

  it("a DIFFERENT hr_admin can approve it (202)", async () => {
    const advId = await seedAdvance({ employeeId: report1EmpId, createdBy: HR1_ACTOR });
    const r = await app.inject({
      method: "PATCH", url: `/v1/hrms/salary-advances/${advId}/approve`,
      headers: auth(HR2_ACTOR, ["hr_admin"]),
    });
    expect(r.statusCode).toBe(202);
  });

  it("returns 404 (not 403) for an unknown advance id", async () => {
    const r = await app.inject({
      method: "PATCH", url: `/v1/hrms/salary-advances/${randomUUID()}/approve`,
      headers: auth(HR1_ACTOR, ["hr_admin"]),
    });
    expect(r.statusCode).toBe(404);
  });
});
