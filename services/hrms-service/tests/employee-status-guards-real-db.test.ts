/**
 * SEC CRITICAL regression suite (status-integrity fix, real Postgres) —
 * route-level status preconditions on employee/routes.ts:
 *
 *   PATCH /v1/hrms/employees/:id/confirm  — used to write status: "confirmed"
 *     unconditionally, with no check on the employee's prior status. A
 *     terminated/separated/retired employee (or one already confirmed)
 *     could be silently "re-confirmed". Now only valid from "probation".
 *
 *   PATCH /v1/hrms/employees/:id  — the generic profile-update path had NO
 *     status check at all; a terminated/separated/retired employee's
 *     mobile/email/bank-account/IFSC could still be edited by any HR-role
 *     actor. Now hard-blocked for any exited status.
 *
 *   PATCH /v1/hrms/employees/:id/separate  — PR #1572 fix-up round: an
 *     independent review found this route had NO status check either
 *     (unlike its /confirm sibling above), and live-reproduced a
 *     PATCH .../separate on an already-separated employee returning 202
 *     (accepted) twice, instead of 409 like /confirm. The frontend-only
 *     gating InitiateSeparationAction.tsx originally shipped with (an
 *     EXITED_STATUSES picker-list filter) never covered this route, and its
 *     own "cannot, by construction" claim about the ?empId= prefill path was
 *     also false (see that component's doc comment) — this route-level
 *     guard is the real fix. Uses isExitedStatus/EMPLOYEE_EXITED, same as
 *     the generic PATCH /:id block above, not confirm's narrower
 *     probation-only check — separation is legitimately initiated from
 *     'confirmed'/'probation'/etc, so a positive allowlist would wrongly
 *     reject the real non-exited flow this route exists for.
 *
 * Exercised against a real Postgres (not mocked) via app.inject + the real
 * async command→consumer path (registerEmployeeConsumers + drain), mirroring
 * tests/basicminor-concurrency.test.ts's pattern — this table has FORCE ROW
 * LEVEL SECURITY, so every direct read/write goes through runWithTenant.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { buildApp } from "../src/app.js";
import { registerEmployeeConsumers } from "../src/modules/employee/consumer.js";
import { hrmsEmployees, hrmsDepartments, hrmsDesignations } from "../src/modules/employee/schema.js";
import type { FastifyInstance } from "fastify";
import type { MemoryQueue } from "@civitasone/queue";

// Only worker.ts wires this consumer in production; tests must subscribe it
// themselves (same convention as tests/agent1-gap-routes.test.ts /
// tests/geo-attendance-e2e.test.ts). Registered once for the whole file.
registerEmployeeConsumers(queue);

async function drain(): Promise<void> {
  await (queue as unknown as MemoryQueue).drain();
}

const TENANT = randomUUID();
const ACTOR = randomUUID();
const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const deptId = randomUUID();
const desigId = randomUUID();

const tok = (roles = ["hr_admin"]) => signToken({ sub: ACTOR, tid: TENANT, roles, sid: "s" }, SECRET);
const auth = (roles = ["hr_admin"]) => ({ authorization: `Bearer ${tok(roles)}`, "content-type": "application/json" });

let app: FastifyInstance;

async function seedEmployee(status: string): Promise<string> {
  const id = randomUUID();
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(hrmsEmployees).values({
      id, tenantId: TENANT, employeeNo: `E-${id.slice(0, 8)}`, fullName: "Status Guard Test Employee",
      departmentId: deptId, designationId: desigId, dateOfJoining: "2015-01-01",
      status, employeeType: "permanent", createdBy: ACTOR, updatedBy: ACTOR,
    });
  }));
  return id;
}

async function readEmployee(id: string): Promise<{ status: string; mobile: string | null } | null> {
  const rows = await runWithTenant(TENANT, () => db.transaction((tx) => tx.select({
    status: hrmsEmployees.status, mobile: hrmsEmployees.mobile,
  }).from(hrmsEmployees).where(and(eq(hrmsEmployees.id, id), eq(hrmsEmployees.tenantId, TENANT))).limit(1)));
  return rows[0] ?? null;
}

beforeAll(async () => {
  app = await buildApp();
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(hrmsDepartments).values({ id: deptId, tenantId: TENANT, code: "D1", name: "Dept 1", createdBy: ACTOR, updatedBy: ACTOR });
    await tx.insert(hrmsDesignations).values({ id: desigId, tenantId: TENANT, code: "DS1", name: "Designation 1", createdBy: ACTOR, updatedBy: ACTOR });
  }));
});

afterAll(async () => {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(hrmsEmployees).where(eq(hrmsEmployees.tenantId, TENANT));
    await tx.delete(hrmsDesignations).where(eq(hrmsDesignations.tenantId, TENANT));
    await tx.delete(hrmsDepartments).where(eq(hrmsDepartments.tenantId, TENANT));
  }));
  await app.close();
  await sqlClient.end();
});

describe("PATCH /v1/hrms/employees/:id/confirm — status precondition", () => {
  it("confirms a valid pending-confirmation (probation) employee normally", async () => {
    const id = await seedEmployee("probation");
    const r = await app.inject({
      method: "PATCH", url: `/v1/hrms/employees/${id}/confirm`,
      headers: auth(), payload: { confirmationDate: "2026-01-15" },
    });
    expect(r.statusCode).toBe(202);
    await drain();
    const after = await readEmployee(id);
    expect(after?.status).toBe("confirmed");
  });

  it.each(["terminated", "separated", "retired", "confirmed", "on_leave", "suspended", "deputation", "no_show"])(
    "rejects confirming an employee whose status is '%s' — 409, row unchanged",
    async (status) => {
      const id = await seedEmployee(status);
      const r = await app.inject({
        method: "PATCH", url: `/v1/hrms/employees/${id}/confirm`,
        headers: auth(), payload: { confirmationDate: "2026-01-15" },
      });
      expect(r.statusCode).toBe(409);
      expect(r.json().code).toBe("INVALID_STATUS_TRANSITION");
      await drain();
      const after = await readEmployee(id);
      // The row must be completely unchanged — the async consumer must never
      // have applied the write either (the route's synchronous pre-check
      // should have stopped the command from ever being published).
      expect(after?.status).toBe(status);
    },
  );

  it("returns 404 for an unknown employee id", async () => {
    const r = await app.inject({
      method: "PATCH", url: `/v1/hrms/employees/${randomUUID()}/confirm`,
      headers: auth(), payload: { confirmationDate: "2026-01-15" },
    });
    expect(r.statusCode).toBe(404);
  });
});

describe("PATCH /v1/hrms/employees/:id — generic update status precondition", () => {
  it("still allows updates for a non-exited (e.g. confirmed) employee", async () => {
    const id = await seedEmployee("confirmed");
    const r = await app.inject({
      method: "PATCH", url: `/v1/hrms/employees/${id}`,
      headers: auth(), payload: { mobile: "9876543210" },
    });
    expect(r.statusCode).toBe(202);
    await drain();
    // mobile is encrypted-at-rest (encryptedText) so this only proves the
    // write path was reached without erroring; content-level round-trip is
    // covered elsewhere. The status-unchanged / write-blocked assertions
    // below are this test's real regression guard.
    const after = await readEmployee(id);
    expect(after?.status).toBe("confirmed");
  });

  it.each(["terminated", "separated", "retired"])(
    "rejects updating ANY field for an employee whose status is '%s' — 409",
    async (status) => {
      const id = await seedEmployee(status);
      const r = await app.inject({
        method: "PATCH", url: `/v1/hrms/employees/${id}`,
        headers: auth(), payload: { mobile: "9876543210", email: "changed@gov.in" },
      });
      expect(r.statusCode).toBe(409);
      expect(r.json().code).toBe("EMPLOYEE_EXITED");
      await drain();
      const after = await readEmployee(id);
      expect(after?.status).toBe(status); // unchanged
    },
  );

  it("returns 404 for an unknown employee id", async () => {
    const r = await app.inject({
      method: "PATCH", url: `/v1/hrms/employees/${randomUUID()}`,
      headers: auth(), payload: { mobile: "9876543210" },
    });
    expect(r.statusCode).toBe(404);
  });
});

describe("PATCH /v1/hrms/employees/:id/separate — status precondition", () => {
  const payload = { separationType: "resignation", effectiveDate: "2026-06-30", encashmentDays: 0 };

  it("separates a valid non-exited (e.g. confirmed) employee normally", async () => {
    const id = await seedEmployee("confirmed");
    const r = await app.inject({
      method: "PATCH", url: `/v1/hrms/employees/${id}/separate`,
      headers: auth(), payload,
    });
    expect(r.statusCode).toBe(202);
    await drain();
    const after = await readEmployee(id);
    // employee/consumer.ts's employeeSeparate handler always writes the
    // literal status "separated", regardless of separationType.
    expect(after?.status).toBe("separated");
  });

  it.each(["terminated", "separated", "retired"])(
    "rejects separating an employee whose status is '%s' — 409, row unchanged (was: 202, twice)",
    async (status) => {
      const id = await seedEmployee(status);
      const r = await app.inject({
        method: "PATCH", url: `/v1/hrms/employees/${id}/separate`,
        headers: auth(), payload,
      });
      expect(r.statusCode).toBe(409);
      expect(r.json().code).toBe("EMPLOYEE_EXITED");
      await drain();
      const after = await readEmployee(id);
      expect(after?.status).toBe(status); // unchanged
    },
  );

  it("returns 404 for an unknown employee id", async () => {
    const r = await app.inject({
      method: "PATCH", url: `/v1/hrms/employees/${randomUUID()}/separate`,
      headers: auth(), payload,
    });
    expect(r.statusCode).toBe(404);
  });
});
