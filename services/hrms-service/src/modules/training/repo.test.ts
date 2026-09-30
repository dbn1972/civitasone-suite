/**
 * GAP-HR-TRAINING-NOMINATIONS-04 — countNominationsForAdmin.
 *
 * Real-DB test (this service's disposable-Postgres convention): the old
 * admin nominations endpoint reported `total: data.length`, identical to
 * the LIMIT 500 row count it was already capped at, so a truncated tenant's
 * "total" silently understated its real nomination count. This asserts the
 * new COUNT(*) reflects rows beyond what a capped list would ever return.
 *
 * hrms_nominations.employee_id carries a real FK (migration 0028) to
 * hrms_employees, which itself requires a department + designation row --
 * all three are seeded here for a minimally valid fixture.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";
import { runWithTenant } from "@civitasone/db";
import { db } from "../../shared/db.js";
import * as repo from "./repo.js";
import { hrmsTrainings } from "./schema.js";
import { hrmsDepartments, hrmsDesignations, hrmsEmployees } from "../employee/schema.js";

const TENANT = randomUUID();
const ACTOR = randomUUID();
const DEPARTMENT = randomUUID();
const DESIGNATION = randomUUID();
const EMPLOYEE = randomUUID();
const TRAINING = randomUUID();

async function insertNominations(count: number) {
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
    await tx.insert(hrmsDepartments).values({
      id: DEPARTMENT, tenantId: TENANT, code: "CNT", name: "Count Test Dept",
      createdBy: ACTOR, updatedBy: ACTOR,
    });
    await tx.insert(hrmsDesignations).values({
      id: DESIGNATION, tenantId: TENANT, code: "CNT-D", name: "Count Test Designation",
      createdBy: ACTOR, updatedBy: ACTOR,
    });
    await tx.insert(hrmsEmployees).values({
      id: EMPLOYEE, tenantId: TENANT, employeeNo: "CNT-001", fullName: "Count Test Employee",
      departmentId: DEPARTMENT, designationId: DESIGNATION, dateOfJoining: "2020-01-01",
      createdBy: ACTOR, updatedBy: ACTOR,
    });
    // One nomination per (tenant, training, employee) -- hrms_nominations has
    // a real unique constraint on that triple, so distinct rows for the same
    // employee need distinct trainings, not a loop reusing one training id.
    for (let i = 0; i < count; i++) {
      const trainingId = i === 0 ? TRAINING : randomUUID();
      await tx.insert(hrmsTrainings).values({
        id: trainingId, tenantId: TENANT, title: `Count Test Training ${i}`,
        fromDate: "2026-11-01", toDate: "2026-11-02", maxParticipants: 1000,
        createdBy: ACTOR, updatedBy: ACTOR,
      });
      await repo.insertNomination(tx, {
        id: randomUUID(), tenantId: TENANT, trainingId, employeeId: EMPLOYEE,
        status: "nominated", certificateRef: null, nominatedBy: ACTOR,
        createdBy: ACTOR, updatedBy: ACTOR,
      });
    }
    }),
  );
}

describe("countNominationsForAdmin", () => {
  beforeAll(async () => {
    await insertNominations(3);
  }, 20_000);

  it("returns the real row count for the tenant", async () => {
    const total = await runWithTenant(TENANT, () => repo.countNominationsForAdmin(TENANT));
    expect(total).toBe(3);
  });

  it("is scoped per tenant (a different tenant's rows never count)", async () => {
    const otherTenant = randomUUID();
    const otherTenantTotal = await runWithTenant(otherTenant, () =>
      repo.countNominationsForAdmin(otherTenant),
    );
    expect(otherTenantTotal).toBe(0);
  });
});
