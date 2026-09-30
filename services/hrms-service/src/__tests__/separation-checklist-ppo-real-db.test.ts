/**
 * Separation checklist + Issue-PPO regression test — real-DB round-trip
 * (GAP-HR-RETIREMENT-01).
 *
 * Before this fix: the 5-step retirement checklist had no backend at all
 * (client useState only, reset on reload); "Issue PPO" was a styled <span>,
 * never a working action. Decision packet (Theme 1): persist server-side,
 * gate Issue PPO to HR admin, require all 25 checks complete, fully
 * audited.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { withRawTenantGuc } from "@civitasone/db";
import { buildApp } from "../app.js";
import { sqlClient } from "../shared/db.js";
import { queue } from "../shared/infra.js";
import { registerLifecycleMutationConsumers } from "../modules/lifecycle/consumer.js";

// GAP-HR-RETIREMENT-01: buildApp() registers routes only -- the checklist
// toggle and issue-ppo commands are published to the queue and applied by
// this module's own consumer, which runs in a separate worker process in
// production (src/worker.ts). Registered here against the SAME global
// `queue` singleton routes.ts's commands.ts publishes to, same convention
// as medical-claims-real-db.test.ts's registerMedicalConsumers(queue) call.
registerLifecycleMutationConsumers(queue);

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

const TENANT      = "facade00-0f1d-4000-8000-000000000f1d";
const SEED_ACTOR   = "facade00-0f1d-4000-8000-0000000000ff";
const DEPT_ID      = "facade00-0f1d-4000-8000-0000000000d1";
const DESIG_ID     = "facade00-0f1d-4000-8000-0000000000d2";
const EMPLOYEE_ID  = "facade00-0f1d-4000-8000-0000000000e1";
const SEPARATION_ID = "facade00-0f1d-4000-8000-0000000000a1";

// GAP-HR-RETIREMENT-01's consumer writes msg.actorId (derived from the
// JWT's `sub`) directly into uuid columns (done_by, ppo_issued_by) --
// mirroring the already-production lifecycleSeparate consumer's
// createdBy/updatedBy: msg.actorId pattern -- so, unlike this repo's
// read-only-route test tokens, these subs must themselves be valid UUIDs.
const HR_OFFICER_SUB = "facade00-0f1d-4000-8000-0000000000f1";
const HR_ADMIN_SUB   = "facade00-0f1d-4000-8000-0000000000f2";

function tok(roles: string[], sub: string) {
  return signToken({ sub, tid: TENANT, roles, sid: "sess-sep-ppo-test" }, SECRET);
}
const hrOfficerToken = tok(["hr_officer"], HR_OFFICER_SUB);
const hrAdminToken   = tok(["hr_admin"], HR_ADMIN_SUB);

let app: Awaited<ReturnType<typeof buildApp>>;

function asTenant<T>(fn: (tx: typeof sqlClient) => Promise<T>): Promise<T> {
  return withRawTenantGuc(sqlClient, TENANT, fn);
}

async function cleanup(): Promise<void> {
  await asTenant((tx) => tx`DELETE FROM lifecycle.hrms_separation_checklist WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM lifecycle.hrms_separations WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_employees WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_designations WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_departments WHERE tenant_id = ${TENANT}`);
}

async function resetSeparation(): Promise<void> {
  await asTenant((tx) => tx`DELETE FROM lifecycle.hrms_separation_checklist WHERE tenant_id = ${TENANT} AND separation_id = ${SEPARATION_ID}`);
  await asTenant((tx) => tx`
    UPDATE lifecycle.hrms_separations SET ppo_issued_at = NULL, ppo_issued_by = NULL
    WHERE tenant_id = ${TENANT} AND id = ${SEPARATION_ID}
  `);
}

beforeAll(async () => {
  await cleanup();
  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_departments (id, tenant_id, code, name, created_by, updated_by)
    VALUES (${DEPT_ID}, ${TENANT}, 'SEPPPO', 'Separation PPO Test Dept', ${SEED_ACTOR}, ${SEED_ACTOR})
  `);
  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_designations (id, tenant_id, code, name, created_by, updated_by)
    VALUES (${DESIG_ID}, ${TENANT}, 'SEPPPO', 'Separation PPO Test Designation', ${SEED_ACTOR}, ${SEED_ACTOR})
  `);
  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_employees (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, created_by, updated_by)
    VALUES (${EMPLOYEE_ID}, ${TENANT}, 'SEPPPO-001', 'Separation PPO Test Employee', ${DEPT_ID}, ${DESIG_ID}, '1995-01-01', ${SEED_ACTOR}, ${SEED_ACTOR})
  `);
  await asTenant((tx) => tx`
    INSERT INTO lifecycle.hrms_separations
      (id, tenant_id, employee_id, separation_type, effective_date, status, created_by, updated_by)
    VALUES (${SEPARATION_ID}, ${TENANT}, ${EMPLOYEE_ID}, 'retirement', '2026-12-31', 'initiated', ${SEED_ACTOR}, ${SEED_ACTOR})
  `);
  app = await buildApp();
});

afterAll(async () => {
  await cleanup();
  await app.close();
  await sqlClient.end();
});

describe("PUT /v1/hrms/separations/:id/checklist", () => {
  it("persists a toggle and GET reflects it (was: pure client state, lost on reload)", async () => {
    await resetSeparation();
    const put = await app.inject({
      method: "PUT", url: `/v1/hrms/separations/${SEPARATION_ID}/checklist`,
      headers: { authorization: `Bearer ${hrOfficerToken}`, "content-type": "application/json" },
      payload: { stepId: "1", checkIndex: 0, done: true },
    });
    expect(put.statusCode).toBe(202);

    // The write is async (F3/queue) -- wait briefly for the consumer, same
    // tolerance this repo's other real-DB tests use for eventual writes.
    await new Promise((r) => setTimeout(r, 300));

    const get = await app.inject({
      method: "GET", url: `/v1/hrms/separations/${SEPARATION_ID}/checklist`,
      headers: { authorization: `Bearer ${hrOfficerToken}` },
    });
    expect(get.statusCode).toBe(200);
    const body = JSON.parse(get.body) as { data: Array<{ stepId: string; checkIndex: number; done: boolean }> };
    const row = body.data.find((r) => r.stepId === "1" && r.checkIndex === 0);
    expect(row?.done).toBe(true);
  });
});

describe("POST /v1/hrms/separations/:id/issue-ppo (GAP-HR-RETIREMENT-01)", () => {
  it("refuses when the checklist is incomplete", async () => {
    await resetSeparation();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/separations/${SEPARATION_ID}/issue-ppo`,
      headers: { authorization: `Bearer ${hrAdminToken}` },
    });
    expect(r.statusCode).toBe(409);
    expect(JSON.parse(r.body).code).toBe("CHECKLIST_INCOMPLETE");
  });

  it("refuses hr_officer -- gated to HR admin per the decision packet", async () => {
    await resetSeparation();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/separations/${SEPARATION_ID}/issue-ppo`,
      headers: { authorization: `Bearer ${hrOfficerToken}` },
    });
    expect(r.statusCode).toBe(403);
  });

  it("succeeds once all 25 items are done, and refuses further checklist edits afterward", async () => {
    await resetSeparation();
    for (const stepId of ["1", "2", "3", "4", "5"]) {
      for (let checkIndex = 0; checkIndex < 5; checkIndex++) {
        const put = await app.inject({
          method: "PUT", url: `/v1/hrms/separations/${SEPARATION_ID}/checklist`,
          headers: { authorization: `Bearer ${hrOfficerToken}`, "content-type": "application/json" },
          payload: { stepId, checkIndex, done: true },
        });
        expect(put.statusCode).toBe(202);
      }
    }
    await new Promise((r) => setTimeout(r, 400));

    const issue = await app.inject({
      method: "POST", url: `/v1/hrms/separations/${SEPARATION_ID}/issue-ppo`,
      headers: { authorization: `Bearer ${hrAdminToken}` },
    });
    expect(issue.statusCode).toBe(202);
    await new Promise((r) => setTimeout(r, 300));

    const rows = await asTenant((tx) => tx`SELECT ppo_issued_at, ppo_issued_by FROM lifecycle.hrms_separations WHERE id = ${SEPARATION_ID}`);
    expect(rows[0]?.ppo_issued_at).not.toBeNull();

    // Re-issuing is refused (irreversible, one-time action).
    const again = await app.inject({
      method: "POST", url: `/v1/hrms/separations/${SEPARATION_ID}/issue-ppo`,
      headers: { authorization: `Bearer ${hrAdminToken}` },
    });
    expect(again.statusCode).toBe(409);

    // The checklist is now a read-only historical record.
    const editAfter = await app.inject({
      method: "PUT", url: `/v1/hrms/separations/${SEPARATION_ID}/checklist`,
      headers: { authorization: `Bearer ${hrOfficerToken}`, "content-type": "application/json" },
      payload: { stepId: "1", checkIndex: 0, done: false },
    });
    expect(editAfter.statusCode).toBe(409);
    expect(JSON.parse(editAfter.body).code).toBe("PPO_ALREADY_ISSUED");
  });
});
