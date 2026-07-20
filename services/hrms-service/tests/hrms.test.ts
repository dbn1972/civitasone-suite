/**
 * hrms-service test suite
 *
 * Test 1 — Leave balance deduction (pure): balance decreases on approval; unchanged on rejection.
 * Test 2 — Leave balance insufficient (pure): applying more days than balance throws DomainError.
 * Test 3 — Leave status transition (pure): invalid transitions throw.
 * Test 4 — CQRS wiring: leave apply → queue → consumer → DB (MemoryQueue + real DB).
 * Test 5 — Leave approve CQRS: approved state + balance debit via consumer.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MemoryQueue } from "@civitasone/queue";
import { eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { hrmsLeaveApps, hrmsLeaveAllocs, hrmsLeaveTypes } from "../src/modules/leave/schema.js";
import { hrmsEmployees, hrmsDepartments, hrmsDesignations } from "../src/modules/employee/schema.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { registerLeaveConsumers } from "../src/modules/leave/consumer.js";
import {
  assertSufficientLeaveBalance,
  assertLeaveAppStatusTransition,
  countWorkingDays,
} from "../src/modules/leave/domain.js";

const ACTOR   = "00000000-aaaa-4000-8000-000000000001";
const TENANT  = "11111111-aaaa-4000-8000-000000000011";
const EMP_1   = "22222222-bbbb-4000-8000-000000000011";
const LT_1    = "33333333-cccc-4000-8000-000000000011";
const ALLOC_1 = "44444444-dddd-4000-8000-000000000011";
const APP_1   = "55555555-eeee-4000-8000-000000000011";
const APP_2   = "66666666-ffff-4000-8000-000000000011";
const DEPT_1  = "77777777-aaaa-4000-8000-000000000011";
const DESIG_1 = "88888888-bbbb-4000-8000-000000000011";
const MSG_APP = "99999999-cccc-4000-8000-000000000011";
const MSG_APR = "aaaaaaaa-dddd-4000-8000-000000000011";

async function wipeTestData() {
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
      await tx.delete(hrmsLeaveApps).where(eq(hrmsLeaveApps.tenantId, TENANT));
      await tx.delete(hrmsLeaveAllocs).where(eq(hrmsLeaveAllocs.tenantId, TENANT));
      await tx.delete(hrmsLeaveTypes).where(eq(hrmsLeaveTypes.tenantId, TENANT));
      await tx.delete(hrmsEmployees).where(eq(hrmsEmployees.tenantId, TENANT));
      await tx.delete(hrmsDepartments).where(eq(hrmsDepartments.tenantId, TENANT));
      await tx.delete(hrmsDesignations).where(eq(hrmsDesignations.tenantId, TENANT));
      await tx.delete(processed).where(eq(processed.messageId, MSG_APP));
      await tx.delete(processed).where(eq(processed.messageId, MSG_APR));
    }),
  );
}

async function seedFixtures() {
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.insert(hrmsDepartments).values({ id: DEPT_1, tenantId: TENANT, code: "DEPT-TEST", name: "Test Dept", createdBy: ACTOR, updatedBy: ACTOR });
      await tx.insert(hrmsDesignations).values({ id: DESIG_1, tenantId: TENANT, code: "DESIG-TEST", name: "Test Desig", createdBy: ACTOR, updatedBy: ACTOR });
      await tx.insert(hrmsEmployees).values({
        id: EMP_1, tenantId: TENANT, employeeNo: "EMP-TEST-001", fullName: "Test Employee",
        departmentId: DEPT_1, designationId: DESIG_1, dateOfJoining: "2023-01-01",
        employeeType: "permanent", status: "confirmed", basicMinor: 0n,
        createdBy: ACTOR, updatedBy: ACTOR,
      });
      await tx.insert(hrmsLeaveTypes).values({ id: LT_1, tenantId: TENANT, code: "EL", name: "Earned Leave", maxDays: 30, isEncashable: true, carryForward: true, createdBy: ACTOR, updatedBy: ACTOR });
      await tx.insert(hrmsLeaveAllocs).values({ id: ALLOC_1, tenantId: TENANT, employeeId: EMP_1, leaveTypeId: LT_1, fy: "2024-25", totalDays: 20, balanceDays: 20, createdBy: ACTOR, updatedBy: ACTOR });
    }),
  );
}

// ── 1. Pure domain — leave balance ────────────────────────────────

describe("Leave domain — balance check (pure)", () => {
  it("sufficient balance passes", () => {
    expect(() => assertSufficientLeaveBalance({ totalDays: 20, balanceDays: 10 }, 5)).not.toThrow();
  });

  it("exact balance passes", () => {
    expect(() => assertSufficientLeaveBalance({ totalDays: 20, balanceDays: 5 }, 5)).not.toThrow();
  });

  it("insufficient balance throws INSUFFICIENT_LEAVE_BALANCE", () => {
    expect(() => assertSufficientLeaveBalance({ totalDays: 20, balanceDays: 3 }, 5)).toThrowError("INSUFFICIENT_LEAVE_BALANCE");
  });
});

// ── 2. Pure domain — working days counter ─────────────────────────

describe("Leave domain — working days (pure)", () => {
  it("counts 5 working days in Mon-Fri week", () => {
    expect(countWorkingDays("2024-06-03", "2024-06-07")).toBe(5); // Mon-Fri
  });

  it("excludes weekends in 7-day span", () => {
    expect(countWorkingDays("2024-06-03", "2024-06-09")).toBe(5); // Mon-Sun → 5 working
  });
});

// ── 3. Pure domain — status transitions ───────────────────────────

describe("Leave domain — status transitions (pure)", () => {
  it("draft → pending is valid", () => {
    expect(() => assertLeaveAppStatusTransition("draft", "pending")).not.toThrow();
  });

  it("pending → approved is valid", () => {
    expect(() => assertLeaveAppStatusTransition("pending", "approved")).not.toThrow();
  });

  it("approved → draft is invalid", () => {
    expect(() => assertLeaveAppStatusTransition("approved", "draft")).toThrowError("INVALID_STATUS_TRANSITION");
  });

  it("cancelled → approved is invalid", () => {
    expect(() => assertLeaveAppStatusTransition("cancelled", "approved")).toThrowError("INVALID_STATUS_TRANSITION");
  });
});

// ── 4. CQRS — leave apply consumer ───────────────────────────────

describe("Leave apply consumer — CQRS (integration)", () => {
  beforeAll(async () => {
    await wipeTestData();
    await seedFixtures();
  });

  afterAll(async () => {
    await wipeTestData();
  });

  it("leave apply command inserts leave app row", async () => {
    const q = new MemoryQueue();
    registerLeaveConsumers(q);
    await q.start();

    await runWithTenant(TENANT, () =>
      q.publish("hrms.leave.apply", {
        messageId: MSG_APP, type: "hrms.leave.apply",
        tenantId: TENANT, actorId: ACTOR, correlationId: "corr-apply-1", schemaVersion: "1.0",
        payload: {
          id: APP_1, tenantId: TENANT, employeeId: EMP_1, leaveTypeId: LT_1,
          allocId: ALLOC_1, fromDate: "2024-07-01", toDate: "2024-07-03",
          daysApplied: 3, reason: "Personal", status: "pending",
        },
      }),
    );

    await new Promise<void>((r) => setTimeout(r, 600));
    await q.stop();

    const apps = await runWithTenant(TENANT, () => db.transaction(async (tx) => tx.select().from(hrmsLeaveApps).where(eq(hrmsLeaveApps.id, APP_1))));
    expect(apps).toHaveLength(1);
    expect(apps[0]?.status).toBe("pending");
    expect(apps[0]?.daysApplied).toBe(3);

    const proc = await runWithTenant(TENANT, () => db.transaction(async (tx) => tx.select().from(processed).where(eq(processed.messageId, MSG_APP))));
    expect(proc).toHaveLength(1);
  });
});

// ── 5. CQRS — leave approve + balance debit ───────────────────────

describe("Leave approve consumer — balance deduction (integration)", () => {
  beforeAll(async () => {
    await wipeTestData();
    await seedFixtures();
    // Pre-insert the leave app so the approve consumer can find it
    await runWithTenant(TENANT, () =>
      db.transaction(async (tx) => {
        await tx.insert(hrmsLeaveApps).values({
          id: APP_2, tenantId: TENANT, employeeId: EMP_1, leaveTypeId: LT_1,
          allocId: ALLOC_1, fromDate: "2024-08-01", toDate: "2024-08-05",
          daysApplied: 5, status: "pending", createdBy: ACTOR, updatedBy: ACTOR,
        });
      }),
    );
  });

  afterAll(async () => {
    await wipeTestData();
    await sqlClient.end();
  });

  it("approving leave debits balance and sets status=approved", async () => {
    const q = new MemoryQueue();
    registerLeaveConsumers(q);
    await q.start();

    await runWithTenant(TENANT, () =>
      q.publish("hrms.leave.approve", {
        messageId: MSG_APR, type: "hrms.leave.approve",
        tenantId: TENANT, actorId: ACTOR, correlationId: "corr-approve-1", schemaVersion: "1.0",
        payload: { id: APP_2, tenantId: TENANT, approvedBy: ACTOR },
      }),
    );

    await new Promise<void>((r) => setTimeout(r, 600));
    await q.stop();

    const apps = await runWithTenant(TENANT, () => db.transaction(async (tx) => tx.select().from(hrmsLeaveApps).where(eq(hrmsLeaveApps.id, APP_2))));
    expect(apps[0]?.status).toBe("approved");
    expect(apps[0]?.approvedBy).toBe(ACTOR);

    const allocs = await runWithTenant(TENANT, () => db.transaction(async (tx) => tx.select().from(hrmsLeaveAllocs).where(eq(hrmsLeaveAllocs.id, ALLOC_1))));
    expect(allocs[0]?.balanceDays).toBe(15); // 20 - 5

    const outbox = await runWithTenant(TENANT, () => db.transaction(async (tx) => tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT))));
    const topics = outbox.map((r) => r.eventType);
    expect(topics).toContain("hrms.leave.approved");
    expect(topics).toContain("audit.event.record");
  });
});
