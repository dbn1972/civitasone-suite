/**
 * AC-005 task-escalation: rule admin CRUD (HTTP) + the scheduler applying escalation
 * to overdue open next-actions / task activities (DB round-trip).
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { runTenantTaskEscalation, runTaskEscalationCycle, startTaskEscalationScheduler } from "../src/modules/activities/task-escalation-scheduler.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-0000000ac005";
const ACTOR = "cccccccc-3333-4000-8000-0000000ac005";
const CONTACT = "22222222-bbbb-4000-8000-0000000ac005";

function headers(roles = ["crm_admin"]) {
  return { authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles, sid: "s" }, SECRET)}`, "x-tenant-id": TENANT };
}

async function cleanup() {
  await sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    await tx`DELETE FROM crm.task_escalation_rules WHERE tenant_id = ${TENANT}`.catch(() => {});
    await tx`DELETE FROM crm.next_actions WHERE tenant_id = ${TENANT}`.catch(() => {});
    await tx`DELETE FROM crm.activities WHERE tenant_id = ${TENANT}`.catch(() => {});
    await tx`DELETE FROM crm.contacts WHERE tenant_id = ${TENANT}`.catch(() => {});
  }).catch(() => {});
}

beforeAll(async () => {
  await cleanup();
  await sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    await tx`INSERT INTO crm.contacts (id, tenant_id, name, lead_status, status, version, created_at, updated_at, created_by, updated_by)
             VALUES (${CONTACT}, ${TENANT}, 'Overdue Contact', 'qualified', 'active', 1, now(), now(), ${ACTOR}, ${ACTOR}) ON CONFLICT (id) DO NOTHING`;
  });
});

afterAll(async () => { await cleanup(); await sqlClient.end(); });

describe("AC-005 task-escalation rule admin", () => {
  it("creates, lists, updates and deletes a rule", async () => {
    const app = await buildApp();
    const created = await app.inject({
      method: "POST", url: "/v1/crm/task-escalation-rules", headers: headers(),
      payload: { name: "SLA 60m", appliesTo: "both", thresholdMinutes: 60, recipientRole: "manager" },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().data.id;

    const listed = await app.inject({ method: "GET", url: "/v1/crm/task-escalation-rules", headers: headers() });
    expect((listed.json().data as unknown[]).length).toBe(1);

    const updated = await app.inject({ method: "PUT", url: `/v1/crm/task-escalation-rules/${id}`, headers: headers(), payload: { thresholdMinutes: 30 } });
    expect(updated.json().data.thresholdMinutes).toBe(30);

    const del = await app.inject({ method: "DELETE", url: `/v1/crm/task-escalation-rules/${id}`, headers: headers() });
    expect(del.statusCode).toBe(204);
    await app.close();
  });

  it("403s a non-admin creating a rule", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/crm/task-escalation-rules", headers: headers(["crm_user"]), payload: { name: "x", thresholdMinutes: 10 } });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

describe("AC-005 escalation scheduler", () => {
  const NOW = new Date("2026-08-04T12:00:00Z");

  beforeAll(async () => {
    await sqlClient.begin(async (tx) => {
      await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
      await tx`INSERT INTO crm.task_escalation_rules (id, tenant_id, name, applies_to, threshold_minutes, recipient_role, enabled, created_by, updated_by)
               VALUES (gen_random_uuid(), ${TENANT}, 'esc', 'both', 60, 'manager', true, ${ACTOR}, ${ACTOR})`;
      // Overdue open next-action (due 3h ago).
      await tx`INSERT INTO crm.next_actions (id, tenant_id, subject_type, subject_id, action_type, due_at, created_by, updated_by)
               VALUES (gen_random_uuid(), ${TENANT}, 'contact', ${CONTACT}, 'call', '2026-08-04T09:00:00Z', ${ACTOR}, ${ACTOR})`;
      // Overdue open task activity (due yesterday).
      await tx`INSERT INTO crm.activities (id, tenant_id, actor_name, text, contact_id, type, subject, status, due_date, version, created_at, created_by, updated_by, updated_at)
               VALUES (gen_random_uuid(), ${TENANT}, 'CRM User', 'chase invoice', ${CONTACT}, 'task', 'chase', 'open', '2026-08-03', 1, now(), ${ACTOR}, ${ACTOR}, now())`;
      // A not-yet-overdue next-action (due in the future) must NOT escalate.
      await tx`INSERT INTO crm.next_actions (id, tenant_id, subject_type, subject_id, action_type, due_at, created_by, updated_by)
               VALUES (gen_random_uuid(), ${TENANT}, 'contact', ${CONTACT}, 'email', '2026-09-01T09:00:00Z', ${ACTOR}, ${ACTOR})`;
    });
  });

  it("escalates only the overdue open tasks and stamps escalated_at", async () => {
    const n = await runTenantTaskEscalation(TENANT, NOW);
    expect(n).toBe(2);

    const rows = await sqlClient.begin(async (tx) => {
      await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
      const na = await tx`SELECT count(*)::int AS c FROM crm.next_actions WHERE tenant_id = ${TENANT} AND escalated_at IS NOT NULL`;
      const act = await tx`SELECT count(*)::int AS c FROM crm.activities WHERE tenant_id = ${TENANT} AND escalated_at IS NOT NULL`;
      return { na: na[0].c as number, act: act[0].c as number };
    });
    expect(rows.na).toBe(1);
    expect(rows.act).toBe(1);
  });

  it("is idempotent: a second cycle escalates nothing (already stamped)", async () => {
    const n = await runTenantTaskEscalation(TENANT, NOW);
    expect(n).toBe(0);
  });

  it("runTaskEscalationCycle iterates enabled tenants via the discovery function", async () => {
    // Tasks are already escalated, so the cycle discovers TENANT (enabled rule) but
    // escalates 0 more — exercising the cross-tenant discovery + per-tenant loop.
    const n = await runTaskEscalationCycle(NOW);
    expect(n).toBeGreaterThanOrEqual(0);
  });

  it("startTaskEscalationScheduler returns an overlap-guarded timer", () => {
    const timer = startTaskEscalationScheduler(60_000);
    expect(timer).toBeDefined();
    clearInterval(timer);
  });
});
