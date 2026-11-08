/**
 * PR #2465 delta (real Postgres): the edit form clears mobile / IFSC / UAN by sending "".
 * updateEmployeeBody maps "" to null; the route accepts it (reason still required for the sensitive
 * IFSC/UAN), the consumer writes NULL, and a bad non-empty value is still refused with nothing queued.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
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

registerEmployeeConsumers(queue);
const drain = (): Promise<void> => (queue as unknown as MemoryQueue).drain();

const TENANT = randomUUID();
const ACTOR = randomUUID();
const SECRET = process.env.JWT_SECRET as string;
const deptId = randomUUID();
const desigId = randomUUID();
const headers = {
  authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles: ["hr_admin"], sid: "s" }, SECRET)}`,
  "content-type": "application/json",
};
let app: FastifyInstance;

async function seed(): Promise<string> {
  const id = randomUUID();
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(hrmsEmployees).values({
      id, tenantId: TENANT, employeeNo: `E-${id.slice(0, 8)}`, fullName: `Clear Ident ${id.slice(0, 4)}`,
      departmentId: deptId, designationId: desigId, dateOfJoining: "2015-01-01", status: "confirmed", employeeType: "permanent",
      mobile: "9876543210", bankIfsc: "SBIN0001234", uanNumber: "123456789012", createdBy: ACTOR, updatedBy: ACTOR,
    });
  }));
  return id;
}
async function row(id: string) {
  const rows = await runWithTenant(TENANT, () => db.transaction((tx) => tx.select({ mobile: hrmsEmployees.mobile, bankIfsc: hrmsEmployees.bankIfsc, uanNumber: hrmsEmployees.uanNumber })
    .from(hrmsEmployees).where(and(eq(hrmsEmployees.id, id), eq(hrmsEmployees.tenantId, TENANT))).limit(1)));
  return rows[0]!;
}
const patch = (id: string, payload: Record<string, unknown>) => app.inject({ method: "PATCH", url: `/v1/hrms/employees/${id}`, headers, payload });

beforeAll(async () => {
  app = await buildApp();
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(hrmsDepartments).values({ id: deptId, tenantId: TENANT, code: "CI", name: "Clear Ident Dept", createdBy: ACTOR, updatedBy: ACTOR });
    await tx.insert(hrmsDesignations).values({ id: desigId, tenantId: TENANT, code: "CI", name: "Clear Ident Designation", createdBy: ACTOR, updatedBy: ACTOR });
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

describe("PATCH /v1/hrms/employees/:id -- clearing mobile / IFSC / UAN", () => {
  it("\"\" clears all three (stored as NULL) through the route and consumer", async () => {
    const id = await seed();
    const r = await patch(id, { mobile: "", bankIfsc: "", uanNumber: "", reason: "employee left the bank and UAN is withdrawn" });
    expect(r.statusCode).toBe(202);
    await drain();
    expect(await row(id)).toEqual({ mobile: null, bankIfsc: null, uanNumber: null });
  });

  it("a bad non-empty value is still refused (400) and nothing is queued or changed", async () => {
    const id = await seed();
    const publish = vi.spyOn(queue, "publish");
    const r = await patch(id, { mobile: "12345", reason: "correcting the contact number" });
    expect(r.statusCode).toBe(400);
    expect(publish).not.toHaveBeenCalled();
    publish.mockRestore();
    expect((await row(id)).mobile).toBe("9876543210");
  });

  it("a valid new value is stored normalised", async () => {
    const id = await seed();
    const r = await patch(id, { mobile: "+91 98765 43211" });
    expect(r.statusCode).toBe(202);
    await drain();
    expect((await row(id)).mobile).toBe("9876543211");
  });
});
