/**
 * Real-DB regression guard for the audit's core disciplinary-case-creation
 * reproduction: POST /v1/hrms/employees/:id/disciplinary-cases returns 201
 * "opened", but is the case actually, genuinely readable afterward via the
 * list endpoints -- not just that the route replied 201?
 *
 * Investigation finding (this fix): at this repo's current HEAD, both
 * suspected root causes are ALREADY FIXED by prior commits, independently
 * of this change --
 *   - disciplinary/f3-consumer.ts's `disciplinary_routes__1` case already
 *     inserts using the SAME id the route published and returned to the
 *     caller (routes.ts's `caseId = randomUUID()` is both the publishF3Write
 *     id and the response id) -- the "mints its own uuid, then publishes an
 *     unrelated randomUUID()" defect the audit suspected does not reproduce.
 *   - GET /v1/hrms/disciplinary-cases (the bare, un-scoped list a fix-agent
 *     working the accounting/payroll-adjacent gap-features module owns) was
 *     the actual reason a created case could read back empty: it ran a raw
 *     sqlPool.query() against a FORCE ROW LEVEL SECURITY table with no
 *     app.tenant_id GUC set, so its USING clause saw a NULL tenant and
 *     silently returned zero rows for every caller -- fixed in commit
 *     c9a4e83c0 ("tenant-GUC fix for gap-features raw-SQL routes"), which
 *     landed on origin/main hours before this fix branch was cut.
 * Live-reproduced against a real separate hrms-service + hrms-worker pair
 * (disposable Postgres + LocalStack, real 65s wall-clock wait, matching the
 * audit's own methodology) as part of this fix, confirming the bug no
 * longer reproduces. This test locks that in as a fast, deterministic CI
 * guard so neither fix can regress silently.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { withTenantScope } from "@civitasone/db";
import { buildApp } from "../app.js";
import { db, sqlClient } from "../shared/db.js";
import { queue } from "../shared/infra.js";
import { registerF3_disciplinary_Consumers } from "../modules/disciplinary/f3-consumer.js";
import { registerF3_appraisals_Consumers } from "../modules/appraisals/f3-consumer.js";
import { hrmsDepartments, hrmsDesignations, hrmsEmployees } from "../modules/employee/schema.js";
import type { FastifyInstance } from "fastify";

// disciplinaryRoutes'/feedbackRoutes' mutating endpoints only PUBLISH
// (publishF3Write); the row is actually written by these consumers, which
// f3-leftover-register.ts wires into the standalone worker process
// (worker.ts) -- buildApp() (the HTTP app under test here) never registers
// them. Register directly, same pattern as
// disciplinary-case-ownership-real-db.test.ts.
registerF3_disciplinary_Consumers(queue);
registerF3_appraisals_Consumers(queue);

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const HR_ADMIN_ACTOR = randomUUID();

function auth(sub: string, roles: string[]): { authorization: string } {
  const jwt = signToken({ sub, tid: TENANT, roles, sid: "sess-disc-readable" }, SECRET, 3600);
  return { authorization: `Bearer ${jwt}` };
}

let app: FastifyInstance;
let employeeId: string;

beforeAll(async () => {
  app = await buildApp();

  const deptId = randomUUID();
  const desigId = randomUUID();
  employeeId = randomUUID();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await withTenantScope(db, TENANT, async (tx: any) => {
    await tx.insert(hrmsDepartments).values({
      id: deptId, tenantId: TENANT, code: "REPRO", name: "Repro Dept",
      isActive: true, createdBy: HR_ADMIN_ACTOR, updatedBy: HR_ADMIN_ACTOR,
    });
    await tx.insert(hrmsDesignations).values({
      id: desigId, tenantId: TENANT, code: "REPRO-D", name: "Repro Designation", level: 5,
      createdBy: HR_ADMIN_ACTOR, updatedBy: HR_ADMIN_ACTOR,
    });
    await tx.insert(hrmsEmployees).values({
      id: employeeId, tenantId: TENANT, employeeNo: "REPRO-001", fullName: "Repro Employee",
      departmentId: deptId, designationId: desigId, dateOfJoining: "2020-01-01",
      createdBy: HR_ADMIN_ACTOR, updatedBy: HR_ADMIN_ACTOR,
    });
  });
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

describe("disciplinary case creation is genuinely readable afterward (not just 201)", () => {
  it("POSTed case appears on GET /v1/hrms/employees/:id/disciplinary-cases after the async write settles", async () => {
    const create = await app.inject({
      method: "POST", url: `/v1/hrms/employees/${employeeId}/disciplinary-cases`,
      headers: auth(HR_ADMIN_ACTOR, ["hr_admin"]),
      payload: { caseNo: "REPRO-CASE-A", proceedingType: "major", allegation: "Reproduction test allegation." },
    });
    expect(create.statusCode).toBe(201);
    const created = create.json();
    expect(created.status).toBe("opened");
    const caseId = created.id;

    // publishF3Write is fire-and-forget (MemoryQueue.publish() schedules
    // delivery via setTimeout(0) and returns immediately) -- drain() before
    // re-reading so this actually confirms the write landed, not merely
    // that the route accepted it. (The manual reproduction for this fix
    // separately confirmed this same behavior against a real, separate
    // hrms-service + hrms-worker process pair with a real 65s wall-clock
    // wait, matching the audit's own methodology -- drain() gives the same
    // guarantee deterministically for fast, repeatable CI.)
    await (queue as unknown as { drain: () => Promise<void> }).drain();

    const list = await app.inject({
      method: "GET", url: `/v1/hrms/employees/${employeeId}/disciplinary-cases`,
      headers: auth(HR_ADMIN_ACTOR, ["hr_admin"]),
    });
    expect(list.statusCode).toBe(200);
    const rows = list.json().data as Array<Record<string, unknown>>;
    const found = rows.find((r) => r.id === caseId);
    expect(found).toBeTruthy();
    expect(found?.caseNo).toBe("REPRO-CASE-A");
    expect(found?.allegation).toBe("Reproduction test allegation.");
    expect(found?.status).toBe("opened");
  });

  it("the same case also appears on the bare GET /v1/hrms/disciplinary-cases list (gap-features' tenant-scoped raw-SQL route) -- the exact endpoint the audit's reproduction used", async () => {
    const create = await app.inject({
      method: "POST", url: `/v1/hrms/employees/${employeeId}/disciplinary-cases`,
      headers: auth(HR_ADMIN_ACTOR, ["hr_admin"]),
      payload: { caseNo: "REPRO-CASE-B", proceedingType: "minor", allegation: "Second reproduction allegation." },
    });
    expect(create.statusCode).toBe(201);
    const caseId = create.json().id;

    await (queue as unknown as { drain: () => Promise<void> }).drain();

    const list = await app.inject({
      method: "GET", url: "/v1/hrms/disciplinary-cases",
      headers: auth(HR_ADMIN_ACTOR, ["hr_admin"]),
    });
    expect(list.statusCode).toBe(200);
    const rows = list.json().data as Array<Record<string, unknown>>;
    expect(rows.find((r) => r.id === caseId)).toBeTruthy();
  });
});

describe("appraisals 360-feedback creation is genuinely readable afterward (same bug class, checked per the audit's request)", () => {
  it("POSTed 360-feedback appears on GET .../360-feedback after the async write settles", async () => {
    const appraisalId = randomUUID();
    const reviewerId = randomUUID();

    const create = await app.inject({
      method: "POST", url: `/v1/hrms/appraisals/${appraisalId}/360-feedback`,
      headers: auth(HR_ADMIN_ACTOR, ["hr_admin"]),
      payload: { reviewerId, relationship: "peer", comments: "Reproduction feedback." },
    });
    expect(create.statusCode).toBe(201);
    const feedbackId = create.json().id;

    await (queue as unknown as { drain: () => Promise<void> }).drain();

    const list = await app.inject({
      method: "GET", url: `/v1/hrms/appraisals/${appraisalId}/360-feedback`,
      headers: auth(HR_ADMIN_ACTOR, ["hr_admin"]),
    });
    expect(list.statusCode).toBe(200);
    const rows = list.json().data as Array<Record<string, unknown>>;
    const found = rows.find((r) => r.id === feedbackId);
    expect(found).toBeTruthy();
    expect(found?.comments).toBe("Reproduction feedback.");
  });
});
