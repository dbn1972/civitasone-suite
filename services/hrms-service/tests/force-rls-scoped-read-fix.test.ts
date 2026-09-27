/**
 * FORCE-RLS scoped-read fix — hrms-service (companion to payroll-service's
 * PR #1625, which fixed the identical anti-pattern there and flagged
 * hrms-service/finance-service as out of scope for that PR).
 *
 * THE BUG: a query against a FORCE ROW LEVEL SECURITY table ran on the bare,
 * pooled `db` singleton (or a repo helper typed `tx: typeof db`/`Reader`/
 * `Writer` invoked with that bare singleton) instead of inside
 * `db.transaction()`/`scopedRead()`/`scopedPlatformRead()` (or, for
 * background jobs with no ambient tenant context, `runWithTenant(tenantId,
 * fn)` around one of those). Under the NOBYPASSRLS `hrms_svc` role, a bare
 * read/write never has `app.tenant_id` set, so the fail-closed FORCE RLS
 * policy silently returns/affects ZERO rows — the calling code then treats
 * "empty" as a legitimate business outcome, so the failure is invisible.
 *
 * FIVE FIXES covered here:
 *   1. attendance/queries.ts  getAttendanceSummaryForMonth()   (attendance.hrms_attendance)
 *   2. attendance/routes.ts   GET /v1/hrms/overtime-requests   (attendance.hrms_overtime_requests)
 *   3. scheduler/tick.ts      runSchedulerOnce() cross-tenant   (employee.hrms_employees read,
 *      discovery + per-tenant read/write                        scheduler.hrms_due_list write)
 *   4. consultant-invoice/routes.ts approve  (consultant.hrms_consultant_invoices — 194J YTD)
 *   5. contractor-bill/routes.ts approve     (agency.hrms_contractor_bills — 194C YTD)
 *
 * Fix #3 deliberately does NOT use a SECURITY DEFINER function (migration
 * 0144's original, since-abandoned approach for this exact problem class —
 * see migration 0146 and lifecycle/effective-scheduler.ts's header comment).
 * No role in this fleet holds BYPASSRLS, so SECURITY DEFINER elevates a call
 * to nothing useful and would silently reproduce the same bug in a more
 * elaborate disguise. tick.ts instead uses `scopedPlatformRead` (migration
 * 0133's `app.platform_bypass` SELECT policy on employee.hrms_employees) for
 * tenant discovery, then `runWithTenant` to re-enter each tenant's own
 * strict RLS context for the real read/write — the SAME corrected pattern
 * this codebase already uses for the sibling lifecycle scheduler.
 *
 * HTTP and worker are normally separate PM2 processes, each with its OWN
 * in-memory queue under QUEUE_DRIVER=memory — buildApp() and the F3
 * consumers would never see each other's messages in one test process
 * unless both are wired onto the SAME queue singleton, wrapped for tenant
 * context exactly as worker.ts does (see beforeAll below). Needed for bugs
 * 4/5, whose approve routes need real, previously-APPROVED invoices/bills
 * (status flips only once the F3 consumer actually runs) to build up a
 * genuine YTD aggregate.
 *
 * Run against the real shared dev Postgres (hrms_svc / civitas_hrms), same
 * convention as tick.test.ts / rls-isolation.test.ts / nps-cpf-rls.test.ts —
 * not mocked. Every fixture below uses a fresh random tenant id, so tests
 * never collide with each other or with whatever else lives in the shared DB.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";

import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerF3LeftoverAll } from "../src/modules/f3-leftover-register.js";
import { runSchedulerOnce } from "../src/modules/scheduler/tick.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const SUBMITTER = "00000000-0000-0000-0000-0000000000a0";
const VERIFIER = "00000000-0000-0000-0000-0000000000b1";
const APPROVER = "00000000-0000-0000-0000-0000000000b2";

function tokenFor(tenantId: string, actorId = SUBMITTER, roles: string[] = ["super_admin", "hr_admin", "finance_officer"]): string {
  return signToken({ sub: actorId, tid: tenantId, roles, sid: "sess-force-rls-hrms" }, SECRET, 3600);
}

/** Polls `predicate` until it returns true or `timeoutMs` elapses. Used to wait for
 *  an async F3 consumer write to land before reading/depending on its result. */
