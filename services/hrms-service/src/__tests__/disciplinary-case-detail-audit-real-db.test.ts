/**
 * Real-DB regression guard for GAP-HR-DISCIPLINARY-DETAIL-01 (DPDP):
 * GET /v1/hrms/disciplinary-cases/:caseId (the per-case detail read) used
 * to have no read audit at all -- allegation text, finding and penalty for
 * a named employee were readable by every VIGILANCE_ROLES session with no
 * trace of who looked.
 *
 * Fixed via an async publish (routes.ts's auditCaseViewed) + consumer
 * (disciplinary/consumer.ts's disciplinaryCaseViewed subscriber) — routes
 * may not write to Postgres directly (f3-leftover-hrms-cqrs.test.ts), the
 * same shape as GAP-HR-MEDICAL-01's medicalClaimsListRead. Registers the
 * consumer directly (buildApp() alone never wires worker-side consumers),
 * same pattern as disciplinary-case-ownership-real-db.test.ts, and drains
 * the in-memory queue before asserting the outbox row landed.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import type { MemoryQueue } from "@civitasone/queue";
import { withTenantScope } from "@civitasone/db";
import { outboxMessages } from "@civitasone/outbox";
import { buildApp } from "../app.js";
import { db, sqlClient } from "../shared/db.js";
import { queue } from "../shared/infra.js";
import { registerDisciplinaryConsumers } from "../modules/disciplinary/consumer.js";
import { hrmsDepartments, hrmsDesignations, hrmsEmployees } from "../modules/employee/schema.js";
import { hrmsDisciplinaryCases } from "../modules/disciplinary/schema.js";
import type { FastifyInstance } from "fastify";

registerDisciplinaryConsumers(queue);

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const HR_OFFICER_ACTOR = randomUUID();

function auth(sub: string, roles: string[]): { authorization: string } {
  const jwt = signToken({ sub, tid: TENANT, roles, sid: "sess-disc-detail-audit" }, SECRET, 3600);
  return { authorization: `Bearer ${jwt}` };
}

let app: FastifyInstance;
let caseId: string;

beforeAll(async () => {
  app = await buildApp();

  const deptId = randomUUID();
  const desigId = randomUUID();
  const employeeId = randomUUID();
  caseId = randomUUID();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await withTenantScope(db, TENANT, async (tx: any) => {
    await tx.insert(hrmsDepartments).values({
      id: deptId, tenantId: TENANT, code: "DTAU", name: "Detail Audit Test Dept",
      isActive: true, createdBy: HR_OFFICER_ACTOR, updatedBy: HR_OFFICER_ACTOR,
    });
    await tx.insert(hrmsDesignations).values({
      id: desigId, tenantId: TENANT, code: "DTAU-D", name: "Detail Audit Test Designation", level: 5,
      createdBy: HR_OFFICER_ACTOR, updatedBy: HR_OFFICER_ACTOR,
    });
    await tx.insert(hrmsEmployees).values({
      id: employeeId, tenantId: TENANT, employeeNo: "DTAU-001", fullName: "Detail Audit Test Employee",
      departmentId: deptId, designationId: desigId, dateOfJoining: "2020-01-01",
      createdBy: HR_OFFICER_ACTOR, updatedBy: HR_OFFICER_ACTOR,
    });
    await tx.insert(hrmsDisciplinaryCases).values({
      id: caseId, tenantId: TENANT, employeeId, caseNo: "DTAU-TEST-1",
      proceedingType: "major", status: "opened",
      allegation: "Seeded allegation for detail-audit test.",
      createdBy: HR_OFFICER_ACTOR, updatedBy: HR_OFFICER_ACTOR,
    });
  });
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

async function auditEventsFor(action: string): Promise<Array<Record<string, unknown>>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = await withTenantScope(db, TENANT, async (tx: any) =>
    tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT)));
  return (rows as Array<Record<string, unknown>>).filter(
    (r) => (r.payload as { action?: string })?.action === action,
  );
}

describe("GET /v1/hrms/disciplinary-cases/:caseId (GAP-HR-DISCIPLINARY-DETAIL-01)", () => {
  it("emits an hrms.disciplinary_case.viewed-derived audit.event.record row on each detail read", async () => {
    const before = (await auditEventsFor("viewed")).length;

    const res = await app.inject({
      method: "GET", url: `/v1/hrms/disciplinary-cases/${caseId}`,
      headers: auth(HR_OFFICER_ACTOR, ["hr_officer"]),
    });
    expect(res.statusCode).toBe(200);

    // queue.publish() (MemoryQueue) resolves before its consumer runs --
    // drain before asserting the outbox row actually landed, same
    // convention as disciplinary-case-ownership-real-db.test.ts.
    await (queue as unknown as MemoryQueue).drain();

    const after = await auditEventsFor("viewed");
    expect(after.length).toBeGreaterThan(before);
    const last = after[after.length - 1];
    expect(last?.tenantId).toBe(TENANT);
    expect(last?.actorId).toBe(HR_OFFICER_ACTOR);
    expect((last?.payload as { resourceType?: string; resourceId?: string })?.resourceType).toBe("disciplinary_case");
    expect((last?.payload as { resourceType?: string; resourceId?: string })?.resourceId).toBe(caseId);
  });

  it("still returns the case data itself, unaffected by the audit publish", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/hrms/disciplinary-cases/${caseId}`,
      headers: auth(HR_OFFICER_ACTOR, ["hr_officer"]),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().caseNo).toBe("DTAU-TEST-1");
  });

  it("still 403s a non-vigilance role (role gate unchanged)", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/hrms/disciplinary-cases/${caseId}`,
      headers: auth(randomUUID(), ["employee"]),
    });
    expect(res.statusCode).toBe(403);
  });
});
