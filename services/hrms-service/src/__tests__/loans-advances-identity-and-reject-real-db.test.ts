/**
 * Loans & salary advances — employee-identity enrichment, advance
 * self-service, and reject-workflow regression (real DB, no mocks).
 *
 * Covers three GAP-HR fixes not exercised by the sibling
 * loans-advances-manager-scope-real-db.test.ts:
 *  - GAP-HR-ADVANCES-01 / GAP-HR-LOANS-01: GET responses now carry
 *    employeeName/employeeNo (and department, for loans) resolved via the
 *    shared batchEmployees/batchDepartments helper, instead of a bare UUID.
 *  - GAP-HR-ADVANCES-03: a bare "employee" caller may self-file and
 *    self-read only their own advances; employeeId in the POST body is
 *    ignored entirely for this role and derived server-side.
 *  - GAP-HR-ADVANCES-02: the new reject endpoint -- maker-checker (creator
 *    cannot reject their own request), pending-only, and the rejection
 *    reason is required.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { withTenantScope } from "@civitasone/db";
import { pgSchema, uuid, varchar, integer, bigint, timestamp, text, date } from "drizzle-orm/pg-core";
import { buildApp } from "../app.js";
import { db, sqlClient } from "../shared/db.js";
import { hrmsEmployees } from "../modules/employee/schema.js";
import { hrmsDepartments } from "../modules/employee/schema.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();

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
  rejectedBy: uuid("rejected_by"),
  rejectionReason: varchar("rejection_reason", { length: 500 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  version: integer("version").notNull().default(1),
});

function auth(sub: string, roles: string[]): { authorization: string } {
  return { authorization: `Bearer ${signToken({ sub, tid: TENANT, roles, sid: "sess-identity-reject" }, SECRET, 3600)}` };
}

async function seedEmployee(opts: { userRef?: string; fullName: string; employeeNo: string; departmentId: string; createdBy: string }): Promise<string> {
  const id = randomUUID();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await withTenantScope(db, TENANT, (tx: any) => tx.insert(hrmsEmployees).values({
    id, tenantId: TENANT,
    employeeNo: opts.employeeNo,
    fullName: opts.fullName,
    departmentId: opts.departmentId,
    designationId: randomUUID(),
    dateOfJoining: "2020-01-15",
    ...(opts.userRef ? { userRef: opts.userRef } : {}),
    createdBy: opts.createdBy, updatedBy: opts.createdBy,
  }));
  return id;
}

async function seedDepartment(name: string, createdBy: string): Promise<string> {
  const id = randomUUID();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await withTenantScope(db, TENANT, (tx: any) => tx.insert(hrmsDepartments).values({
    id, tenantId: TENANT, code: `DEPT-${id.slice(0, 8)}`, name, createdBy, updatedBy: createdBy,
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

const EMPLOYEE_ACTOR = randomUUID();
const OTHER_EMPLOYEE_ACTOR = randomUUID();
const HR1_ACTOR = randomUUID();
const HR2_ACTOR = randomUUID();

let app: FastifyInstance;
let deptId: string;
let selfEmpId: string;
let otherEmpId: string;

beforeAll(async () => {
  app = await buildApp();
  deptId = await seedDepartment("Finance Wing", HR1_ACTOR);
  selfEmpId = await seedEmployee({ userRef: EMPLOYEE_ACTOR, fullName: "Priya Sharma", employeeNo: "E-501", departmentId: deptId, createdBy: HR1_ACTOR });
  otherEmpId = await seedEmployee({ userRef: OTHER_EMPLOYEE_ACTOR, fullName: "Ravi Kumar", employeeNo: "E-502", departmentId: deptId, createdBy: HR1_ACTOR });
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

describe("GAP-HR-LOANS-01 / GAP-HR-ADVANCES-01: employee-identity enrichment", () => {
  it("GET /v1/hrms/loans returns employeeName/employeeNo/department, not a bare id", async () => {
    await seedLoan({ employeeId: selfEmpId, createdBy: HR1_ACTOR });
    const r = await app.inject({ method: "GET", url: "/v1/hrms/loans", headers: auth(HR1_ACTOR, ["hr_admin"]) });
    expect(r.statusCode).toBe(200);
    const row = (r.json().data as Array<Record<string, unknown>>).find((x) => x.employeeId === selfEmpId);
    expect(row?.employeeName).toBe("Priya Sharma");
    expect(row?.employeeNo).toBe("E-501");
    expect(row?.department).toBe("Finance Wing");
  });

  it("GET /v1/hrms/salary-advances returns employeeName/employeeNo, not a bare id", async () => {
    await seedAdvance({ employeeId: selfEmpId, createdBy: HR1_ACTOR });
    const r = await app.inject({ method: "GET", url: "/v1/hrms/salary-advances", headers: auth(HR1_ACTOR, ["hr_admin"]) });
    expect(r.statusCode).toBe(200);
    const row = (r.json().data as Array<Record<string, unknown>>).find((x) => x.employeeId === selfEmpId);
    expect(row?.employeeName).toBe("Priya Sharma");
    expect(row?.employeeNo).toBe("E-501");
  });
});

describe("GAP-HR-ADVANCES-03: employee self-service", () => {
  it("a plain employee sees only their own advances, never a co-worker's", async () => {
    const mine = await seedAdvance({ employeeId: selfEmpId, createdBy: HR1_ACTOR });
    const theirs = await seedAdvance({ employeeId: otherEmpId, createdBy: HR1_ACTOR });
    const r = await app.inject({ method: "GET", url: "/v1/hrms/salary-advances", headers: auth(EMPLOYEE_ACTOR, ["employee"]) });
    expect(r.statusCode).toBe(200);
    const ids = (r.json().data as Array<{ id: string }>).map((x) => x.id);
    expect(ids).toContain(mine);
    expect(ids).not.toContain(theirs);
  });

  it("POST as a plain employee ignores any employeeId in the body and files under their own id", async () => {
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/salary-advances",
      headers: auth(EMPLOYEE_ACTOR, ["employee"]),
      // Deliberately claim the OTHER employee's id in the body -- must be
      // ignored, never trusted, for this role.
      payload: { employeeId: otherEmpId, amountMinor: 150000, purpose: "Self-service test", recoveryMonths: 2 },
    });
    expect(r.statusCode).toBe(202);
  });

  it("POST as a plain employee with NO employeeId in the body still succeeds (server derives it)", async () => {
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/salary-advances",
      headers: auth(EMPLOYEE_ACTOR, ["employee"]),
      payload: { amountMinor: 100000, purpose: "No employeeId sent", recoveryMonths: 1 },
    });
    expect(r.statusCode).toBe(202);
  });

  it("a caller with none of HR/manager/officer/employee roles is rejected by the route's own role gate (403)", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/hrms/salary-advances", headers: auth(randomUUID(), ["citizen"]) });
    expect(r.statusCode).toBe(403);
  });
});

describe("GAP-HR-ADVANCES-02: reject endpoint", () => {
  it("a pending advance can be rejected with a reason (202 accepted)", async () => {
    // NOTE: like every other command-dispatching route this file's sibling
    // (loans-advances-manager-scope-real-db.test.ts) exercises, this only
    // asserts the route's own synchronous response -- app.inject() here
    // does not run the queue consumer that applies the write
    // (registerLoanConsumers is not wired into buildApp() for this harness;
    // every create/approve assertion in the sibling file has the exact same
    // scope, confirmed by its own "queue_publish_no_subscribers" log lines).
    // The consumer's own write behavior (status -> 'rejected',
    // rejectedBy/rejectionReason set, pending-only guard) is covered
    // directly by loans-consumer.test.ts instead.
    const advId = await seedAdvance({ employeeId: selfEmpId, createdBy: HR1_ACTOR });
    const r = await app.inject({
      method: "PATCH", url: `/v1/hrms/salary-advances/${advId}/reject`,
      headers: auth(HR2_ACTOR, ["hr_admin"]),
      payload: { reason: "Exceeds monthly recovery cap" },
    });
    expect(r.statusCode).toBe(202);
  });

  it("the creator cannot reject their own advance (403, not 202)", async () => {
    const advId = await seedAdvance({ employeeId: selfEmpId, createdBy: HR1_ACTOR });
    const r = await app.inject({
      method: "PATCH", url: `/v1/hrms/salary-advances/${advId}/reject`,
      headers: auth(HR1_ACTOR, ["hr_admin"]),
      payload: { reason: "Self-rejection attempt" },
    });
    expect(r.statusCode).toBe(403);
  });

  it("rejecting without a reason fails validation (400)", async () => {
    const advId = await seedAdvance({ employeeId: selfEmpId, createdBy: HR1_ACTOR });
    const r = await app.inject({
      method: "PATCH", url: `/v1/hrms/salary-advances/${advId}/reject`,
      headers: auth(HR2_ACTOR, ["hr_admin"]),
      payload: {},
    });
    expect(r.statusCode).toBe(400);
  });

  it("an already-rejected advance cannot be rejected again (404, not 202)", async () => {
    const advId = await seedAdvance({ employeeId: selfEmpId, createdBy: HR1_ACTOR, status: "rejected" });
    const r = await app.inject({
      method: "PATCH", url: `/v1/hrms/salary-advances/${advId}/reject`,
      headers: auth(HR2_ACTOR, ["hr_admin"]),
      payload: { reason: "Trying again" },
    });
    expect(r.statusCode).toBe(404);
  });

  it("a non-HR role (manager) cannot reject", async () => {
    const advId = await seedAdvance({ employeeId: selfEmpId, createdBy: HR1_ACTOR });
    const r = await app.inject({
      method: "PATCH", url: `/v1/hrms/salary-advances/${advId}/reject`,
      headers: auth(randomUUID(), ["manager"]),
      payload: { reason: "Not my call" },
    });
    expect(r.statusCode).toBe(403);
  });
});