async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 5000, stepMs = 75): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await predicate()) return;
    if (Date.now() >= deadline) throw new Error(`waitFor: condition not met within ${timeoutMs}ms`);
    await new Promise((r) => setTimeout(r, stepMs));
  }
}

async function fetchInvoiceStatus(tenant: string, invId: string): Promise<string | undefined> {
  const rows = (await runWithTenant(tenant, () => db.transaction((tx) =>
    tx.execute(sql`SELECT status FROM consultant.hrms_consultant_invoices WHERE id = ${invId}::uuid`),
  ))) as unknown as Array<{ status: string }>;
  return rows[0]?.status;
}

async function fetchBillStatus(tenant: string, billId: string): Promise<string | undefined> {
  const rows = (await runWithTenant(tenant, () => db.transaction((tx) =>
    tx.execute(sql`SELECT status FROM agency.hrms_contractor_bills WHERE id = ${billId}::uuid`),
  ))) as unknown as Array<{ status: string }>;
  return rows[0]?.status;
}

let app: FastifyInstance;

beforeAll(async () => {
  // Mirror worker.ts's own queue.subscribe wrapping EXACTLY: without this,
  // the F3 consumers' own db.transaction() calls would have no AsyncLocalStorage
  // tenant context to read the GUC from, even though their code is already
  // correctly tx-scoped -- this is a harness-fidelity requirement, not part
  // of the fix itself.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q = queue as any;
  const rawSubscribe = q.subscribe.bind(q);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  q.subscribe = (topic: string, handler: (msg: any) => Promise<void>) =>
    rawSubscribe(topic, (msg: any) => runWithTenant(msg.tenantId, () => handler(msg)));
  registerF3LeftoverAll(queue);

  app = await buildApp();
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

describe("hrms-service FORCE-RLS fix — role sanity", () => {
  it("connects as a genuinely NOBYPASSRLS, NOSUPERUSER role (not a Docker POSTGRES_USER-created superuser)", async () => {
    const rows = await sqlClient`
      SELECT current_user AS u,
             (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS bypassrls,
             (SELECT rolsuper     FROM pg_roles WHERE rolname = current_user) AS super
    `;
    expect(rows[0]?.u).toBe("hrms_svc");
    expect(rows[0]?.bypassrls).toBe(false);
    expect(rows[0]?.super).toBe(false);
  });
});

describe("Bug 1 — attendance summary (attendance.hrms_attendance, FORCE RLS)", () => {
  it("GET /v1/hrms/attendance/summary sees real seeded attendance instead of an empty month", async () => {
    const tenant = randomUUID();
    const empId = randomUUID();
    const month = "2026-04";

    await runWithTenant(tenant, () => db.transaction(async (tx) => {
      await tx.execute(sql`
        INSERT INTO employee.hrms_employees
          (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, basic_minor, employee_type, status, created_by, updated_by)
        VALUES (${empId}::uuid, ${tenant}::uuid, 'EMP-SUM-FIXVERIFY', 'Summary Fixture Employee', ${randomUUID()}::uuid, ${randomUUID()}::uuid, '2020-01-01', 5000000, 'permanent', 'confirmed', ${SUBMITTER}::uuid, ${SUBMITTER}::uuid)
      `);
      // Own fixture values: 3 present days (one late), 1 absent, 1 half_day --
      // 5 distinct dates, presentCount(present+half_day)=4, absentCount=1, lateCount=1.
      const days: Array<{ d: string; status: string; late: number }> = [
        { d: `${month}-02`, status: "present", late: 0 },
        { d: `${month}-03`, status: "present", late: 0 },
        { d: `${month}-06`, status: "present", late: 15 },
        { d: `${month}-07`, status: "absent", late: 0 },
        { d: `${month}-08`, status: "half_day", late: 0 },
      ];
      for (const day of days) {
        await tx.execute(sql`
          INSERT INTO attendance.hrms_attendance
            (tenant_id, employee_id, attendance_date, status, late_mins, created_by, updated_by)
          VALUES (${tenant}::uuid, ${empId}::uuid, ${day.d}::date, ${day.status}, ${day.late}, ${SUBMITTER}::uuid, ${SUBMITTER}::uuid)
        `);
      }
    }));

    const res = await app.inject({
      method: "GET",
      url: `/v1/hrms/attendance/summary?month=${month}`,
      headers: { authorization: `Bearer ${tokenFor(tenant)}` },
    });
    expect(res.statusCode).toBe(200);
    const data = res.json().data as Array<{ date: string; presentCount: number; absentCount: number; lateCount: number }>;
    console.log(`[bug1 attendance summary] tenant=${tenant} rows=${JSON.stringify(data)}`);
    // Pre-fix (bare db, RLS-blind): data is []. Post-fix: 5 distinct dates.
    expect(data).toHaveLength(5);
    const totalPresent = data.reduce((n, r) => n + r.presentCount, 0);
    const totalAbsent = data.reduce((n, r) => n + r.absentCount, 0);
    const totalLate = data.reduce((n, r) => n + r.lateCount, 0);
    expect(totalPresent).toBe(4); // 'present' + 'half_day' both count
    expect(totalAbsent).toBe(1);
    expect(totalLate).toBe(1);
  });
});

describe("Bug 2 — overtime-requests list (attendance.hrms_overtime_requests, FORCE RLS)", () => {
  it("GET /v1/hrms/overtime-requests sees a real seeded pending request instead of an empty list", async () => {
    const tenant = randomUUID();
    const empId = randomUUID();
    const otId = randomUUID();

    await runWithTenant(tenant, () => db.transaction(async (tx) => {
      await tx.execute(sql`
        INSERT INTO employee.hrms_employees
          (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, basic_minor, employee_type, status, created_by, updated_by)
        VALUES (${empId}::uuid, ${tenant}::uuid, 'EMP-OT-FIXVERIFY', 'OT Fixture Employee', ${randomUUID()}::uuid, ${randomUUID()}::uuid, '2021-06-15', 4000000, 'permanent', 'confirmed', ${SUBMITTER}::uuid, ${SUBMITTER}::uuid)
      `);
      await tx.execute(sql`
        INSERT INTO attendance.hrms_overtime_requests
          (id, tenant_id, employee_id, request_date, hours_requested, reason, created_by, updated_by)
        VALUES (${otId}::uuid, ${tenant}::uuid, ${empId}::uuid, '2026-04-10', 3.5, 'fixture overtime -- own value', ${SUBMITTER}::uuid, ${SUBMITTER}::uuid)
      `);
    }));

    const res = await app.inject({
      method: "GET",
      url: "/v1/hrms/overtime-requests",
      headers: { authorization: `Bearer ${tokenFor(tenant)}` },
    });
    expect(res.statusCode).toBe(200);
    const rows = res.json().data as Array<{ id: string; status: string }>;
    console.log(`[bug2 overtime-requests] tenant=${tenant} seededId=${otId} rowIds=${JSON.stringify(rows.map((r) => r.id))}`);
    // Pre-fix (bare db, RLS-blind): rows is []. Post-fix: the seeded request appears.
    expect(rows.some((r) => r.id === otId)).toBe(true);
  });
});

describe("Bug 3 — scheduler tick cross-tenant discovery (employee.hrms_employees read, scheduler.hrms_due_list write, both FORCE RLS)", () => {
  it("discovers due rows for 2 DIFFERENT tenants in the same tick, and actually writes both tenants' due-list rows", async () => {
    const tenantSup = randomUUID();
    // Generous timeout: this shared dev DB has accumulated hundreds of
    // tenants/thousands of employees across this whole campaign's test
    // history (see tick.test.ts's own live observed durationMs of 1.5-3s
    // against the current tenant count), so a real, correctly-scoped
    // cross-tenant tick over the WHOLE table is not fast, by design of
    // testing against the real shared instance rather than mocking.
    const tenantProb = randomUUID();
    const empSup = randomUUID();
    const empProb = randomUUID();
    const asOf = "2026-04-01";

    // tenantSup's employee: DOB 1966-04-15 -> superannuates (age 60, not born
    // on the 1st) on the last day of April 2026 -- 29 days after asOf, well
    // inside the default 180-day window.
    await runWithTenant(tenantSup, () => db.transaction((tx) => tx.execute(sql`
      INSERT INTO employee.hrms_employees
        (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, date_of_birth, basic_minor, employee_type, status, created_by, updated_by)
      VALUES (${empSup}::uuid, ${tenantSup}::uuid, 'EMP-SUP-FIXVERIFY', 'Superannuation Fixture Employee', ${randomUUID()}::uuid, ${randomUUID()}::uuid, '1990-01-01', '1966-04-15', 6000000, 'permanent', 'confirmed', ${SUBMITTER}::uuid, ${SUBMITTER}::uuid)
    `)));

    // tenantProb's employee: still on probation, DOJ 2024-05-15 -> probation
    // end (default 24 months) = 2026-05-15 -- 44 days after asOf, inside the
    // default 60-day window.
    await runWithTenant(tenantProb, () => db.transaction((tx) => tx.execute(sql`
      INSERT INTO employee.hrms_employees
        (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, basic_minor, employee_type, status, created_by, updated_by)
      VALUES (${empProb}::uuid, ${tenantProb}::uuid, 'EMP-PROB-FIXVERIFY', 'Probation Fixture Employee', ${randomUUID()}::uuid, ${randomUUID()}::uuid, '2024-05-15', 3000000, 'permanent', 'probation', ${SUBMITTER}::uuid, ${SUBMITTER}::uuid)
    `)));

    const result = await runSchedulerOnce(db, { asOf });
    console.log(
      `[bug3 scheduler] tenantsSeen=${result.tenantsSeen} tenantSup=${tenantSup} tenantProb=${tenantProb} ` +
      `outcomes=${JSON.stringify(result.outcomes.filter((o) => o.tenantId === tenantSup || o.tenantId === tenantProb))}`,
    );

    // Pre-fix (bare cross-tenant db.execute, RLS-blind): tenants=[] entirely
    // -- tenantsSeen=0 and neither of these outcomes exists at all.
    const supOutcome = result.outcomes.find((o) => o.tenantId === tenantSup);
    const probOutcome = result.outcomes.find((o) => o.tenantId === tenantProb);
    expect(supOutcome).toBeDefined();
    expect(supOutcome?.ok).toBe(true);
    expect(supOutcome?.superannuationRows).toBe(1);
    expect(probOutcome).toBeDefined();
    expect(probOutcome?.ok).toBe(true);
    expect(probOutcome?.probationRows).toBe(1);

    // Confirm the actual rows landed in scheduler.hrms_due_list (not just the
    // in-memory outcome), each correctly scoped to its OWN tenant.
    const supDueRows = (await runWithTenant(tenantSup, () => db.transaction((tx) => tx.execute(sql`
      SELECT employee_id FROM scheduler.hrms_due_list
      WHERE tenant_id = ${tenantSup}::uuid AND list_kind = 'superannuation' AND run_date = ${asOf}::date
    `)))) as unknown as Array<{ employee_id: string }>;
    expect(supDueRows).toHaveLength(1);
    expect(supDueRows[0]?.employee_id).toBe(empSup);

    const probDueRows = (await runWithTenant(tenantProb, () => db.transaction((tx) => tx.execute(sql`
      SELECT employee_id FROM scheduler.hrms_due_list
      WHERE tenant_id = ${tenantProb}::uuid AND list_kind = 'probation' AND run_date = ${asOf}::date
    `)))) as unknown as Array<{ employee_id: string }>;
    expect(probDueRows).toHaveLength(1);
    expect(probDueRows[0]?.employee_id).toBe(empProb);
  }, 30_000);
});

describe("Bug 4 — consultant-invoice approve: 194J YTD threshold (consultant.hrms_consultant_invoices, FORCE RLS)", () => {
  it("YTD from a real prior APPROVED invoice is correctly aggregated, so 194J TDS trips on the second approval", async () => {
    const tenant = randomUUID();
    const consultantId = randomUUID();

    await runWithTenant(tenant, () => db.transaction((tx) => tx.execute(sql`
      INSERT INTO employee.hrms_employees
        (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, basic_minor, employee_type, status, created_by, updated_by)
      VALUES (${consultantId}::uuid, ${tenant}::uuid, 'CONS-FIXVERIFY', 'Fixture Consultant', ${randomUUID()}::uuid, ${randomUUID()}::uuid, '2025-01-01', 0, 'consultant', 'confirmed', ${SUBMITTER}::uuid, ${SUBMITTER}::uuid)
    `)));

    async function submitVerifyApprove(invoiceNo: string, invoiceDate: string, grossMinor: number) {
      const submitRes = await app.inject({
        method: "POST",
        url: `/v1/hrms/consultants/${consultantId}/invoices`,
        headers: { authorization: `Bearer ${tokenFor(tenant, SUBMITTER)}`, "content-type": "application/json" },
        payload: { invoiceNo, invoiceDate, grossMinor, gstApplicable: false, tdsRateBps: 1000 },
      });
      expect(submitRes.statusCode).toBe(201);
      const invId = submitRes.json().id as string;
      await waitFor(async () => (await fetchInvoiceStatus(tenant, invId)) === "submitted");

      const verifyRes = await app.inject({
        method: "POST",
        url: `/v1/hrms/consultant-invoices/${invId}/verify`,
        headers: { authorization: `Bearer ${tokenFor(tenant, VERIFIER)}` },
      });
      expect(verifyRes.statusCode).toBe(200);
      await waitFor(async () => (await fetchInvoiceStatus(tenant, invId)) === "verified");

      const approveRes = await app.inject({
        method: "POST",
        url: `/v1/hrms/consultant-invoices/${invId}/approve`,
        headers: { authorization: `Bearer ${tokenFor(tenant, APPROVER)}`, "content-type": "application/json" },
        payload: {},
      });
      expect(approveRes.statusCode).toBe(200);
      const approveBody = approveRes.json() as { tdsApplied: boolean; tdsMinor: string; netPayableMinor: string };
      await waitFor(async () => (await fetchInvoiceStatus(tenant, invId)) === "approved");
      return { invId, approveBody };
    }

    // Invoice A: Rs 20,000 -- own fixture value, well under the Rs 30,000
    // 194J threshold alone. Approved first, purely to build up a real YTD.
    const a = await submitVerifyApprove("CONS-INV-FIXVERIFY-A", "2026-05-10", 2_000_000);
    expect(a.approveBody.tdsApplied).toBe(false);

    // Invoice B: also Rs 20,000, same FY. Correct YTD (Rs 20,000 from A) +
    // this invoice's Rs 20,000 = Rs 40,000 >= Rs 30,000 threshold -> TDS
    // must trip. Pre-fix (bare db, RLS-blind ytdApprovedGrossTx): ytd reads
    // as 0, so 0 + 20,000 < 30,000 and TDS never trips, for any tenant, ever.
    const b = await submitVerifyApprove("CONS-INV-FIXVERIFY-B", "2026-06-15", 2_000_000);
    console.log(`[bug4 consultant-invoice] tenant=${tenant} invB=${JSON.stringify(b.approveBody)}`);
    expect(b.approveBody.tdsApplied).toBe(true);
    expect(b.approveBody.tdsMinor).toBe("200000"); // applyBps(2_000_000, 1000 bps)
  });
});

describe("Bug 5 — contractor-bill approve: 194C YTD annual-aggregate threshold (agency.hrms_contractor_bills, FORCE RLS)", () => {
  it("YTD from a real prior APPROVED bill is correctly aggregated, so 194C TDS trips via the annual-aggregate rule", async () => {
    const tenant = randomUUID();
    const contractorId = randomUUID();

    await runWithTenant(tenant, () => db.transaction((tx) => tx.execute(sql`
      INSERT INTO agency.hrms_contractors
        (id, tenant_id, name, contractor_kind, status, created_by, updated_by)
      VALUES (${contractorId}::uuid, ${tenant}::uuid, 'Fixture Agency', 'other', 'active', ${SUBMITTER}::uuid, ${SUBMITTER}::uuid)
    `)));

    async function submitVerifyApprove(billNo: string, billDate: string, grossMinor: number) {
      const submitRes = await app.inject({
        method: "POST",
        url: `/v1/hrms/contractors/${contractorId}/bills`,
        headers: { authorization: `Bearer ${tokenFor(tenant, SUBMITTER)}`, "content-type": "application/json" },
        payload: { billNo, billDate, workersCount: 1, grossMinor, gstApplicable: false, wagesDisbursedVerified: true },
      });
      expect(submitRes.statusCode).toBe(201);
      const billId = submitRes.json().id as string;
      await waitFor(async () => (await fetchBillStatus(tenant, billId)) === "submitted");

      const verifyRes = await app.inject({
        method: "POST",
        url: `/v1/hrms/contractor-bills/${billId}/verify`,
        headers: { authorization: `Bearer ${tokenFor(tenant, VERIFIER)}` },
      });
      expect(verifyRes.statusCode).toBe(200);
      await waitFor(async () => (await fetchBillStatus(tenant, billId)) === "verified");

      const approveRes = await app.inject({
        method: "POST",
        url: `/v1/hrms/contractor-bills/${billId}/approve`,
        headers: { authorization: `Bearer ${tokenFor(tenant, APPROVER)}`, "content-type": "application/json" },
        payload: {},
      });
      expect(approveRes.statusCode).toBe(200);
      const approveBody = approveRes.json() as { tdsApplied: boolean; tdsMinor: string };
      await waitFor(async () => (await fetchBillStatus(tenant, billId)) === "approved");
      return { billId, approveBody };
    }

    // Bill A: Rs 80,000 -- own fixture value. Above the single-bill Rs 30,000
    // threshold on its own (not what this test is about); approved purely to
    // build up a real YTD of Rs 80,000.
    const a = await submitVerifyApprove("AGENCY-BILL-FIXVERIFY-A", "2026-05-10", 8_000_000);
    expect(a.approveBody.tdsApplied).toBe(true);

    // Bill B: Rs 25,000 -- deliberately BELOW the single-bill Rs 30,000
    // threshold, so B can ONLY trip 194C via the annual-aggregate rule.
    // Correct YTD (Rs 80,000 from A) + this bill's Rs 25,000 = Rs 1,05,000 >=
    // Rs 1,00,000 annual threshold -> TDS must trip. Pre-fix (bare db,
    // RLS-blind ytdApprovedGrossTx): ytd reads as 0, so neither the
    // single-bill rule (25,000 < 30,000) nor the annual rule (0+25,000 <
    // 1,00,000) trips, for any tenant, ever.
    const b = await submitVerifyApprove("AGENCY-BILL-FIXVERIFY-B", "2026-06-15", 2_500_000);
    console.log(`[bug5 contractor-bill] tenant=${tenant} billB=${JSON.stringify(b.approveBody)}`);
    expect(b.approveBody.tdsApplied).toBe(true);
    expect(b.approveBody.tdsMinor).toBe("50000"); // applyBps(2_500_000, 200 bps -- 'other' kind)
  });
});
