/**
 * GAP-HR-TRANSFER-02 -- issue-order takes an officer-typed order number: format
 * checked at the boundary, no future order date, per-tenant uniqueness
 * (route 409 + DB unique index backstop), only a 'requested' transfer can be
 * ordered, HR-only. Real DB, no mocks.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { withRawTenantGuc } from "@civitasone/db";
import { buildApp } from "../app.js";
import { sqlClient } from "../shared/db.js";
import { queue } from "../shared/infra.js";
import { registerLifecycleMutationConsumers } from "../modules/lifecycle/consumer.js";

registerLifecycleMutationConsumers(queue);
const drain = (): Promise<void> => (queue as unknown as { drain: () => Promise<void> }).drain();

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "facade00-a908-4000-8000-000000000a98";
const SEED = "facade00-a908-4000-8000-0000000000ff";
const DEPT_A = "facade00-a908-4000-8000-0000000000d1";
const DEPT_B = "facade00-a908-4000-8000-0000000000d2";
const hr = { authorization: `Bearer ${signToken({ sub: randomUUID(), tid: TENANT, roles: ["hr_officer"], sid: "s1" }, SECRET)}` };
const emp = { authorization: `Bearer ${signToken({ sub: randomUUID(), tid: TENANT, roles: ["employee"], sid: "s2" }, SECRET)}` };

let app: Awaited<ReturnType<typeof buildApp>>;
const asTenant = <T>(fn: (tx: typeof sqlClient) => Promise<T>): Promise<T> => withRawTenantGuc(sqlClient, TENANT, fn);
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

const EMP = "facade00-a908-4000-8000-0000000000e1";
const OTHER = "facade00-a908-4000-8000-000000000a99";
const OTHER_EMP = "facade00-a908-4000-8000-0000000000e2";
const DESIG = "facade00-a908-4000-8000-0000000000d3";

async function seedTenant(tenant: string, emp: string): Promise<void> {
  await withRawTenantGuc(sqlClient, tenant, async (tx) => {
    await tx`INSERT INTO employee.hrms_departments (id, tenant_id, code, name, created_by, updated_by) VALUES (${DEPT_A}, ${tenant}, 'TA', 'A', ${SEED}, ${SEED}) ON CONFLICT DO NOTHING`;
    await tx`INSERT INTO employee.hrms_departments (id, tenant_id, code, name, created_by, updated_by) VALUES (${DEPT_B}, ${tenant}, 'TB', 'B', ${SEED}, ${SEED}) ON CONFLICT DO NOTHING`;
    await tx`INSERT INTO employee.hrms_designations (id, tenant_id, code, name, created_by, updated_by) VALUES (${DESIG}, ${tenant}, 'TD', 'D', ${SEED}, ${SEED}) ON CONFLICT DO NOTHING`;
    await tx`INSERT INTO employee.hrms_employees (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, employee_type, created_by, updated_by)
             VALUES (${emp}, ${tenant}, 'TRF-1', 'Transfer Test', ${DEPT_A}, ${DESIG}, '2015-01-01', 'permanent', ${SEED}, ${SEED}) ON CONFLICT DO NOTHING`;
  });
}
async function wipe(tenant: string): Promise<void> {
  await withRawTenantGuc(sqlClient, tenant, async (tx) => {
    await tx`DELETE FROM lifecycle.hrms_transfers WHERE tenant_id = ${tenant}`;
    await tx`DELETE FROM employee.hrms_employees WHERE tenant_id = ${tenant}`;
    await tx`DELETE FROM employee.hrms_designations WHERE tenant_id = ${tenant}`;
    await tx`DELETE FROM employee.hrms_departments WHERE tenant_id = ${tenant}`;
  });
}

async function newTransfer(status = "requested"): Promise<string> {
  const id = randomUUID();
  await asTenant((tx) => tx`
    INSERT INTO lifecycle.hrms_transfers (id, tenant_id, employee_id, from_dept_id, to_dept_id, effective_date, status, created_by, updated_by)
    VALUES (${id}, ${TENANT}, ${EMP}, ${DEPT_A}, ${DEPT_B}, '2026-12-01', ${status}, ${SEED}, ${SEED})`);
  return id;
}
const issue = (headers: Record<string, string>, id: string, payload: unknown) =>
  app.inject({ method: "POST", url: `/v1/hrms/lifecycle/transfers/${id}/issue-order`, headers, payload: payload as object });

beforeAll(async () => {
  await wipe(TENANT);
  await wipe(OTHER);
  await seedTenant(TENANT, EMP);
  await seedTenant(OTHER, OTHER_EMP);
  app = await buildApp();
});
afterAll(async () => {
  await wipe(TENANT);
  await wipe(OTHER);
  await app.close();
  await sqlClient.end();
});

describe("POST /lifecycle/transfers/:id/issue-order (GAP-HR-TRANSFER-02)", () => {
  it("issues with the officer-typed number: transfer becomes ordered with exactly that order_no / order_date", async () => {
    const id = await newTransfer();
    const r = await issue(hr, id, { orderNo: "12/2026-Estt", orderDate: today, orderRef: "File 4/7" });
    expect(r.statusCode).toBe(202);
    await drain();
    const row = (await asTenant((tx) => tx`SELECT status, order_no, order_date::text AS order_date, order_ref FROM lifecycle.hrms_transfers WHERE id = ${id}`))[0]!;
    expect(row).toMatchObject({ status: "ordered", order_no: "12/2026-Estt", order_date: today, order_ref: "File 4/7" });
    const ev = await asTenant((tx) => tx`SELECT payload FROM _outbox.messages WHERE tenant_id = ${TENANT} AND topic = 'audit.event.record' ORDER BY created_at DESC LIMIT 1`);
    const p = (typeof ev[0]!.payload === "string" ? JSON.parse(ev[0]!.payload as string) : ev[0]!.payload) as { action: string; resourceId: string };
    expect(p).toMatchObject({ action: "issue_order", resourceId: id });
  });

  it("rejects a duplicate order number in the same tenant, case-insensitively (409 ORDER_NO_EXISTS)", async () => {
    const id = await newTransfer();
    const r = await issue(hr, id, { orderNo: "12/2026-estt", orderDate: today });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("ORDER_NO_EXISTS");
    await drain();
    expect((await asTenant((tx) => tx`SELECT status FROM lifecycle.hrms_transfers WHERE id = ${id}`))[0]!.status).toBe("requested");
  });

  it("the DB unique index is the race-safe backstop (a second row cannot take the same number)", async () => {
    const id = await newTransfer();
    await expect(asTenant((tx) => tx`UPDATE lifecycle.hrms_transfers SET order_no = '12/2026-ESTT' WHERE id = ${id}`)).rejects.toThrow(/ux_hrms_transfers_order_no/);
  });

  it("two issue-order commands racing for the SAME number: exactly one wins, the loser leaves a failed audit event and nothing is issued twice", async () => {
    const a = await newTransfer();
    const b = await newTransfer();
    // both pass the route's pre-check because neither has committed yet
    const [ra, rb] = await Promise.all([
      issue(hr, a, { orderNo: "RACE/2026-1", orderDate: today }),
      issue(hr, b, { orderNo: "race/2026-1", orderDate: today }),
    ]);
    expect([ra.statusCode, rb.statusCode].every((s) => s === 202 || s === 409)).toBe(true);
    await drain();
    const rows = await asTenant((tx) => tx`SELECT id, status, order_no FROM lifecycle.hrms_transfers WHERE id IN (${a}, ${b})`);
    expect(rows.filter((r) => r.status === "ordered")).toHaveLength(1);
    // if the route pre-check already rejected one of them (409) there is no consumer failure to audit
    if (ra.statusCode === 202 && rb.statusCode === 202) {
      const fails = await asTenant((tx) => tx`SELECT payload FROM _outbox.messages WHERE tenant_id = ${TENANT} AND topic = 'audit.event.record' AND payload::text LIKE '%ORDER_NO_EXISTS%'`);
      expect(fails.length).toBeGreaterThanOrEqual(1);
    }
    const dup = await asTenant((tx) => tx`SELECT count(*)::int AS n FROM lifecycle.hrms_transfers WHERE tenant_id = ${TENANT} AND lower(order_no) = 'race/2026-1'`);
    expect(dup[0]!.n).toBe(1);
  });

  it("validates format (400), future date (422), wrong state (409), unknown id (404), and role (403)", async () => {
    const id = await newTransfer();
    expect((await issue(hr, id, { orderNo: "TO 1", orderDate: today })).statusCode).toBe(400);
    expect((await issue(hr, id, { orderNo: "", orderDate: today })).statusCode).toBe(400);
    const future = await issue(hr, id, { orderNo: "99/F", orderDate: "2999-01-01" });
    expect(future.statusCode).toBe(422);
    expect(future.json().code).toBe("ORDER_DATE_IN_FUTURE");
    const ordered = await newTransfer("ordered");
    const wrong = await issue(hr, ordered, { orderNo: "98/F", orderDate: today });
    expect(wrong.statusCode).toBe(409);
    expect((await issue(hr, randomUUID(), { orderNo: "97/F", orderDate: today })).statusCode).toBe(404);
    expect((await issue(emp, id, { orderNo: "96/F", orderDate: today })).statusCode).toBe(403);
  });

  it("the same number is usable in another tenant (uniqueness is per tenant)", async () => {
    const other = { authorization: `Bearer ${signToken({ sub: randomUUID(), tid: OTHER, roles: ["hr_admin"], sid: "s3" }, SECRET)}` };
    const id = randomUUID();
    await withRawTenantGuc(sqlClient, OTHER, (tx) => tx`
      INSERT INTO lifecycle.hrms_transfers (id, tenant_id, employee_id, from_dept_id, to_dept_id, effective_date, status, created_by, updated_by)
      VALUES (${id}, ${OTHER}, ${OTHER_EMP}, ${DEPT_A}, ${DEPT_B}, '2026-12-01', 'requested', ${SEED}, ${SEED})`);
    try {
      const r = await issue(other, id, { orderNo: "12/2026-Estt", orderDate: today });
      expect(r.statusCode).toBe(202);
    } finally {
      await withRawTenantGuc(sqlClient, OTHER, (tx) => tx`DELETE FROM lifecycle.hrms_transfers WHERE tenant_id = ${OTHER}`);
    }
  });
});
