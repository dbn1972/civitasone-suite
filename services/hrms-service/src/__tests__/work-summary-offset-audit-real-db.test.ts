/**
 * Real-DB regression for GAP-HR-WORK-SUMMARY-05:
 *  - an ?offset= past the end is clamped back to the last real page (the web
 *    page used to print "Showing 1001-1000"),
 *  - a privileged tenant-wide read of other employees' APAR ratings writes an
 *    audit.event.record (DPDP); a self-scoped read does not.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { withTenantScope } from "@civitasone/db";
import { outboxMessages } from "@civitasone/outbox";
import { buildApp } from "../app.js";
import { db, sqlClient } from "../shared/db.js";
import { hrmsEmployees } from "../modules/employee/schema.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const HR = randomUUID();

function auth(sub: string, roles: string[]): { authorization: string } {
  return { authorization: `Bearer ${signToken({ sub, tid: TENANT, roles, sid: "sess-ws-audit" }, SECRET, 3600)}` };
}

let app: FastifyInstance;

async function seedEmployee(userRef: string, name: string): Promise<string> {
  const id = randomUUID();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await withTenantScope(db, TENANT, (tx: any) => tx.insert(hrmsEmployees).values({
    id, tenantId: TENANT, employeeNo: `WS-${id.slice(0, 8)}`, fullName: name,
    departmentId: randomUUID(), designationId: randomUUID(), dateOfJoining: "2020-01-15",
    userRef, createdBy: HR, updatedBy: HR,
  }));
  return id;
}

async function seedAppraisal(employeeId: string, period: string): Promise<void> {
  await sqlClient.begin(async (sql) => {
    await sql.unsafe("SELECT set_config('app.tenant_id', $1, true)", [TENANT]);
    await sql.unsafe(
      `INSERT INTO appraisal.hrms_appraisals (id, tenant_id, employee_id, appraisal_period, rating, status, created_by, updated_by)
       VALUES ($1,$2,$3,$4,4.0,'completed',$5,$5)`,
      [randomUUID(), TENANT, employeeId, period, HR],
    );
  });
}

async function auditCount(action: string): Promise<number> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = await withTenantScope(db, TENANT, (tx: any) => tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT)));
  return (rows as Array<{ payload: { action?: string } }>).filter((r) => r.payload?.action === action).length;
}

beforeAll(async () => {
  app = await buildApp();
  const a = await seedEmployee("ws-alice", "Alice WS");
  const b = await seedEmployee("ws-bob", "Bob WS");
  await seedAppraisal(a, "2025-26");
  await seedAppraisal(b, "2025-26");
  await seedAppraisal(a, "2024-25");
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

describe("GET /v1/hrms/work-summaries (GAP-HR-WORK-SUMMARY-05)", () => {
  it("clamps an offset past the end to the last real page and reports the offset it served", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/hrms/work-summaries?offset=5000", headers: auth(HR, ["hr_admin"]) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(3);
    expect(body.offset).toBe(0);
    expect(body.data).toHaveLength(3);
  });

  it("records an audit event for a privileged tenant-wide read (window + count, never ratings)", async () => {
    const before = await auditCount("hrms.work_summary.list_viewed");
    const res = await app.inject({ method: "GET", url: "/v1/hrms/work-summaries", headers: auth(HR, ["hr_admin"]) });
    expect(res.statusCode).toBe(200);
    expect(await auditCount("hrms.work_summary.list_viewed")).toBe(before + 1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = (await withTenantScope(db, TENANT, (tx: any) => tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT)))) as Array<{ actorId: string; payload: { action?: string; metadata?: Record<string, unknown> } }>;
    const ev = rows.filter((r) => r.payload?.action === "hrms.work_summary.list_viewed").pop()!;
    expect(ev.actorId).toBe(HR);
    expect(ev.payload.metadata).toEqual({ offset: 0, count: 3, total: 3 });
  });

  it("does NOT audit an employee reading only their own summary", async () => {
    const before = await auditCount("hrms.work_summary.list_viewed");
    const res = await app.inject({ method: "GET", url: "/v1/hrms/work-summaries", headers: auth("ws-alice", ["employee"]) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(2);
    expect(await auditCount("hrms.work_summary.list_viewed")).toBe(before);
  });
});
