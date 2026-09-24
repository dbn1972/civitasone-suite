/**
 * Bug 2 regression tests — approving an attendance regularisation now
 * actually corrects the linked hrms_attendance record.
 *
 * Before this fix, `attendance_routes__0` (see f3-consumer.ts) only flipped
 * the regularisation request's own status to "approved" — it never touched
 * hrms_attendance, so an employee marked "absent" stayed "absent" forever
 * even after HR approved a correction. No consumer anywhere subscribes to
 * the EVENTS.regularisationApproved event this case enqueues either
 * (confirmed by inspection), so that loop was never closing it.
 *
 * Live-DB integration test — same reasoning as lifecycle/effective-dating.test.ts:
 * hrms_attendance/hrms_attendance_regularisations both carry FORCE ROW LEVEL
 * SECURITY, and hrms_svc (this service's connecting role) has no BYPASSRLS,
 * so every direct DB access goes through
 * runWithTenant(tenantId, () => db.transaction(tx => ...)), and the
 * consumer-driven write goes through a queue wrapped the same way
 * production's queue-service does.
 */
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { MemoryQueue, type Queue, type Handler } from "@civitasone/queue";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { db } from "../../shared/db.js";
import { hrmsEmployees } from "../employee/schema.js";
import {
  hrmsAttendance, hrmsAttendanceRegularisations, hrmsOvertimeRequests,
  type AttendanceRow, type RegularisationRow, type OvertimeRequestRow,
} from "./schema.js";
import { registerF3_attendance_Consumers } from "./f3-consumer.js";
import { COMMANDS } from "../../topics.js";

