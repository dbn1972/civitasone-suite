/**
 * hrms-service consumer coverage tests
 *
 * Tests employee create, leave allocate, leave apply, leave approve,
 * and attendance mark consumers via MemoryQueue + real DB verification.
 * Idempotency (duplicate messageId) is tested for each consumer.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MemoryQueue } from "@civitasone/queue";
import { eq, and } from "drizzle-orm";
import { db, sqlClient } from "../src/shared/db.js";
import { hrmsEmployees, hrmsDepartments, hrmsDesignations } from "../src/modules/employee/schema.js";
import { hrmsLeaveApps, hrmsLeaveAllocs, hrmsLeaveTypes } from "../src/modules/leave/schema.js";
import { hrmsAttendance } from "../src/modules/attendance/schema.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { registerEmployeeConsumers } from "../src/modules/employee/consumer.js";
import { registerLeaveConsumers } from "../src/modules/leave/consumer.js";
import { registerAttendanceConsumers } from "../src/modules/attendance/consumer.js";
import { COMMANDS } from "../src/topics.js";

const ACTOR   = "00000000-aaaa-4000-8000-000000000099";
const TENANT  = "11111111-aaaa-4000-8000-000000000099";
const DEPT_1  = "77777777-aaaa-4000-8000-000000000099";
const DESIG_1 = "88888888-bbbb-4000-8000-000000000099";
const EMP_1   = "22222222-bbbb-4000-8000-000000000099";
const EMP_2   = "22222222-cccc-4000-8000-000000000099";
const LT_1    = "33333333-cccc-4000-8000-000000000099";
const ALLOC_1 = "44444444-dddd-4000-8000-000000000099";
const ALLOC_2 = "44444444-eeee-4000-8000-000000000099";
const APP_1   = "55555555-eeee-4000-8000-000000000099";
const APP_2   = "55555555-ffff-4000-8000-000000000099";

// Message IDs
const MSG_EMP_CREATE   = "aaa00001-0000-4000-8000-000000000099";
const MSG_EMP_CREATE2  = "aaa00002-0000-4000-8000-000000000099";
const MSG_EMP_DUP      = MSG_EMP_CREATE; // duplicate
const MSG_ALLOC        = "bbb00001-0000-4000-8000-000000000099";
const MSG_ALLOC2       = "bbb00002-0000-4000-8000-000000000099";
const MSG_APPLY        = "ccc00001-0000-4000-8000-000000000099";
const MSG_APPLY2       = "ccc00002-0000-4000-8000-000000000099";
const MSG_APPROVE      = "ddd00001-0000-4000-8000-000000000099";
const MSG_APPROVE2     = "ddd00002-0000-4000-8000-000000000099";
const MSG_ATTEND       = "eee00001-0000-4000-8000-000000000099";
const MSG_ATTEND2      = "eee00002-0000-4000-8000-000000000099";
const MSG_ATTEND_DUP   = MSG_ATTEND; // duplicate

const WAIT = 700;

async function wipeAll() {
  await db.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
  await db.delete(hrmsLeaveApps).where(eq(hrmsLeaveApps.tenantId, TENANT));
  await db.delete(hrmsLeaveAllocs).where(eq(hrmsLeaveAllocs.tenantId, TENANT));
  await db.delete(hrmsLeaveTypes).where(eq(hrmsLeaveTypes.tenantId, TENANT));
  await db.delete(hrmsAttendance).where(eq(hrmsAttendance.tenantId, TENANT));
  await db.delete(hrmsEmployees).where(eq(hrmsEmployees.tenantId, TENANT));
  await db.delete(hrmsDepartments).where(eq(hrmsDepartments.tenantId, TENANT));
  await db.delete(hrmsDesignations).where(eq(hrmsDesignations.tenantId, TENANT));
  // Clean processed entries for our message IDs
  for (const mid of [MSG_EMP_CREATE, MSG_EMP_CREATE2, MSG_ALLOC, MSG_ALLOC2,
    MSG_APPLY, MSG_APPLY2, MSG_APPROVE, MSG_APPROVE2, MSG_ATTEND, MSG_ATTEND2]) {
    await db.delete(processed).where(eq(processed.messageId, mid));
  }
}

async function seedDeptDesig() {
  await db.insert(hrmsDepartments).values({
    id: DEPT_1, tenantId: TENANT, code: "COV-DEPT", name: "Coverage Dept",
    createdBy: ACTOR, updatedBy: ACTOR,
  });
  await db.insert(hrmsDesignations).values({
    id: DESIG_1, tenantId: TENANT, code: "COV-DESIG", name: "Coverage Desig",
    createdBy: ACTOR, updatedBy: ACTOR,
  });
}

// ── 1. Employee Create Consumer ───────────────────────────────────

describe("Employee create consumer — coverage", () => {
  beforeAll(async () => { await wipeAll(); await seedDeptDesig(); });
  afterAll(async () => { await wipeAll(); });

  it("inserts employee row with correct fields", async () => {
    const q = new MemoryQueue();
    registerEmployeeConsumers(q);
    await q.start();

    await q.publish(COMMANDS.employeeCreate, {
      messageId: MSG_EMP_CREATE, type: COMMANDS.employeeCreate,
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-emp-cov-1", schemaVersion: "1.0",
      payload: {
        id: EMP_1, tenantId: TENANT, employeeNo: "EMP-COV-001", fullName: "Coverage Employee",
        departmentId: DEPT_1, designationId: DESIG_1, dateOfJoining: "2023-06-01",
        employeeType: "permanent", basicMinor: 3000000, currency: "INR",
      },
    });

    await new Promise<void>((r) => setTimeout(r, WAIT));
    await q.stop();

    const rows = await db.select().from(hrmsEmployees).where(eq(hrmsEmployees.id, EMP_1));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.employeeNo).toBe("EMP-COV-001");
    expect(rows[0]?.fullName).toBe("Coverage Employee");
    expect(rows[0]?.status).toBe("probation");
    expect(rows[0]?.basicMinor).toBe(3_000_000n);

    const proc = await db.select().from(processed).where(eq(processed.messageId, MSG_EMP_CREATE));
    expect(proc).toHaveLength(1);
  });

  it("duplicate messageId is idempotent — not inserted twice", async () => {
    const q = new MemoryQueue();
    registerEmployeeConsumers(q);
    await q.start();

    await q.publish(COMMANDS.employeeCreate, {
      messageId: MSG_EMP_DUP, type: COMMANDS.employeeCreate,
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-emp-dup", schemaVersion: "1.0",
      payload: {
        id: "ffffffff-0000-4000-8000-000000000099", tenantId: TENANT,
        employeeNo: "EMP-COV-DUP", fullName: "Dup Employee",
        departmentId: DEPT_1, designationId: DESIG_1, dateOfJoining: "2023-06-01",
        employeeType: "permanent", basicMinor: 2000000, currency: "INR",
      },
    });

    await new Promise<void>((r) => setTimeout(r, WAIT));
    await q.stop();

    // Only the original EMP_1 should exist, not the dup payload
    const rows = await db.select().from(hrmsEmployees).where(eq(hrmsEmployees.tenantId, TENANT));
    const empNos = rows.map((r) => r.employeeNo);
    expect(empNos).toContain("EMP-COV-001");
    expect(empNos).not.toContain("EMP-COV-DUP");
  });

  it("emits employee.created event to outbox", async () => {
    const outbox = await db.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
    const events = outbox.map((r) => r.eventType);
    expect(events).toContain("hrms.employee.created");
    expect(events).toContain("audit.event.record");
  });

  it("second employee create with new messageId succeeds", async () => {
    const q = new MemoryQueue();
    registerEmployeeConsumers(q);
    await q.start();

    await q.publish(COMMANDS.employeeCreate, {
      messageId: MSG_EMP_CREATE2, type: COMMANDS.employeeCreate,
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-emp-cov-2", schemaVersion: "1.0",
      payload: {
        id: EMP_2, tenantId: TENANT, employeeNo: "EMP-COV-002", fullName: "Second Employee",
        departmentId: DEPT_1, designationId: DESIG_1, dateOfJoining: "2024-01-15",
        employeeType: "permanent", basicMinor: 2500000, currency: "INR",
        mobile: "9876543210", email: "test@gov.in",
      },
    });

    await new Promise<void>((r) => setTimeout(r, WAIT));
    await q.stop();

    const rows = await db.select().from(hrmsEmployees).where(eq(hrmsEmployees.id, EMP_2));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.fullName).toBe("Second Employee");
    expect(rows[0]?.mobile).toBe("9876543210");
  });
});

// ── 2. Leave Allocate Consumer ────────────────────────────────────

describe("Leave allocate consumer — coverage", () => {
  beforeAll(async () => {
    await wipeAll();
    await seedDeptDesig();
    await db.insert(hrmsEmployees).values({
      id: EMP_1, tenantId: TENANT, employeeNo: "EMP-COV-001", fullName: "Coverage Employee",
      departmentId: DEPT_1, designationId: DESIG_1, dateOfJoining: "2023-06-01",
      employeeType: "permanent", status: "confirmed", basicMinor: 3_000_000n,
      createdBy: ACTOR, updatedBy: ACTOR,
    });
    await db.insert(hrmsLeaveTypes).values({
      id: LT_1, tenantId: TENANT, code: "EL", name: "Earned Leave",
      maxDays: 30, isEncashable: true, carryForward: true,
      createdBy: ACTOR, updatedBy: ACTOR,
    });
  });
  afterAll(async () => { await wipeAll(); });

  it("allocates leave with correct totalDays and balanceDays", async () => {
    const q = new MemoryQueue();
    registerLeaveConsumers(q);
    await q.start();

    await q.publish(COMMANDS.leaveAllocate, {
      messageId: MSG_ALLOC, type: COMMANDS.leaveAllocate,
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-alloc-1", schemaVersion: "1.0",
      payload: {
        id: ALLOC_1, tenantId: TENANT, employeeId: EMP_1,
        leaveTypeId: LT_1, fy: "2024-25", totalDays: 24, balanceDays: 24,
      },
    });

    await new Promise<void>((r) => setTimeout(r, WAIT));
    await q.stop();

    const rows = await db.select().from(hrmsLeaveAllocs).where(eq(hrmsLeaveAllocs.id, ALLOC_1));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.totalDays).toBe(24);
    expect(rows[0]?.balanceDays).toBe(24);
    expect(rows[0]?.employeeId).toBe(EMP_1);
  });

  it("duplicate allocate messageId is idempotent", async () => {
    const q = new MemoryQueue();
    registerLeaveConsumers(q);
    await q.start();

    await q.publish(COMMANDS.leaveAllocate, {
      messageId: MSG_ALLOC, type: COMMANDS.leaveAllocate,
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-alloc-dup", schemaVersion: "1.0",
      payload: {
        id: "ffffffff-1111-4000-8000-000000000099", tenantId: TENANT, employeeId: EMP_1,
        leaveTypeId: LT_1, fy: "2024-25", totalDays: 99, balanceDays: 99,
      },
    });

    await new Promise<void>((r) => setTimeout(r, WAIT));
    await q.stop();

    // Only the original allocation row exists
    const rows = await db.select().from(hrmsLeaveAllocs).where(eq(hrmsLeaveAllocs.tenantId, TENANT));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.totalDays).toBe(24);
  });

  it("second allocate with new messageId creates another allocation", async () => {
    const q = new MemoryQueue();
    registerLeaveConsumers(q);
    await q.start();

    await q.publish(COMMANDS.leaveAllocate, {
      messageId: MSG_ALLOC2, type: COMMANDS.leaveAllocate,
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-alloc-2", schemaVersion: "1.0",
      payload: {
        id: ALLOC_2, tenantId: TENANT, employeeId: EMP_1,
        leaveTypeId: LT_1, fy: "2025-26", totalDays: 15, balanceDays: 15,
      },
    });

    await new Promise<void>((r) => setTimeout(r, WAIT));
    await q.stop();

    const rows = await db.select().from(hrmsLeaveAllocs).where(eq(hrmsLeaveAllocs.id, ALLOC_2));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.totalDays).toBe(15);
  });
});

// ── 3. Leave Apply Consumer ───────────────────────────────────────

describe("Leave apply consumer — coverage", () => {
  beforeAll(async () => {
    await wipeAll();
    await seedDeptDesig();
    await db.insert(hrmsEmployees).values({
      id: EMP_1, tenantId: TENANT, employeeNo: "EMP-COV-001", fullName: "Coverage Employee",
      departmentId: DEPT_1, designationId: DESIG_1, dateOfJoining: "2023-06-01",
      employeeType: "permanent", status: "confirmed", basicMinor: 3_000_000n,
      createdBy: ACTOR, updatedBy: ACTOR,
    });
    await db.insert(hrmsLeaveTypes).values({
      id: LT_1, tenantId: TENANT, code: "EL", name: "Earned Leave",
      maxDays: 30, isEncashable: true, carryForward: true,
      createdBy: ACTOR, updatedBy: ACTOR,
    });
    await db.insert(hrmsLeaveAllocs).values({
      id: ALLOC_1, tenantId: TENANT, employeeId: EMP_1, leaveTypeId: LT_1,
      fy: "2024-25", totalDays: 20, balanceDays: 20,
      createdBy: ACTOR, updatedBy: ACTOR,
    });
  });
  afterAll(async () => { await wipeAll(); });

  it("inserts leave application with pending status", async () => {
    const q = new MemoryQueue();
    registerLeaveConsumers(q);
    await q.start();

    await q.publish(COMMANDS.leaveApply, {
      messageId: MSG_APPLY, type: COMMANDS.leaveApply,
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-apply-cov-1", schemaVersion: "1.0",
      payload: {
        id: APP_1, tenantId: TENANT, employeeId: EMP_1, leaveTypeId: LT_1,
        allocId: ALLOC_1, fromDate: "2024-09-02", toDate: "2024-09-04",
        daysApplied: 3, reason: "Family event",
      },
    });

    await new Promise<void>((r) => setTimeout(r, WAIT));
    await q.stop();

    const rows = await db.select().from(hrmsLeaveApps).where(eq(hrmsLeaveApps.id, APP_1));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("pending");
    expect(rows[0]?.daysApplied).toBe(3);
    expect(rows[0]?.employeeId).toBe(EMP_1);
  });

  it("duplicate leave apply messageId is idempotent", async () => {
    const q = new MemoryQueue();
    registerLeaveConsumers(q);
    await q.start();

    await q.publish(COMMANDS.leaveApply, {
      messageId: MSG_APPLY, type: COMMANDS.leaveApply,
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-apply-dup", schemaVersion: "1.0",
      payload: {
        id: "ffffffff-2222-4000-8000-000000000099", tenantId: TENANT, employeeId: EMP_1,
        leaveTypeId: LT_1, allocId: ALLOC_1, fromDate: "2024-10-01", toDate: "2024-10-05",
        daysApplied: 5, reason: "Dup test",
      },
    });

    await new Promise<void>((r) => setTimeout(r, WAIT));
    await q.stop();

    const rows = await db.select().from(hrmsLeaveApps).where(eq(hrmsLeaveApps.tenantId, TENANT));
    expect(rows).toHaveLength(1); // only the original
  });

  it("emits leave.applied event and audit to outbox", async () => {
    const outbox = await db.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
    const events = outbox.map((r) => r.eventType);
    expect(events).toContain("hrms.leave.applied");
    expect(events).toContain("audit.event.record");
  });

  it("second leave apply with new message creates second application", async () => {
    const q = new MemoryQueue();
    registerLeaveConsumers(q);
    await q.start();

    await q.publish(COMMANDS.leaveApply, {
      messageId: MSG_APPLY2, type: COMMANDS.leaveApply,
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-apply-cov-2", schemaVersion: "1.0",
      payload: {
        id: APP_2, tenantId: TENANT, employeeId: EMP_1, leaveTypeId: LT_1,
        allocId: ALLOC_1, fromDate: "2024-11-01", toDate: "2024-11-02",
        daysApplied: 2, reason: "Doctor visit",
      },
    });

    await new Promise<void>((r) => setTimeout(r, WAIT));
    await q.stop();

    const rows = await db.select().from(hrmsLeaveApps).where(eq(hrmsLeaveApps.id, APP_2));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.daysApplied).toBe(2);
  });
});

// ── 4. Leave Approve Consumer ─────────────────────────────────────

describe("Leave approve consumer — coverage", () => {
  beforeAll(async () => {
    await wipeAll();
    await seedDeptDesig();
    await db.insert(hrmsEmployees).values({
      id: EMP_1, tenantId: TENANT, employeeNo: "EMP-COV-001", fullName: "Coverage Employee",
      departmentId: DEPT_1, designationId: DESIG_1, dateOfJoining: "2023-06-01",
      employeeType: "permanent", status: "confirmed", basicMinor: 3_000_000n,
      createdBy: ACTOR, updatedBy: ACTOR,
    });
    await db.insert(hrmsLeaveTypes).values({
      id: LT_1, tenantId: TENANT, code: "EL", name: "Earned Leave",
      maxDays: 30, isEncashable: true, carryForward: true,
      createdBy: ACTOR, updatedBy: ACTOR,
    });
    await db.insert(hrmsLeaveAllocs).values({
      id: ALLOC_1, tenantId: TENANT, employeeId: EMP_1, leaveTypeId: LT_1,
      fy: "2024-25", totalDays: 20, balanceDays: 20,
      createdBy: ACTOR, updatedBy: ACTOR,
    });
    await db.insert(hrmsLeaveApps).values({
      id: APP_1, tenantId: TENANT, employeeId: EMP_1, leaveTypeId: LT_1,
      allocId: ALLOC_1, fromDate: "2024-09-02", toDate: "2024-09-06",
      daysApplied: 5, status: "pending",
      createdBy: ACTOR, updatedBy: ACTOR,
    });
  });
  afterAll(async () => { await wipeAll(); });

  it("approves leave and debits balance", async () => {
    const q = new MemoryQueue();
    registerLeaveConsumers(q);
    await q.start();

    await q.publish(COMMANDS.leaveApprove, {
      messageId: MSG_APPROVE, type: COMMANDS.leaveApprove,
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-approve-cov-1", schemaVersion: "1.0",
      payload: { id: APP_1, tenantId: TENANT, approvedBy: ACTOR },
    });

    await new Promise<void>((r) => setTimeout(r, WAIT));
    await q.stop();

    const apps = await db.select().from(hrmsLeaveApps).where(eq(hrmsLeaveApps.id, APP_1));
    expect(apps[0]?.status).toBe("approved");
    expect(apps[0]?.approvedBy).toBe(ACTOR);

    const allocs = await db.select().from(hrmsLeaveAllocs).where(eq(hrmsLeaveAllocs.id, ALLOC_1));
    expect(allocs[0]?.balanceDays).toBe(15); // 20 - 5
  });

  it("emits leave.approved event to outbox", async () => {
    const outbox = await db.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
    const events = outbox.map((r) => r.eventType);
    expect(events).toContain("hrms.leave.approved");
    expect(events).toContain("audit.event.record");
  });

  it("duplicate approve messageId is idempotent — balance not debited again", async () => {
    const q = new MemoryQueue();
    registerLeaveConsumers(q);
    await q.start();

    await q.publish(COMMANDS.leaveApprove, {
      messageId: MSG_APPROVE, type: COMMANDS.leaveApprove,
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-approve-dup", schemaVersion: "1.0",
      payload: { id: APP_1, tenantId: TENANT, approvedBy: ACTOR },
    });

    await new Promise<void>((r) => setTimeout(r, WAIT));
    await q.stop();

    const allocs = await db.select().from(hrmsLeaveAllocs).where(eq(hrmsLeaveAllocs.id, ALLOC_1));
    expect(allocs[0]?.balanceDays).toBe(15); // still 15, not 10
  });
});

// ── 5. Attendance Mark Consumer ───────────────────────────────────

describe("Attendance mark consumer — coverage", () => {
  beforeAll(async () => {
    await wipeAll();
    await seedDeptDesig();
    await db.insert(hrmsEmployees).values({
      id: EMP_1, tenantId: TENANT, employeeNo: "EMP-COV-001", fullName: "Coverage Employee",
      departmentId: DEPT_1, designationId: DESIG_1, dateOfJoining: "2023-06-01",
      employeeType: "permanent", status: "confirmed", basicMinor: 3_000_000n,
      createdBy: ACTOR, updatedBy: ACTOR,
    });
  });
  afterAll(async () => { await wipeAll(); });

  it("marks single attendance record", async () => {
    const q = new MemoryQueue();
    registerAttendanceConsumers(q);
    await q.start();

    await q.publish(COMMANDS.attendanceMark, {
      messageId: MSG_ATTEND, type: COMMANDS.attendanceMark,
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-attend-cov-1", schemaVersion: "1.0",
      payload: {
        batchId: "batch-cov-001", tenantId: TENANT,
        records: [{ employeeId: EMP_1, attendanceDate: "2024-09-02", status: "present", inTime: "09:00", outTime: "17:30" }],
      },
    });

    await new Promise<void>((r) => setTimeout(r, WAIT));
    await q.stop();

    const rows = await db.select().from(hrmsAttendance)
      .where(and(eq(hrmsAttendance.tenantId, TENANT), eq(hrmsAttendance.employeeId, EMP_1)));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("present");
    expect(rows[0]?.attendanceDate).toBe("2024-09-02");
  });

  it("duplicate attendance messageId is idempotent", async () => {
    const q = new MemoryQueue();
    registerAttendanceConsumers(q);
    await q.start();

    await q.publish(COMMANDS.attendanceMark, {
      messageId: MSG_ATTEND_DUP, type: COMMANDS.attendanceMark,
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-attend-dup", schemaVersion: "1.0",
      payload: {
        batchId: "batch-cov-dup", tenantId: TENANT,
        records: [{ employeeId: EMP_1, attendanceDate: "2024-09-03", status: "absent" }],
      },
    });

    await new Promise<void>((r) => setTimeout(r, WAIT));
    await q.stop();

    // No new row for 2024-09-03 since messageId was already processed
    const rows = await db.select().from(hrmsAttendance)
      .where(and(eq(hrmsAttendance.tenantId, TENANT), eq(hrmsAttendance.employeeId, EMP_1)));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.attendanceDate).toBe("2024-09-02");
  });

  it("marks multiple attendance records in one batch", async () => {
    const q = new MemoryQueue();
    registerAttendanceConsumers(q);
    await q.start();

    await q.publish(COMMANDS.attendanceMark, {
      messageId: MSG_ATTEND2, type: COMMANDS.attendanceMark,
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-attend-cov-2", schemaVersion: "1.0",
      payload: {
        batchId: "batch-cov-002", tenantId: TENANT,
        records: [
          { employeeId: EMP_1, attendanceDate: "2024-09-03", status: "present", inTime: "09:15", outTime: "17:00", lateMins: 15 },
          { employeeId: EMP_1, attendanceDate: "2024-09-04", status: "half_day", source: "biometric" },
        ],
      },
    });

    await new Promise<void>((r) => setTimeout(r, WAIT));
    await q.stop();

    const rows = await db.select().from(hrmsAttendance)
      .where(and(eq(hrmsAttendance.tenantId, TENANT), eq(hrmsAttendance.employeeId, EMP_1)));
    // Original (09-02) + two new (09-03, 09-04). The original 09-02 from the upsert
    // may get updated by the prior test's idempotent replay, so we just check >= 2 new.
    expect(rows.length).toBeGreaterThanOrEqual(3);
    const dates = rows.map((r) => r.attendanceDate);
    expect(dates).toContain("2024-09-03");
    expect(dates).toContain("2024-09-04");
  });

  it("attendance record includes source field", async () => {
    const rows = await db.select().from(hrmsAttendance)
      .where(and(eq(hrmsAttendance.tenantId, TENANT), eq(hrmsAttendance.attendanceDate, "2024-09-04")));
    expect(rows[0]?.source).toBe("biometric");
  });

  it("attendance emits audit event to outbox", async () => {
    const outbox = await db.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
    const events = outbox.map((r) => r.eventType);
    expect(events).toContain("hrms.attendance.marked");
    expect(events).toContain("audit.event.record");
  });
});

// ── 6. Employee Update Consumer ───────────────────────────────────

describe("Employee update consumer — coverage", () => {
  const MSG_UPDATE = "fff00001-0000-4000-8000-000000000099";
  const MSG_UPDATE2 = "fff00002-0000-4000-8000-000000000099";

  beforeAll(async () => {
    await wipeAll();
    await seedDeptDesig();
    await db.insert(hrmsEmployees).values({
      id: EMP_1, tenantId: TENANT, employeeNo: "EMP-COV-001", fullName: "Coverage Employee",
      departmentId: DEPT_1, designationId: DESIG_1, dateOfJoining: "2023-06-01",
      employeeType: "permanent", status: "confirmed", basicMinor: 3_000_000n,
      createdBy: ACTOR, updatedBy: ACTOR,
    });
    await db.delete(processed).where(eq(processed.messageId, MSG_UPDATE));
    await db.delete(processed).where(eq(processed.messageId, MSG_UPDATE2));
  });
  afterAll(async () => {
    await wipeAll();
    await db.delete(processed).where(eq(processed.messageId, MSG_UPDATE));
    await db.delete(processed).where(eq(processed.messageId, MSG_UPDATE2));
    await sqlClient.end();
  });

  it("updates employee mobile and email", async () => {
    const q = new MemoryQueue();
    registerEmployeeConsumers(q);
    await q.start();

    await q.publish(COMMANDS.employeeUpdate, {
      messageId: MSG_UPDATE, type: COMMANDS.employeeUpdate,
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-update-1", schemaVersion: "1.0",
      payload: { id: EMP_1, tenantId: TENANT, mobile: "9999900000", email: "updated@gov.in" },
    });

    await new Promise<void>((r) => setTimeout(r, WAIT));
    await q.stop();

    const rows = await db.select().from(hrmsEmployees).where(eq(hrmsEmployees.id, EMP_1));
    expect(rows[0]?.mobile).toBe("9999900000");
    expect(rows[0]?.email).toBe("updated@gov.in");
  });

  it("updates employee basicMinor", async () => {
    const q = new MemoryQueue();
    registerEmployeeConsumers(q);
    await q.start();

    await q.publish(COMMANDS.employeeUpdate, {
      messageId: MSG_UPDATE2, type: COMMANDS.employeeUpdate,
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-update-2", schemaVersion: "1.0",
      payload: { id: EMP_1, tenantId: TENANT, basicMinor: "4500000" },
    });

    await new Promise<void>((r) => setTimeout(r, WAIT));
    await q.stop();

    const rows = await db.select().from(hrmsEmployees).where(eq(hrmsEmployees.id, EMP_1));
    expect(rows[0]?.basicMinor).toBe(4_500_000n);
  });
});
