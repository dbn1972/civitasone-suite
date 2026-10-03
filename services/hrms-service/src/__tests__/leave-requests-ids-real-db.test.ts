/**
 * Real-DB regression for GAP-HR-LEAVE-APPROVALS-04: GET /v1/hrms/leave-requests?ids=
 * is an id-based read authorised PER RECORD (HR any; own/direct-report scope;
 * otherwise only if the caller holds an open workflow task on that leave).
 * workflow-service is mocked at the client boundary.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { withTenantScope } from "@civitasone/db";

const openRefs = vi.hoisted(() => ({ ids: new Set<string>(), calls: [] as unknown[] }));
vi.mock("../shared/workflow-client.js", () => ({
  fetchOpenTaskRefIds: vi.fn(async (params: { refIds: string[] }) => {
    openRefs.calls.push(params);
    return new Set(params.refIds.filter((id) => openRefs.ids.has(id)));
  }),
}));

import { buildApp } from "../app.js";
import { db, sqlClient } from "../shared/db.js";
import { hrmsEmployees } from "../modules/employee/schema.js";
import { hrmsLeaveTypes, hrmsLeaveAllocs, hrmsLeaveApps } from "../modules/leave/schema.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const OTHER_TENANT = randomUUID();
const HR = randomUUID();

function auth(tenant: string, sub: string, roles: string[]): { authorization: string } {
  return { authorization: `Bearer ${signToken({ sub, tid: tenant, roles, sid: "sess-leave-ids" }, SECRET, 3600)}` };
}

let app: FastifyInstance;
const emp: Record<string, string> = {};
const leaveOf: Record<string, string> = {};

async function seedEmployee(tenant: string, key: string, userRef: string, managerId?: string): Promise<string> {
  const id = randomUUID();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await withTenantScope(db, tenant, (tx: any) => tx.insert(hrmsEmployees).values({
    id, tenantId: tenant, employeeNo: `LID-${id.slice(0, 8)}`, fullName: `Emp ${key}`,
    departmentId: randomUUID(), designationId: randomUUID(), dateOfJoining: "2020-01-15",
    userRef, ...(managerId ? { managerId } : {}), createdBy: HR, updatedBy: HR,
  }));
  emp[key] = id;
  return id;
}

async function seedLeave(tenant: string, key: string, employeeId: string, typeId: string): Promise<void> {
  const allocId = randomUUID();
  const id = randomUUID();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await withTenantScope(db, tenant, async (tx: any) => {
    await tx.insert(hrmsLeaveAllocs).values({ id: allocId, tenantId: tenant, employeeId, leaveTypeId: typeId, fy: "2026-27", totalDays: 20, balanceDays: 20, createdBy: HR, updatedBy: HR });
    await tx.insert(hrmsLeaveApps).values({ id, tenantId: tenant, employeeId, leaveTypeId: typeId, allocId, fromDate: "2026-09-01", toDate: "2026-09-02", daysApplied: 2, reason: `reason-${key}`, status: "pending", createdBy: HR, updatedBy: HR });
  });
  leaveOf[key] = id;
}

beforeAll(async () => {
  app = await buildApp();
  const typeId = randomUUID();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await withTenantScope(db, TENANT, (tx: any) => tx.insert(hrmsLeaveTypes).values({ id: typeId, tenantId: TENANT, code: "CL", name: "Casual Leave", maxDays: 12, createdBy: HR, updatedBy: HR }));
  const mgr = await seedEmployee(TENANT, "mgr", "mgr-sub");
  const rep = await seedEmployee(TENANT, "rep", "rep-sub", mgr);
  const stranger = await seedEmployee(TENANT, "stranger", "stranger-sub");
  await seedEmployee(TENANT, "approver", "approver-sub"); // unrelated user who holds a workflow task
  await seedLeave(TENANT, "rep", rep, typeId);
  await seedLeave(TENANT, "stranger", stranger, typeId);
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

const get = (qs: string, sub: string, roles: string[], tenant = TENANT) =>
  app.inject({ method: "GET", url: `/v1/hrms/leave-requests?${qs}`, headers: auth(tenant, sub, roles) });

describe("GET /v1/hrms/leave-requests?ids= (GAP-HR-LEAVE-APPROVALS-04)", () => {
  it("HR resolves exactly the named ids, regardless of page size", async () => {
    const res = await get(`ids=${leaveOf.rep},${leaveOf.stranger}&limit=1`, randomUUID(), ["hr_admin"]);
    expect(res.statusCode).toBe(200);
    expect(res.json().map((r: { id: string }) => r.id).sort()).toEqual([leaveOf.rep, leaveOf.stranger].sort());
  });

  it("a line manager gets only a direct report record; the stranger one is dropped (no workflow task)", async () => {
    openRefs.ids.clear();
    const res = await get(`ids=${leaveOf.rep},${leaveOf.stranger}`, "mgr-sub", ["manager"]);
    expect(res.json().map((r: { id: string }) => r.id)).toEqual([leaveOf.rep]);
  });

  it("an approver who is NOT the line manager sees ONLY the leave they hold an open workflow task on", async () => {
    openRefs.ids.clear();
    openRefs.ids.add(leaveOf.stranger!);
    openRefs.calls.length = 0;
    const res = await get(`ids=${leaveOf.rep},${leaveOf.stranger}`, "approver-sub", ["manager"]);
    expect(res.json().map((r: { id: string }) => r.id)).toEqual([leaveOf.stranger]);
    expect(openRefs.calls).toHaveLength(1);
    expect((openRefs.calls[0] as { refType: string }).refType).toBe("leave_app");
  });

  it("without any open task the same approver sees nothing (fail closed)", async () => {
    openRefs.ids.clear();
    const res = await get(`ids=${leaveOf.rep},${leaveOf.stranger}`, "approver-sub", ["manager"]);
    expect(res.json()).toEqual([]);
  });

  it("a bare employee reads only their own record, never another, even naming it", async () => {
    openRefs.ids.clear();
    const res = await get(`ids=${leaveOf.rep},${leaveOf.stranger}`, "rep-sub", ["employee"]);
    expect(res.json().map((r: { id: string }) => r.id)).toEqual([leaveOf.rep]);
  });

  it("another tenant HR cannot read this tenant ids", async () => {
    const res = await get(`ids=${leaveOf.rep}`, randomUUID(), ["hr_admin"], OTHER_TENANT);
    expect(res.json()).toEqual([]);
  });

  it("rejects a non-uuid id and more than 50 ids with 400", async () => {
    expect((await get("ids=not-a-uuid", randomUUID(), ["hr_admin"])).statusCode).toBe(400);
    const many = Array.from({ length: 51 }, () => randomUUID()).join(",");
    expect((await get(`ids=${many}`, randomUUID(), ["hr_admin"])).statusCode).toBe(400);
  });
});
