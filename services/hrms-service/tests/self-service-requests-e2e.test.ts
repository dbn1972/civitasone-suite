/**
 * WAVE-4 gap closure — real-DB integration tests for the two attendance
 * self-service request types that had no backend routes at all before this
 * PR: WFH requests (POST/PATCH .../wfh-requests) and shift-change requests
 * (POST/PATCH .../shift-requests). Exercises the full route -> F3 publish ->
 * f3-consumer.ts write path against a real Postgres, the same pattern
 * geo-attendance-e2e.test.ts uses for its module's F3 writes: register only
 * this module's F3 consumer, drain the queue after each write that needs to
 * land before the next assertion, and read committed rows back through a
 * tenant-scoped transaction (both tables are FORCE ROW LEVEL SECURITY — see
 * migration 0138_sec010_missing_rls.sql — so a bare db.select() would fail
 * closed to zero rows; runWithTenant + db.transaction is required, same as
 * routes.ts's own scopedRead).
 *
 * Deliberately covers the same scenarios for BOTH request types:
 *  - successful create (row lands with status='pending')
 *  - the actor who filed a request cannot decide it themselves, even holding
 *    an approver-capable role (manager) -- no existing precedent in this
 *    module checks this at all; overtime-requests does not either.
 *  - a manager (a different actor) can approve, and can reject
 *  - an already-decided request cannot be silently re-decided -- checked at
 *    BOTH layers: the route's synchronous pre-check (404s before publishing)
 *    and the consumer's atomic `WHERE status='pending'` guard on the UPDATE
 *    (proven by publishing directly to the queue, bypassing the route's own
 *    pre-check entirely). This guards against the gap overtime-requests'
 *    own approve/reject consumer cases (attendance_routes__3/__4) currently
 *    have: those UPDATEs carry no status='pending' condition at all, so a
 *    second decide there would silently flip an already-decided OT request.
 *    WFH/shift-change use the regularisation consumer's guard pattern
 *    instead of copying that gap forward (see f3-consumer.ts).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import type { MemoryQueue } from "@civitasone/queue";
import { buildApp } from "../src/app.js";
import { queue } from "../src/shared/infra.js";
import { db } from "../src/shared/db.js";
import { hrmsEmployees } from "../src/modules/employee/schema.js";
import { hrmsWfhRequests, hrmsShiftChangeRequests } from "../src/modules/attendance/schema.js";
import { registerF3_attendance_Consumers } from "../src/modules/attendance/f3-consumer.js";
import { COMMANDS } from "../src/topics.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

// Only this module's F3 consumer is registered (mirrors geo-attendance-e2e.test.ts) --
// without it, the routes' publishF3Write would answer 202 and nothing would
// ever be persisted, and this suite could not tell a working write from one
// that throws inside the consumer.
registerF3_attendance_Consumers(queue);

async function drainF3(): Promise<void> {
  await (queue as unknown as MemoryQueue).drain();
}

function authHeader(sub: string, tid: string, roles: string[]): { authorization: string } {
  const token = signToken({ sub, tid, roles, sid: "s" }, SECRET);
  return { authorization: `Bearer ${token}` };
}

interface SeededPair {
  tenantId: string;
  requesterId: string;  // hrms_employees.id of the employee who files the request
  managerId: string;    // hrms_employees.id of a different employee who decides it
  requesterSub: string; // requester's JWT subject (login id), linked via user_ref
  managerSub: string;   // manager's JWT subject (login id), linked via user_ref
}

async function seedRequesterAndManager(): Promise<SeededPair> {
  const tenantId = randomUUID();
  const requesterId = randomUUID();
  const managerId = randomUUID();
  // The JWT subject (login/account id) and hrms_employees.id are separate id
  // spaces, linked only through hrms_employees.user_ref (employee/actor-link.ts
  // resolveEmployeeForActor). Since #1649 (GAP-HR-SF-10) the self-service
  // create guard and the self-approval guard resolve the caller through that
  // link, and since #1651/#1739 a manager's scope is self + direct reports of
  // the LINKED employee row. A caller with no linked row is correctly denied
  // (403), so each actor gets its own distinct sub plus a user_ref link.
  const requesterSub = randomUUID();
  const managerSub = randomUUID();
  const systemActorId = randomUUID();
  await runWithTenant(tenantId, () => db.transaction(async (tx) => {
    await tx.insert(hrmsEmployees).values({
      id: requesterId, tenantId,
      employeeNo: `REQ-${requesterId.slice(0, 8)}`,
      fullName: "Requester Employee",
      departmentId: randomUUID(), designationId: randomUUID(),
      dateOfJoining: "2020-01-01", status: "confirmed",
      // GAP-HR-SF-16: linked to managerId below so the GET self-scoping test
      // exercises a REAL reporting relationship -- a manager's list is now
      // scoped to self + direct reports, not the whole tenant, so this link
      // must exist for that test to mean anything.
      managerId,
      userRef: requesterSub,
      createdBy: systemActorId, updatedBy: systemActorId,
    });
    await tx.insert(hrmsEmployees).values({
      id: managerId, tenantId,
      employeeNo: `MGR-${managerId.slice(0, 8)}`,
      fullName: "Manager Employee",
      departmentId: randomUUID(), designationId: randomUUID(),
      dateOfJoining: "2018-01-01", status: "confirmed",
      userRef: managerSub,
      createdBy: systemActorId, updatedBy: systemActorId,
    });
  }));
  return { tenantId, requesterId, managerId, requesterSub, managerSub };
}

/** hrms_employees FK is ON DELETE CASCADE on both request tables (migration
 * 0107_wfh_shift_tables.sql), so deleting the seeded employees cleans up any
 * requests filed against them too -- same convention as
 * f3-consumer.test.ts's cleanupEmployee. */
