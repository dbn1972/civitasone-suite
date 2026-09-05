/**
 * hrms-service leave module nested-transaction connection-pool deadlock
 * regression. Found via .claude/skills/16-production-readiness-audit.md
 * section 1: leaveApprove/leaveReject (leave/consumer.ts) called
 * scopedRead-based repo.findLeaveAppById from INSIDE their own already-open
 * outer db.transaction() -- a second transaction competing for a
 * connection from the same pool as the outer one, deadlocking every
 * in-flight command once concurrency reaches pool.max. Same shape as
 * notification-service (#1028), building-service (#1035), payroll-service
 * (#1042), finance-service (#1043), hrms-service's own contracts module
 * (#1045).
 *
 * Fixed by routing leaveApply/leaveApprove/leaveReject onto
 * findAllocByIdTx/findLeaveAppByIdTx, reading through the caller's
 * already-open tx. This test exercises leaveApprove (the handler with the
 * most additional work inside its transaction -- balance debit, attendance
 * sync, notification -- so it's the most representative, not the simplest)
 * at pool.max + concurrency, real Postgres, real pool.
 */
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant, withTenantScope } from "@civitasone/db";
import { db } from "../src/shared/db.js";
import { registerLeaveConsumers } from "../src/modules/leave/consumer.js";
import { hrmsLeaveApps, hrmsLeaveAllocs } from "../src/modules/leave/schema.js";
import { hrmsEmployees } from "../src/modules/employee/schema.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "b0000000-dead-4000-8000-00000000c0de";
const ACTOR = "b0000000-dead-4000-8000-0000000ac70a";
const APPROVER = "b0000000-dead-4000-8000-0000000ac70b";
const CONCURRENCY = 13; // pool.max (10) + 3

function makeMsg(type: string, payload: Record<string, unknown>) {
  return { messageId: randomUUID(), type, tenantId: TENANT, actorId: APPROVER, correlationId: randomUUID(), schemaVersion: "1.0", payload };
}

async function seedPendingLeaveApp(): Promise<string> {
  const allocId = randomUUID();
  const appId = randomUUID();
  const employeeId = randomUUID();
  await withTenantScope(db, TENANT, (tx: any) => tx.insert(hrmsEmployees).values({
    id: employeeId, tenantId: TENANT, employeeNo: `TEST-${employeeId.slice(0, 8)}`,
    fullName: "Test Employee", departmentId: randomUUID(), designationId: randomUUID(),
    dateOfJoining: "2020-01-01", createdBy: ACTOR, updatedBy: ACTOR,
  }));
  await withTenantScope(db, TENANT, (tx: any) => tx.insert(hrmsLeaveAllocs).values({
    id: allocId, tenantId: TENANT, employeeId, leaveTypeId: randomUUID(), fy: "2026-27",
    totalDays: 12, balanceDays: 10, createdBy: ACTOR, updatedBy: ACTOR,
  }));
  await withTenantScope(db, TENANT, (tx: any) => tx.insert(hrmsLeaveApps).values({
    id: appId, tenantId: TENANT, employeeId, leaveTypeId: randomUUID(), allocId,
    fromDate: "2026-11-02", toDate: "2026-11-02", daysApplied: 1, status: "pending",
    createdBy: ACTOR, updatedBy: ACTOR,
  }));
  return appId;
}

describe("leave consumer -- nested-transaction pool-exhaustion deadlock (real DB, no mocks)", () => {
  it(
    `${CONCURRENCY} concurrent leaveApprove commands drain without deadlocking the connection pool`,
    async () => {
      const appIds: string[] = [];
      for (let i = 0; i < CONCURRENCY; i++) {
        appIds.push(await seedPendingLeaveApp());
      }

      const q = new MemoryQueue();
      registerLeaveConsumers(q);
      await q.start();

      await Promise.all(appIds.map((id) =>
        q.publish(COMMANDS.leaveApprove, makeMsg(COMMANDS.leaveApprove, { id, tenantId: TENANT, approvedBy: APPROVER })),
      ));

      // The bug's failure mode is queue.drain() never resolving (every
      // in-flight transaction blocked on an unavailable connection
      // forever), so the proof this test needs is that drain() resolves at
      // all within a generous-but-bounded window.
      const DRAIN_TIMEOUT_MS = 10_000;
      let timedOut = false;
      await Promise.race([
        q.drain(),
        new Promise<void>((resolve) => setTimeout(() => { timedOut = true; resolve(); }, DRAIN_TIMEOUT_MS)),
      ]);

      expect(timedOut, `queue did not drain within ${DRAIN_TIMEOUT_MS}ms -- nested-transaction pool deadlock regressed`).toBe(false);

      await q.stop();
    },
    { timeout: 20_000 },
  );
});
