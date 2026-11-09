/**
 * UAT b23 P5 -- GET /v1/payroll/salary-revisions?status=pending.
 * The list is newest-first and capped at 100, so an OLD revision still awaiting its second approver was
 * missing from the page once 100+ newer ones existed (the web "pending" panel filtered that page).
 * Real (disposable) Postgres through buildApp(); seeds written under the tenant context.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const OTHER_TENANT = randomUUID();
const CHECKER = randomUUID();
const EMP = randomUUID();
const OLD_PENDING = randomUUID();
const OTHER_TENANT_PENDING = randomUUID();

const headers = { authorization: `Bearer ${signToken({ sub: CHECKER, tid: TENANT, roles: ["payroll_admin"], sid: "b23-sr" }, SECRET)}` };

async function seed(tenant: string, id: string, effective: string, status: string, orderNo: string) {
  await runWithTenant(tenant, () => db.transaction(async (tx) => {
    await tx.execute(sql`
      INSERT INTO payroll.payroll_salary_revisions
        (id, tenant_id, employee_id, effective_date, old_basic_minor, new_basic_minor, old_gross_minor, new_gross_minor, revision_type, order_no, status)
      VALUES (${id}::uuid, ${tenant}::uuid, ${EMP}::uuid, ${effective}::date, 4000000, 4400000, 8000000, 8800000, 'annual_increment', ${orderNo}, ${status})`);
  }));
}

beforeAll(async () => {
  // 105 approved revisions dated AFTER the one pending revision (Pay Commission arrears, Finance Dept)
  for (let i = 0; i < 105; i++) {
    const d = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
    await seed(TENANT, randomUUID(), d, "approved", `FD/PAY/2026/${String(i + 1).padStart(3, "0")}`);
  }
  await seed(TENANT, OLD_PENDING, "2025-04-01", "pending", "FD/PAY/2025/041");
  await seed(OTHER_TENANT, OTHER_TENANT_PENDING, "2026-03-01", "pending", "RD/PAY/2026/009");
});
afterAll(async () => { await sqlClient.end(); });

async function get(url: string) {
  const app = await buildApp();
  try { return await app.inject({ method: "GET", url, headers }); } finally { await app.close(); }
}

describe("GET /v1/payroll/salary-revisions status filter (UAT b23 P5)", () => {
  it("the default page (newest 100) does not contain the old pending revision -- the reported defect", async () => {
    const res = await get("/v1/payroll/salary-revisions");
    expect(res.statusCode).toBe(200);
    const rows = res.json().data as Array<{ id: string }>;
    expect(rows).toHaveLength(100);
    expect(rows.some((r) => r.id === OLD_PENDING)).toBe(false);
  });

  it("?status=pending returns it, only pending rows, and only this tenant's", async () => {
    const res = await get("/v1/payroll/salary-revisions?status=pending");
    expect(res.statusCode).toBe(200);
    const rows = res.json().data as Array<{ id: string; status: string }>;
    expect(rows.map((r) => r.id)).toEqual([OLD_PENDING]);
    expect(rows.every((r) => r.status === "pending")).toBe(true);
  });

  it("rejects an unknown status", async () => {
    expect((await get("/v1/payroll/salary-revisions?status=bogus")).statusCode).toBe(400);
  });
});