async function cleanup(tenantId: string, employeeIds: string[]): Promise<void> {
  await runWithTenant(tenantId, () => db.transaction(async (tx) => {
    for (const id of employeeIds) {
      await tx.delete(hrmsEmployees).where(eq(hrmsEmployees.id, id));
    }
  }));
}

async function getWfhRequest(tenantId: string, id: string) {
  return runWithTenant(tenantId, () => db.transaction(async (tx) => {
    const [row] = await tx.select().from(hrmsWfhRequests).where(eq(hrmsWfhRequests.id, id));
    return row;
  }));
}

async function getShiftChangeRequest(tenantId: string, id: string) {
  return runWithTenant(tenantId, () => db.transaction(async (tx) => {
    const [row] = await tx.select().from(hrmsShiftChangeRequests).where(eq(hrmsShiftChangeRequests.id, id));
    return row;
  }));
}

let app: FastifyInstance;
beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); });

describe("WFH requests — end-to-end (real DB)", () => {
  it("202 create: employee can file their own WFH request, row lands pending", async () => {
    const { tenantId, requesterId, managerId, requesterSub, managerSub } = await seedRequesterAndManager();
    try {
      const create = await app.inject({
        method: "POST", url: "/v1/hrms/wfh-requests",
        headers: { ...authHeader(requesterSub, tenantId, ["employee"]), "content-type": "application/json" },
        payload: { employeeId: requesterId, fromDate: "2026-10-05", toDate: "2026-10-06", reason: "Family care" },
      });
      expect(create.statusCode).toBe(202);
      const id = create.json().id as string;
      await drainF3();

      const row = await getWfhRequest(tenantId, id);
      expect(row?.status).toBe("pending");
      expect(row?.employeeId).toBe(requesterId);
      expect(row?.fromDate).toBe("2026-10-05");
      expect(row?.toDate).toBe("2026-10-06");
    } finally {
      await cleanup(tenantId, [requesterId, managerId]);
    }
  });

  it("403: the requester cannot approve their own WFH request, even holding the manager role", async () => {
    const { tenantId, requesterId, managerId, requesterSub, managerSub } = await seedRequesterAndManager();
    try {
      const create = await app.inject({
        method: "POST", url: "/v1/hrms/wfh-requests",
        headers: { ...authHeader(requesterSub, tenantId, ["employee"]), "content-type": "application/json" },
        payload: { employeeId: requesterId, fromDate: "2026-10-05", toDate: "2026-10-06" },
      });
      const id = create.json().id as string;
      await drainF3();

      const selfApprove = await app.inject({
        method: "PATCH", url: `/v1/hrms/wfh-requests/${id}/approve`,
        headers: authHeader(requesterSub, tenantId, ["manager"]), // same person, approver-capable role
      });
      expect(selfApprove.statusCode).toBe(403);

      const row = await getWfhRequest(tenantId, id);
      expect(row?.status).toBe("pending");
    } finally {
      await cleanup(tenantId, [requesterId, managerId]);
    }
  });

  it("202: a different manager can approve a pending WFH request", async () => {
    const { tenantId, requesterId, managerId, requesterSub, managerSub } = await seedRequesterAndManager();
    try {
      const create = await app.inject({
        method: "POST", url: "/v1/hrms/wfh-requests",
        headers: { ...authHeader(requesterSub, tenantId, ["employee"]), "content-type": "application/json" },
        payload: { employeeId: requesterId, fromDate: "2026-10-05", toDate: "2026-10-06" },
      });
      const id = create.json().id as string;
      await drainF3();

      const approve = await app.inject({
        method: "PATCH", url: `/v1/hrms/wfh-requests/${id}/approve`,
        headers: authHeader(managerSub, tenantId, ["manager"]),
      });
      expect(approve.statusCode).toBe(202);
      await drainF3();

      const row = await getWfhRequest(tenantId, id);
      expect(row?.status).toBe("approved");
      expect(row?.approvedBy).toBe(managerId);
    } finally {
      await cleanup(tenantId, [requesterId, managerId]);
    }
  });

  it("202: an hr_admin with NO linked employee row can approve; approved_by is NULL, the actor stays in updated_by", async () => {
    // approved_by REFERENCES hrms_employees(id) (migration 0107), so the
    // consumer stores the approver's linked EMPLOYEE id there, never the raw
    // JWT sub. An HR approver who is not on the employee roll has no such id:
    // the approval must still land, with approved_by NULL and the acting
    // login preserved in updated_by.
    const { tenantId, requesterId, managerId, requesterSub } = await seedRequesterAndManager();
    const hrSub = randomUUID(); // deliberately NOT linked to any hrms_employees row
    try {
      const create = await app.inject({
        method: "POST", url: "/v1/hrms/wfh-requests",
        headers: { ...authHeader(requesterSub, tenantId, ["employee"]), "content-type": "application/json" },
        payload: { employeeId: requesterId, fromDate: "2026-10-05", toDate: "2026-10-06" },
      });
      expect(create.statusCode).toBe(202);
      const id = create.json().id as string;
      await drainF3();

      const approve = await app.inject({
        method: "PATCH", url: `/v1/hrms/wfh-requests/${id}/approve`,
        headers: authHeader(hrSub, tenantId, ["hr_admin"]),
      });
      expect(approve.statusCode).toBe(202);
      await drainF3();

      const row = await getWfhRequest(tenantId, id);
      expect(row?.status).toBe("approved");
      expect(row?.approvedBy).toBeNull();
      expect(row?.updatedBy).toBe(hrSub);
    } finally {
      await cleanup(tenantId, [requesterId, managerId]);
    }
  });

  it("202: a different manager can reject a pending WFH request", async () => {
    const { tenantId, requesterId, managerId, requesterSub, managerSub } = await seedRequesterAndManager();
    try {
      const create = await app.inject({
        method: "POST", url: "/v1/hrms/wfh-requests",
        headers: { ...authHeader(requesterSub, tenantId, ["employee"]), "content-type": "application/json" },
        payload: { employeeId: requesterId, fromDate: "2026-10-05", toDate: "2026-10-06" },
      });
      const id = create.json().id as string;
      await drainF3();

      const reject = await app.inject({
        method: "PATCH", url: `/v1/hrms/wfh-requests/${id}/reject`,
        headers: { ...authHeader(managerSub, tenantId, ["manager"]), "content-type": "application/json" },
        payload: { reason: "Coverage conflict" },
      });
      expect(reject.statusCode).toBe(202);
      await drainF3();

      const row = await getWfhRequest(tenantId, id);
      expect(row?.status).toBe("rejected");
      expect(row?.rejectionReason).toBe("Coverage conflict");
    } finally {
      await cleanup(tenantId, [requesterId, managerId]);
    }
  });

  it("404: an already-approved WFH request cannot later be rejected (route-level guard)", async () => {
    const { tenantId, requesterId, managerId, requesterSub, managerSub } = await seedRequesterAndManager();
    try {
      const create = await app.inject({
        method: "POST", url: "/v1/hrms/wfh-requests",
        headers: { ...authHeader(requesterSub, tenantId, ["employee"]), "content-type": "application/json" },
        payload: { employeeId: requesterId, fromDate: "2026-10-05", toDate: "2026-10-06" },
      });
      const id = create.json().id as string;
      await drainF3();

      const approve = await app.inject({
        method: "PATCH", url: `/v1/hrms/wfh-requests/${id}/approve`,
        headers: authHeader(managerSub, tenantId, ["manager"]),
      });
      expect(approve.statusCode).toBe(202);
      await drainF3();

      const reject = await app.inject({
        method: "PATCH", url: `/v1/hrms/wfh-requests/${id}/reject`,
        headers: authHeader(managerSub, tenantId, ["manager"]),
      });
      expect(reject.statusCode).toBe(404);

      const row = await getWfhRequest(tenantId, id);
      expect(row?.status).toBe("approved"); // NOT flipped to rejected
    } finally {
      await cleanup(tenantId, [requesterId, managerId]);
    }
  });

  it("consumer-level guard: a reject published directly at an already-approved row does not flip its status (bypasses the route's own pre-check entirely)", async () => {
    const { tenantId, requesterId, managerId, requesterSub, managerSub } = await seedRequesterAndManager();
    try {
      const reqId = randomUUID();
      await runWithTenant(tenantId, () => db.transaction(async (tx) => {
        await tx.insert(hrmsWfhRequests).values({
          id: reqId, tenantId, employeeId: requesterId,
          fromDate: "2026-10-05", toDate: "2026-10-06",
          status: "approved", approvedBy: managerId, approvedAt: new Date(),
          createdBy: requesterId, updatedBy: requesterId,
        });
      }));

      await queue.publish(COMMANDS.f3RouteWrite, {
        messageId: randomUUID(), type: COMMANDS.f3RouteWrite,
        tenantId, actorId: managerId, correlationId: randomUUID(), schemaVersion: "1.0",
        payload: {
          op: "attendance_routes__7", id: reqId, tenantId,
          body: { reason: "trying to flip it" }, params: { id: reqId }, query: {},
        },
      });
      await drainF3();

      const row = await getWfhRequest(tenantId, reqId);
      expect(row?.status).toBe("approved"); // guard held even bypassing the route
    } finally {
      await cleanup(tenantId, [requesterId, managerId]);
    }
  });

  it("GET self-scoping: an employee only sees their own WFH requests; a manager sees their direct report's, not the whole tenant (GAP-HR-SF-16)", async () => {
    const { tenantId, requesterId, managerId, requesterSub, managerSub } = await seedRequesterAndManager();
    try {
      const create = await app.inject({
        method: "POST", url: "/v1/hrms/wfh-requests",
        headers: { ...authHeader(requesterSub, tenantId, ["employee"]), "content-type": "application/json" },
        payload: { employeeId: requesterId, fromDate: "2026-10-05", toDate: "2026-10-06" },
      });
      expect(create.statusCode).toBe(202);
      await drainF3();

      const asRequester = await app.inject({
        method: "GET", url: "/v1/hrms/wfh-requests",
        headers: authHeader(requesterSub, tenantId, ["employee"]),
      });
      expect(asRequester.statusCode).toBe(200);
      const requesterRows = asRequester.json().data as Array<{ employeeId: string }>;
      expect(requesterRows.length).toBe(1);
      expect(requesterRows[0].employeeId).toBe(requesterId);

      // GAP-HR-SF-16: this used to assert "the manager sees the whole
      // tenant queue" -- that was the vulnerability (a manager was treated
      // as fully privileged, identical to HR, with no reports check at
      // all). seedRequesterAndManager now links requesterId as managerId's
      // direct report, so this proves the CORRECTED behavior: a manager
      // sees their own + their direct reports' requests specifically,
      // not an unscoped tenant-wide dump (see
      // attendance-manager-scope-real-db.test.ts for the full matrix,
      // including an unrelated outsider who must NOT appear here).
      const asManager = await app.inject({
        method: "GET", url: "/v1/hrms/wfh-requests",
        headers: authHeader(managerSub, tenantId, ["manager"]),
      });
      expect(asManager.statusCode).toBe(200);
      const managerRows = asManager.json().data as Array<{ employeeId: string }>;
      expect(managerRows.some((r) => r.employeeId === requesterId)).toBe(true);
    } finally {
      await cleanup(tenantId, [requesterId, managerId]);
    }
  });
});

