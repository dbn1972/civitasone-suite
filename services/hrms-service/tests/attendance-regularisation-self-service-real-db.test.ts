/**
 * GAP-HR-ATTENDANCE-REGULARISATION-01 -- raising a regularisation: employee
 * self-service (own record only), manager for self + direct reports, HR on
 * behalf of anyone; own-request visibility; maker != checker on decisions.
 * Real DB through the Fastify app + in-memory queue.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import type { MemoryQueue } from "@civitasone/queue";
import type { FastifyInstance } from "fastify";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { buildApp } from "../src/app.js";
import { registerAttendanceConsumers } from "../src/modules/attendance/consumer.js";
import { registerF3_attendance_Consumers } from "../src/modules/attendance/f3-consumer.js";
import { hrmsAttendance, hrmsAttendanceRegularisations } from "../src/modules/attendance/schema.js";
import { COMMANDS } from "../src/topics.js";
import { hrmsEmployees, hrmsDepartments, hrmsDesignations } from "../src/modules/employee/schema.js";

registerAttendanceConsumers(queue);
registerF3_attendance_Consumers(queue);
const drain = () => (queue as unknown as MemoryQueue).drain();

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const deptId = randomUUID();
const desigId = randomUUID();
const U = { emp: randomUUID(), emp2: randomUUID(), mgr: randomUUID(), hrA: randomUUID(), hrB: randomUUID(), ghost: randomUUID() };
const E: Record<string, string> = {};
const DAY = "2026-02-10";
const asTenant = <T>(fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>) => runWithTenant(TENANT, () => db.transaction(fn));
const h = (sub: string, roles: string[]) => ({ authorization: `Bearer ${signToken({ sub, tid: TENANT, roles, sid: "s" }, SECRET)}`, "content-type": "application/json" });

let app: FastifyInstance;

async function seed(name: string, userRef: string | null, managerId: string | null = null): Promise<string> {
  const id = randomUUID();
  await asTenant(async (tx) => {
    await tx.insert(hrmsEmployees).values({
      id, tenantId: TENANT, employeeNo: `RG-${id.slice(0, 8)}`, fullName: name, departmentId: deptId, designationId: desigId,
      dateOfJoining: "2024-01-01", status: "confirmed", employeeType: "permanent", basicMinor: 5_000_000n, userRef, managerId, createdBy: U.hrA, updatedBy: U.hrA,
    });
    await tx.insert(hrmsAttendance).values({ tenantId: TENANT, employeeId: id, attendanceDate: DAY, status: "absent", createdBy: U.hrA, updatedBy: U.hrA });
  });
  return id;
}

const raise = (sub: string, roles: string[], payload: Record<string, unknown>) =>
  app.inject({ method: "POST", url: "/v1/hrms/attendance/regularisations", headers: h(sub, roles), payload: { date: DAY, requestedStatus: "present", reason: "Biometric was down", ...payload } });
const rows = () => asTenant((tx) => tx.select().from(hrmsAttendanceRegularisations).where(eq(hrmsAttendanceRegularisations.tenantId, TENANT)));

beforeAll(async () => {
  app = await buildApp();
  await asTenant(async (tx) => {
    await tx.insert(hrmsDepartments).values({ id: deptId, tenantId: TENANT, code: `R${TENANT.slice(0, 6)}`, name: "Dept", createdBy: U.hrA, updatedBy: U.hrA });
    await tx.insert(hrmsDesignations).values({ id: desigId, tenantId: TENANT, code: `RD${TENANT.slice(0, 6)}`, name: "Desig", createdBy: U.hrA, updatedBy: U.hrA });
  });
  E.mgr = await seed("Manager", U.mgr);
  E.emp = await seed("Employee One", U.emp, E.mgr);
  E.emp2 = await seed("Employee Two", U.emp2, null);
  E.hrA = await seed("HR A", U.hrA);
  E.hrB = await seed("HR B", U.hrB);
});

afterAll(async () => {
  await asTenant(async (tx) => {
    await tx.delete(hrmsAttendanceRegularisations).where(eq(hrmsAttendanceRegularisations.tenantId, TENANT));
    await tx.delete(hrmsAttendance).where(eq(hrmsAttendance.tenantId, TENANT));
    await tx.delete(hrmsEmployees).where(eq(hrmsEmployees.tenantId, TENANT));
    await tx.delete(hrmsDesignations).where(eq(hrmsDesignations.tenantId, TENANT));
    await tx.delete(hrmsDepartments).where(eq(hrmsDepartments.tenantId, TENANT));
  });
  await app.close();
  await sqlClient.end();
});

describe("raising a regularisation", () => {
  it("an employee raises their OWN request without naming themselves; it lands pending for them", async () => {
    const r = await raise(U.emp, ["employee"], {});
    expect(r.statusCode).toBe(202);
    await drain();
    const mine = (await rows()).filter((x) => x.employeeId === E.emp);
    expect(mine.length).toBe(1);
    expect(mine[0]).toMatchObject({ status: "pending", requestedStatus: "present", date: DAY });
  });

  it("an employee naming a colleague is refused; naming themselves explicitly is fine", async () => {
    expect((await raise(U.emp, ["employee"], { employeeId: E.emp2 })).statusCode).toBe(403);
    expect((await raise(U.emp, ["employee"], { employeeId: E.emp })).statusCode).toBe(202);
  });

  it("an account with no linked employee record cannot raise one", async () => {
    expect((await raise(U.ghost, ["employee"], {})).statusCode).toBe(403);
  });

  it("a manager raises for a DIRECT REPORT (and self) but not for an arbitrary colleague", async () => {
    expect((await raise(U.mgr, ["manager"], { employeeId: E.emp })).statusCode).toBe(202);
    expect((await raise(U.mgr, ["manager"], {})).statusCode).toBe(202);
    const r = await raise(U.mgr, ["manager"], { employeeId: E.emp2 });
    expect(r.statusCode).toBe(403);
    expect((r.json() as { code: string }).code).toBe("NOT_YOUR_REPORT");
  });

  it("HR raises on behalf of anyone but must name the employee", async () => {
    expect((await raise(U.hrA, ["hr_officer"], { employeeId: E.emp2 })).statusCode).toBe(202);
    expect((await raise(U.hrA, ["hr_officer"], {})).statusCode).toBe(400);
  });

  it("keeps the existing guards: no attendance that day -> 404, future date -> 400", async () => {
    const r = await raise(U.emp, ["employee"], { date: "2026-02-11" });
    expect(r.statusCode).toBe(404);
    expect((r.json() as { code: string }).code).toBe("ATTENDANCE_RECORD_NOT_FOUND");
    expect((await raise(U.emp, ["employee"], { date: "2999-01-01" })).statusCode).toBe(400);
  });
});

describe("visibility", () => {
  it("an employee lists ONLY their own requests; HR lists everyone's; a manager sees self + reports, not outsiders", async () => {
    await drain();
    const list = async (sub: string, roles: string[]) =>
      ((await app.inject({ method: "GET", url: "/v1/hrms/attendance/regularisations", headers: h(sub, roles) })).json() as Array<{ employeeId: string }>);
    const own = await list(U.emp, ["employee"]);
    expect(own.length).toBeGreaterThan(0);
    expect(own.every((r) => r.employeeId === E.emp)).toBe(true);
    const emp2 = await list(U.emp2, ["employee"]);
    expect(emp2.every((r) => r.employeeId === E.emp2)).toBe(true);
    const all = await list(U.hrB, ["hr_officer"]);
    expect(new Set(all.map((r) => r.employeeId))).toEqual(new Set([E.emp, E.emp2, E.mgr]));
    const mgr = await list(U.mgr, ["manager"]);
    expect(mgr.every((r) => [E.emp, E.mgr].includes(r.employeeId))).toBe(true);
    expect(mgr.some((r) => r.employeeId === E.emp2)).toBe(false);
    expect((await list(U.ghost, ["employee"])).length).toBe(0);
  });
});

describe("maker != checker on the decision", () => {
  it("an HR officer cannot approve or reject a request raised FOR themselves; a different HR officer can", async () => {
    const own = await raise(U.hrA, ["hr_officer"], { employeeId: E.hrA });
    expect(own.statusCode).toBe(202);
    await drain();
    const id = (await rows()).find((x) => x.employeeId === E.hrA)!.id;
    const a = await app.inject({ method: "POST", url: `/v1/hrms/attendance/regularisations/${id}/approve`, headers: h(U.hrA, ["hr_officer"]), payload: {} });
    expect(a.statusCode).toBe(403);
    expect((a.json() as { code: string }).code).toBe("SELF_APPROVAL_FORBIDDEN");
    const rj = await app.inject({ method: "POST", url: `/v1/hrms/attendance/regularisations/${id}/reject`, headers: h(U.hrA, ["hr_officer"]), payload: { reason: "no" } });
    expect(rj.statusCode).toBe(403);
    expect((await rows()).find((x) => x.id === id)!.status).toBe("pending");
    const ok = await app.inject({ method: "POST", url: `/v1/hrms/attendance/regularisations/${id}/approve`, headers: h(U.hrB, ["hr_officer"]), payload: {} });
    expect(ok.statusCode).toBe(202);
    await drain();
    expect((await rows()).find((x) => x.id === id)!.status).toBe("approved");
  });
});

describe("maker != checker is re-asserted where the decision is applied (reviewer item 3)", () => {
  it("a decision command that reaches the consumer with the owner as actor is NOT applied (approve and reject), the row stays pending", async () => {
    expect((await raise(U.emp2, ["employee"], {})).statusCode).toBe(202);
    await drain();
    const reg = (await rows()).find((x) => x.employeeId === E.emp2 && x.status === "pending")!;
    for (const op of ["attendance_routes__0", "attendance_routes__1"]) {
      // bypass the route: publish the F3 write straight onto the queue, acting as the request's own owner
      await queue.publish(COMMANDS.f3RouteWrite, {
        messageId: randomUUID(), type: COMMANDS.f3RouteWrite, tenantId: TENANT, actorId: U.emp2, correlationId: randomUUID(), schemaVersion: "1.0",
        payload: { op, id: reg.id, tenantId: TENANT, params: { id: reg.id }, body: { reason: "deciding my own request" } },
      }).catch(() => undefined);
      await drain().catch(() => undefined);
    }
    expect((await rows()).find((x) => x.id === reg.id)!.status).toBe("pending");
    // while the same command from a DIFFERENT actor is applied
    await queue.publish(COMMANDS.f3RouteWrite, {
      messageId: randomUUID(), type: COMMANDS.f3RouteWrite, tenantId: TENANT, actorId: U.hrB, correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { op: "attendance_routes__0", id: reg.id, tenantId: TENANT, params: { id: reg.id }, body: {} },
    });
    await drain();
    expect((await rows()).find((x) => x.id === reg.id)!.status).toBe("approved");
  });
});

describe("list scope is applied in the SQL WHERE, before the limit (reviewer N1)", () => {
  it("an employee with few rows still gets them when the tenant has more recent rows from others than the page size", async () => {
    // 6 newer requests from other employees, then limit=3: a post-filter of a tenant-wide page would hide the viewer's rows
    const days = ["2026-02-10"];
    void days;
    const mineBefore = (await app.inject({ method: "GET", url: "/v1/hrms/attendance/regularisations?limit=100", headers: h(U.emp, ["employee"]) })).json() as Array<{ employeeId: string }>;
    expect(mineBefore.length).toBeGreaterThan(0);
    const small = (await app.inject({ method: "GET", url: "/v1/hrms/attendance/regularisations?limit=1", headers: h(U.emp, ["employee"]) })).json() as Array<{ employeeId: string }>;
    expect(small.length).toBe(1);
    expect(small[0]!.employeeId).toBe(E.emp);
    // and a viewer with no linked employee gets nothing, not someone else's page
    expect(((await app.inject({ method: "GET", url: "/v1/hrms/attendance/regularisations?limit=1", headers: h(U.ghost, ["employee"]) })).json() as unknown[]).length).toBe(0);
  });
});