function wireTenantAwareQueue(q: Queue): Queue {
  const rawSubscribe = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    rawSubscribe(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  return q;
}

async function buildQueue(): Promise<MemoryQueue> {
  const q = new MemoryQueue({ maxAttempts: 1 });
  wireTenantAwareQueue(q);
  registerF3_attendance_Consumers(q);
  await q.start();
  return q;
}

interface Seeded {
  tenantId: string;
  employeeId: string;
  actorId: string;
}

async function seedEmployee(): Promise<Seeded> {
  const tenantId = randomUUID();
  const employeeId = randomUUID();
  const actorId = randomUUID();
  await runWithTenant(tenantId, () => db.transaction(async (tx) => {
    await tx.insert(hrmsEmployees).values({
      id: employeeId, tenantId,
      employeeNo: `REG-${employeeId.slice(0, 8)}`,
      fullName: "Regularisation Test Employee",
      departmentId: randomUUID(), designationId: randomUUID(),
      dateOfJoining: "2020-01-01", status: "confirmed",
      createdBy: actorId, updatedBy: actorId,
    });
  }));
  return { tenantId, employeeId, actorId };
}

async function cleanupEmployee(tenantId: string, employeeId: string): Promise<void> {
  await runWithTenant(tenantId, () => db.transaction(async (tx) => {
    // No FK from hrms_attendance/hrms_attendance_regularisations to
    // hrms_employees (confirmed: migration 0028 only adds the reverse FK
    // employee_id -> hrms_employees(id) ON DELETE CASCADE), so deleting the
    // employee cascades those away too.
    await tx.delete(hrmsEmployees).where(eq(hrmsEmployees.id, employeeId));
  }));
}

async function getAttendance(tenantId: string, employeeId: string, date: string): Promise<AttendanceRow | undefined> {
  return runWithTenant(tenantId, () => db.transaction(async (tx) => {
    const [row] = await tx.select().from(hrmsAttendance).where(and(
      eq(hrmsAttendance.employeeId, employeeId), eq(hrmsAttendance.attendanceDate, date),
    ));
    return row;
  }));
}

async function getRegularisation(tenantId: string, id: string): Promise<RegularisationRow | undefined> {
  return runWithTenant(tenantId, () => db.transaction(async (tx) => {
    const [row] = await tx.select().from(hrmsAttendanceRegularisations).where(eq(hrmsAttendanceRegularisations.id, id));
    return row;
  }));
}

async function seedOvertimeRequest(
  tenantId: string, employeeId: string, actorId: string, status: "pending" | "approved" | "rejected",
): Promise<string> {
  const id = randomUUID();
  await runWithTenant(tenantId, () => db.transaction(async (tx) => {
    await tx.insert(hrmsOvertimeRequests).values({
      id, tenantId, employeeId,
      requestDate: pastDateISO(2), hoursRequested: "3.00", reason: "Month-end closing",
      status,
      ...(status === "approved" ? { approvedBy: actorId, approvedAt: new Date() } : {}),
      ...(status === "rejected" ? { rejectionReason: "Insufficient justification" } : {}),
      createdBy: actorId, updatedBy: actorId,
    });
  }));
  return id;
}

async function getOvertimeRequest(tenantId: string, id: string): Promise<OvertimeRequestRow | undefined> {
  return runWithTenant(tenantId, () => db.transaction(async (tx) => {
    const [row] = await tx.select().from(hrmsOvertimeRequests).where(eq(hrmsOvertimeRequests.id, id));
    return row;
  }));
}

function pastDateISO(daysAgo: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

describe("Bug 2 — attendance regularisation approval actually corrects hrms_attendance", () => {
  it("employee marked absent, regularisation approved: attendance record now reflects the correction, not still absent", async () => {
    const { tenantId, employeeId, actorId } = await seedEmployee();
    try {
      const date = pastDateISO(3);
      const regId = randomUUID();

      await runWithTenant(tenantId, () => db.transaction(async (tx) => {
        await tx.insert(hrmsAttendance).values({
          id: randomUUID(), tenantId, employeeId, attendanceDate: date,
          status: "absent", source: "manual", createdBy: actorId, updatedBy: actorId,
        });
        await tx.insert(hrmsAttendanceRegularisations).values({
          id: regId, tenantId, employeeId, date,
          reason: "Forgot to punch in", requestedStatus: "present", status: "pending",
          createdBy: actorId, updatedBy: actorId,
        });
      }));

      const before = await getAttendance(tenantId, employeeId, date);
      expect(before?.status).toBe("absent");

      const q = await buildQueue();
      await q.publish(COMMANDS.f3RouteWrite, {
        messageId: randomUUID(), type: COMMANDS.f3RouteWrite,
        tenantId, actorId, correlationId: randomUUID(), schemaVersion: "1.0",
        payload: {
          op: "attendance_routes__0", id: regId, tenantId,
          body: { reason: "Approved — checked biometric log" },
          params: { id: regId }, query: {},
        },
      });
      await q.drain();

      const after = await getAttendance(tenantId, employeeId, date);
      expect(after?.status).toBe("present");
      // Note: upsertAttendance's ON CONFLICT DO UPDATE set list (attendance/
      // repo.ts, pre-existing/unchanged here) only touches status/inTime/
      // outTime/lateMins/updatedAt — not source — so correcting an EXISTING
      // row keeps its original source (here "manual"); only a fresh insert
      // (no prior row — see the next test) gets source: "regularisation".
      // The bug this test guards is the status never changing at all; it
      // now does.
      expect(after?.source).toBe("manual");

      const reg = await getRegularisation(tenantId, regId);
      expect(reg?.status).toBe("approved");
    } finally {
      await cleanupEmployee(tenantId, employeeId);
    }
  });

  it("regularisation approved for a date with NO existing attendance row: creates one with the requested status (e.g. employee never punched in at all)", async () => {
    const { tenantId, employeeId, actorId } = await seedEmployee();
    try {
      const date = pastDateISO(5);
      const regId = randomUUID();

      await runWithTenant(tenantId, () => db.transaction(async (tx) => {
        await tx.insert(hrmsAttendanceRegularisations).values({
          id: regId, tenantId, employeeId, date,
          reason: "Never punched in", requestedStatus: "present", status: "pending",
          createdBy: actorId, updatedBy: actorId,
        });
      }));

      const before = await getAttendance(tenantId, employeeId, date);
      expect(before).toBeUndefined();

      const q = await buildQueue();
      await q.publish(COMMANDS.f3RouteWrite, {
        messageId: randomUUID(), type: COMMANDS.f3RouteWrite,
        tenantId, actorId, correlationId: randomUUID(), schemaVersion: "1.0",
        payload: {
          op: "attendance_routes__0", id: regId, tenantId,
          body: {}, params: { id: regId }, query: {},
        },
      });
      await q.drain();

      const after = await getAttendance(tenantId, employeeId, date);
      expect(after?.status).toBe("present");
      // Fresh insert (no prior row to conflict with) — source is exactly
      // what the approve handler wrote.
      expect(after?.source).toBe("regularisation");
    } finally {
      await cleanupEmployee(tenantId, employeeId);
    }
  });
});

/**
 * Wave 4 / cluster D regression tests — overtime approve/reject no longer
 * allows illegal state reversal.
 *
 * Before this fix, `attendance_routes__3`/`__4` (see f3-consumer.ts) ran a
 * blind UPDATE keyed only on id+tenantId, and routes.ts's synchronous
 * pre-check only verified the row existed — neither layer checked status.
 * An already-approved overtime request could later be rejected (or an
 * already-rejected one later approved) with no error at all. This mirrors
 * Bug 2's regularisation guard above but for hrms_overtime_requests,
 * exercised the same way: seed a row directly at a terminal status, publish
 * the f3RouteWrite command a real client would send, drain the real queue,
 * and assert against the real row afterward.
 */
describe("Overtime approve/reject — decided requests cannot be re-decided", () => {
  it("rejecting an already-approved overtime request leaves it approved (does not flip to rejected)", async () => {
    const { tenantId, employeeId, actorId } = await seedEmployee();
    try {
      const otId = await seedOvertimeRequest(tenantId, employeeId, actorId, "approved");

      const before = await getOvertimeRequest(tenantId, otId);
      expect(before?.status).toBe("approved");

      const q = await buildQueue();
      await q.publish(COMMANDS.f3RouteWrite, {
        messageId: randomUUID(), type: COMMANDS.f3RouteWrite,
        tenantId, actorId, correlationId: randomUUID(), schemaVersion: "1.0",
        payload: {
          op: "attendance_routes__4", id: otId, tenantId,
          body: { reason: "Trying to reverse an already-approved claim" },
          params: { id: otId }, query: {},
        },
      });
      await q.drain();

      // Before the fix: this flipped to "rejected" with rejectionReason set
      // — illegal state reversal, no error surfaced anywhere. After the
      // fix: repo.updateOvertimeStatus's WHERE status='pending' guard
      // matches zero rows, so the request is untouched.
      const after = await getOvertimeRequest(tenantId, otId);
      expect(after?.status).toBe("approved");
      expect(after?.rejectionReason).toBeNull();
    } finally {
      await cleanupEmployee(tenantId, employeeId);
    }
  });

  it("approving an already-rejected overtime request leaves it rejected (does not flip to approved)", async () => {
    const { tenantId, employeeId, actorId } = await seedEmployee();
    try {
      const otId = await seedOvertimeRequest(tenantId, employeeId, actorId, "rejected");

      const before = await getOvertimeRequest(tenantId, otId);
      expect(before?.status).toBe("rejected");

      const q = await buildQueue();
      await q.publish(COMMANDS.f3RouteWrite, {
        messageId: randomUUID(), type: COMMANDS.f3RouteWrite,
        tenantId, actorId, correlationId: randomUUID(), schemaVersion: "1.0",
        payload: {
          op: "attendance_routes__3", id: otId, tenantId,
          body: {}, params: { id: otId }, query: {},
        },
      });
      await q.drain();

      const after = await getOvertimeRequest(tenantId, otId);
      expect(after?.status).toBe("rejected");
      expect(after?.approvedBy).toBeNull();
      expect(after?.approvedAt).toBeNull();
    } finally {
      await cleanupEmployee(tenantId, employeeId);
    }
  });

  it("approving a genuinely pending overtime request still works (guard doesn't block the legitimate case)", async () => {
    const { tenantId, employeeId, actorId } = await seedEmployee();
    try {
      const otId = await seedOvertimeRequest(tenantId, employeeId, actorId, "pending");

      const q = await buildQueue();
      await q.publish(COMMANDS.f3RouteWrite, {
        messageId: randomUUID(), type: COMMANDS.f3RouteWrite,
        tenantId, actorId, correlationId: randomUUID(), schemaVersion: "1.0",
        payload: {
          op: "attendance_routes__3", id: otId, tenantId,
          body: {}, params: { id: otId }, query: {},
        },
      });
      await q.drain();

      const after = await getOvertimeRequest(tenantId, otId);
      expect(after?.status).toBe("approved");
      expect(after?.approvedBy).toBe(actorId);
    } finally {
      await cleanupEmployee(tenantId, employeeId);
    }
  });
});
