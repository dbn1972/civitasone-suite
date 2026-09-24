/**
 * Onboarding step-completion ownership — real-DB regression (no mocks).
 *
 * HIGH finding ("same flat-role, no-ownership pattern as disciplinary, on a
 * different table"): POST /v1/hrms/onboarding/:id/steps/:stepIdx/complete
 * let ALL_ROLES (which includes bare "employee") complete a step on ANY
 * onboarding instance by guessing/enumerating its uuid -- nothing compared
 * the instance's own employee_id to the caller. Fixed via gap-features/
 * routes.ts's ownership check, mirroring this file's own established
 * resolveOwnEmployeeIdIfBareEmployee precedent: HR/manager stay privileged,
 * a bare "employee" caller must be resolved (via resolveEmployeeForActor,
 * NOT ctx.actorId -- a different id space) to the instance's own
 * employee_id, and a mismatch/unresolvable actor gets 404 (not 403) so
 * existence is never leaked.
 *
 * While making that check reachable at all, a separate pre-existing bug was
 * found and fixed here too: employee.onboarding_instances/_templates have
 * FORCE ROW LEVEL SECURITY, but the route's sqlPool.query() calls never set
 * app.tenant_id (shared/db.ts's sqlPool is a bare sqlClient.unsafe() wrapper
 * with no GUC injection -- only the Drizzle `db` export gets that, via
 * wrapWithTenantGuc). Verified directly against Postgres: without the GUC,
 * this table hides every row from every caller regardless of tenant_id
 * filters -- so the route could not have worked for ANYONE before this fix,
 * ownership check included. Now wrapped in sqlClient.begin() + set_config(),
 * mirroring the already-correct staffing-plan route in this same file.
 *
 * Real DB (no mocks), seeded directly (drizzle for hrms_employees, raw SQL +
 * set_config for onboarding_templates/_instances, which have no Drizzle
 * schema in this service).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { withTenantScope } from "@civitasone/db";
import { buildApp } from "../app.js";
import { db, sqlClient } from "../shared/db.js";
import { hrmsEmployees } from "../modules/employee/schema.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();

function auth(sub: string, roles: string[]): { authorization: string } {
  const jwt = signToken({ sub, tid: TENANT, roles, sid: "sess-onboarding-ownership" }, SECRET, 3600);
  return { authorization: `Bearer ${jwt}` };
}

async function seedEmployee(opts: { userRef: string; fullName: string; createdBy: string }): Promise<string> {
  const id = randomUUID();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await withTenantScope(db, TENANT, (tx: any) => tx.insert(hrmsEmployees).values({
    id, tenantId: TENANT,
    employeeNo: `REG-${id.slice(0, 8)}`,
    fullName: opts.fullName,
    departmentId: randomUUID(),
    designationId: randomUUID(),
    dateOfJoining: "2020-01-15",
    userRef: opts.userRef,
    createdBy: opts.createdBy, updatedBy: opts.createdBy,
  }));
  return id;
}

// onboarding_templates/_instances have no Drizzle schema in this service
// (gap-features/routes.ts talks to them via raw sqlPool.query/sqlClient), so
// seeding goes through raw SQL too -- with the SAME set_config() the route
// itself now uses, since both tables have FORCE ROW LEVEL SECURITY.
async function seedTemplate(): Promise<string> {
  const id = randomUUID();
  await sqlClient.begin(async (sql) => {
    await sql.unsafe("SELECT set_config('app.tenant_id', $1, true)", [TENANT]);
    await sql.unsafe(
      `INSERT INTO employee.onboarding_templates (id, tenant_id, name, steps, created_by) VALUES ($1, $2, $3, $4, $5)`,
      [id, TENANT, `Template ${id.slice(0, 8)}`, JSON.stringify([{ title: "Sign offer letter" }]), randomUUID()],
    );
  });
  return id;
}

async function seedInstance(opts: {
  templateId: string; employeeId: string; steps: Array<Record<string, unknown>>;
}): Promise<string> {
  const id = randomUUID();
  await sqlClient.begin(async (sql) => {
    await sql.unsafe("SELECT set_config('app.tenant_id', $1, true)", [TENANT]);
    await sql.unsafe(
      `INSERT INTO employee.onboarding_instances (id, tenant_id, template_id, employee_id, steps) VALUES ($1, $2, $3, $4, $5)`,
      [id, TENANT, opts.templateId, opts.employeeId, JSON.stringify(opts.steps)],
    );
  });
  return id;
}

async function readInstance(id: string): Promise<{ status: string; completion_pct: number; steps: Array<Record<string, unknown>> } | undefined> {
  return sqlClient.begin(async (sql) => {
    await sql.unsafe("SELECT set_config('app.tenant_id', $1, true)", [TENANT]);
    const rows = (await sql.unsafe(
      `SELECT status, completion_pct, steps FROM employee.onboarding_instances WHERE id = $1 AND tenant_id = $2`,
      [id, TENANT],
    )) as unknown as Array<{ status: string; completion_pct: number; steps: Array<Record<string, unknown>> }>;
    return rows[0];
  });
}

const HR_ACTOR = randomUUID();
const ALICE_ACTOR = randomUUID();
const BOB_ACTOR = randomUUID();
const UNLINKED_ACTOR = randomUUID(); // "employee" role, no hrms_employees row at all

let app: FastifyInstance;
let aliceEmpId: string;
let bobEmpId: string;
let templateId: string;

beforeAll(async () => {
  app = await buildApp();
  aliceEmpId = await seedEmployee({ userRef: ALICE_ACTOR, fullName: "Alice Onboardee", createdBy: HR_ACTOR });
  bobEmpId = await seedEmployee({ userRef: BOB_ACTOR, fullName: "Bob Onboardee", createdBy: HR_ACTOR });
  templateId = await seedTemplate();
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

describe("POST /v1/hrms/onboarding/:id/steps/:stepIdx/complete — ownership", () => {
  it("Bob (bare employee) cannot complete a step on Alice's onboarding instance (404, not 200)", async () => {
    const instanceId = await seedInstance({
      templateId, employeeId: aliceEmpId,
      steps: [{ title: "Sign offer letter" }, { title: "Submit documents" }],
    });
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/onboarding/${instanceId}/steps/0/complete`,
      headers: auth(BOB_ACTOR, ["employee"]),
    });
    expect(r.statusCode).toBe(404);

    const after = await readInstance(instanceId);
    expect(after!.completion_pct).toBe(0);
  });

  it("Alice (bare employee) CAN complete her own onboarding step", async () => {
    const instanceId = await seedInstance({
      templateId, employeeId: aliceEmpId,
      steps: [{ title: "Sign offer letter" }, { title: "Submit documents" }],
    });
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/onboarding/${instanceId}/steps/0/complete`,
      headers: auth(ALICE_ACTOR, ["employee"]),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.completionPct).toBe(50);
    expect(r.json().data.status).toBe("active");

    const after = await readInstance(instanceId);
    expect(after!.completion_pct).toBe(50);
    expect((after!.steps[0] as Record<string, unknown>).completed).toBe(true);
  });

  it("an actor with no linked employee row at all is rejected even on a real instance id (fails closed)", async () => {
    const instanceId = await seedInstance({
      templateId, employeeId: aliceEmpId, steps: [{ title: "Sign offer letter" }],
    });
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/onboarding/${instanceId}/steps/0/complete`,
      headers: auth(UNLINKED_ACTOR, ["employee"]),
    });
    expect(r.statusCode).toBe(404);
  });

  it("hr_admin CAN complete a step on ANY employee's onboarding instance (privileged role unaffected)", async () => {
    const instanceId = await seedInstance({
      templateId, employeeId: bobEmpId, steps: [{ title: "Sign offer letter" }],
    });
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/onboarding/${instanceId}/steps/0/complete`,
      headers: auth(HR_ACTOR, ["hr_admin"]),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.status).toBe("completed");
  });

  it("a bare manager role is ALSO privileged here, matching this file's own resolveOwnEmployeeIdIfBareEmployee precedent (not scoped to direct reports)", async () => {
    const instanceId = await seedInstance({
      templateId, employeeId: bobEmpId, steps: [{ title: "Sign offer letter" }],
    });
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/onboarding/${instanceId}/steps/0/complete`,
      headers: auth(randomUUID(), ["manager"]),
    });
    expect(r.statusCode).toBe(200);
  });

  it("returns 404 for a nonexistent instance id (does not leak existence either way)", async () => {
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/onboarding/${randomUUID()}/steps/0/complete`,
      headers: auth(ALICE_ACTOR, ["employee"]),
    });
    expect(r.statusCode).toBe(404);
  });
});