describe("Shift-change requests — end-to-end (real DB)", () => {
  it("202 create: employee can file their own shift-change request, row lands pending", async () => {
    const { tenantId, requesterId, managerId, requesterSub, managerSub } = await seedRequesterAndManager();
    try {
      const create = await app.inject({
        method: "POST", url: "/v1/hrms/shift-requests",
        headers: { ...authHeader(requesterSub, tenantId, ["employee"]), "content-type": "application/json" },
        payload: {
          employeeId: requesterId, currentShift: "Morning Shift", requestedShift: "Evening Shift",
          effectiveDate: "2026-10-05", reason: "Childcare",
        },
      });
      expect(create.statusCode).toBe(202);
      const id = create.json().id as string;
      await drainF3();

      const row = await getShiftChangeRequest(tenantId, id);
      expect(row?.status).toBe("pending");
      expect(row?.employeeId).toBe(requesterId);
      expect(row?.currentShift).toBe("Morning Shift");
      expect(row?.requestedShift).toBe("Evening Shift");
    } finally {
      await cleanup(tenantId, [requesterId, managerId]);
    }
  });

  it("403: the requester cannot approve their own shift-change request, even holding the manager role", async () => {
    const { tenantId, requesterId, managerId, requesterSub, managerSub } = await seedRequesterAndManager();
    try {
      const create = await app.inject({
        method: "POST", url: "/v1/hrms/shift-requests",
        headers: { ...authHeader(requesterSub, tenantId, ["employee"]), "content-type": "application/json" },
        payload: {
          employeeId: requesterId, currentShift: "Morning Shift", requestedShift: "Evening Shift",
          effectiveDate: "2026-10-05",
        },
      });
      const id = create.json().id as string;
      await drainF3();

      const selfApprove = await app.inject({
        method: "PATCH", url: `/v1/hrms/shift-requests/${id}/approve`,
        headers: authHeader(requesterSub, tenantId, ["manager"]),
      });
      expect(selfApprove.statusCode).toBe(403);

      const row = await getShiftChangeRequest(tenantId, id);
      expect(row?.status).toBe("pending");
    } finally {
      await cleanup(tenantId, [requesterId, managerId]);
    }
  });

  it("202: a different manager can approve a pending shift-change request", async () => {
    const { tenantId, requesterId, managerId, requesterSub, managerSub } = await seedRequesterAndManager();
    try {
      const create = await app.inject({
        method: "POST", url: "/v1/hrms/shift-requests",
        headers: { ...authHeader(requesterSub, tenantId, ["employee"]), "content-type": "application/json" },
        payload: {
          employeeId: requesterId, currentShift: "Morning Shift", requestedShift: "Evening Shift",
          effectiveDate: "2026-10-05",
        },
      });
      const id = create.json().id as string;
      await drainF3();

      const approve = await app.inject({
        method: "PATCH", url: `/v1/hrms/shift-requests/${id}/approve`,
        headers: authHeader(managerSub, tenantId, ["manager"]),
      });
      expect(approve.statusCode).toBe(202);
      await drainF3();

      const row = await getShiftChangeRequest(tenantId, id);
      expect(row?.status).toBe("approved");
      expect(row?.approvedBy).toBe(managerId);
    } finally {
      await cleanup(tenantId, [requesterId, managerId]);
    }
  });

  it("202: a different manager can reject a pending shift-change request", async () => {
    const { tenantId, requesterId, managerId, requesterSub, managerSub } = await seedRequesterAndManager();
    try {
      const create = await app.inject({
        method: "POST", url: "/v1/hrms/shift-requests",
        headers: { ...authHeader(requesterSub, tenantId, ["employee"]), "content-type": "application/json" },
        payload: {
          employeeId: requesterId, currentShift: "Morning Shift", requestedShift: "Evening Shift",
          effectiveDate: "2026-10-05",
        },
      });
      const id = create.json().id as string;
      await drainF3();

      const reject = await app.inject({
        method: "PATCH", url: `/v1/hrms/shift-requests/${id}/reject`,
        headers: { ...authHeader(managerSub, tenantId, ["manager"]), "content-type": "application/json" },
        payload: { reason: "Shift already fully staffed" },
      });
      expect(reject.statusCode).toBe(202);
      await drainF3();

      const row = await getShiftChangeRequest(tenantId, id);
      expect(row?.status).toBe("rejected");
      expect(row?.rejectionReason).toBe("Shift already fully staffed");
    } finally {
      await cleanup(tenantId, [requesterId, managerId]);
    }
  });

  it("404: an already-rejected shift-change request cannot later be approved (route-level guard)", async () => {
    const { tenantId, requesterId, managerId, requesterSub, managerSub } = await seedRequesterAndManager();
    try {
      const create = await app.inject({
        method: "POST", url: "/v1/hrms/shift-requests",
        headers: { ...authHeader(requesterSub, tenantId, ["employee"]), "content-type": "application/json" },
        payload: {
          employeeId: requesterId, currentShift: "Morning Shift", requestedShift: "Evening Shift",
          effectiveDate: "2026-10-05",
        },
      });
      const id = create.json().id as string;
      await drainF3();

      const reject = await app.inject({
        method: "PATCH", url: `/v1/hrms/shift-requests/${id}/reject`,
        headers: authHeader(managerSub, tenantId, ["manager"]),
      });
      expect(reject.statusCode).toBe(202);
      await drainF3();

      const approve = await app.inject({
        method: "PATCH", url: `/v1/hrms/shift-requests/${id}/approve`,
        headers: authHeader(managerSub, tenantId, ["manager"]),
      });
      expect(approve.statusCode).toBe(404);

      const row = await getShiftChangeRequest(tenantId, id);
      expect(row?.status).toBe("rejected"); // NOT flipped to approved
    } finally {
      await cleanup(tenantId, [requesterId, managerId]);
    }
  });

  it("consumer-level guard: an approve published directly at an already-rejected row does not flip its status (bypasses the route's own pre-check entirely)", async () => {
    const { tenantId, requesterId, managerId, requesterSub, managerSub } = await seedRequesterAndManager();
    try {
      const reqId = randomUUID();
      await runWithTenant(tenantId, () => db.transaction(async (tx) => {
        await tx.insert(hrmsShiftChangeRequests).values({
          id: reqId, tenantId, employeeId: requesterId,
          currentShift: "Morning Shift", requestedShift: "Evening Shift", effectiveDate: "2026-10-05",
          status: "rejected", rejectionReason: "already decided",
          createdBy: requesterId, updatedBy: requesterId,
        });
      }));

      await queue.publish(COMMANDS.f3RouteWrite, {
        messageId: randomUUID(), type: COMMANDS.f3RouteWrite,
        tenantId, actorId: managerId, correlationId: randomUUID(), schemaVersion: "1.0",
        payload: {
          op: "attendance_routes__9", id: reqId, tenantId,
          body: {}, params: { id: reqId }, query: {},
        },
      });
      await drainF3();

      const row = await getShiftChangeRequest(tenantId, reqId);
      expect(row?.status).toBe("rejected"); // guard held even bypassing the route
    } finally {
      await cleanup(tenantId, [requesterId, managerId]);
    }
  });
});
