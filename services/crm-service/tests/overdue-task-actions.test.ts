/**
 * GAP-CRM-TASK-ESCALATION-06 — act on overdue tasks from the alerts list.
 *
 *  - GET /v1/crm/activities/overdue-tasks lists the tenant's overdue open
 *    tasks with an owner id. Previously no route served this: the web asked
 *    GET /v1/crm/activities?type=task&overdue=true, which 400s because that
 *    route requires subjectType+subjectId.
 *  - PATCH /v1/crm/activities/:id { ownerId, reason } reassigns. { dueDate,
 *    reason } snoozes. Both require a reason, and the reason is recorded on
 *    the audit event.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerAllConsumers } from "../src/consumers.js";
import { drainQueue } from "./consumer-harness.js";

// identity-service is a separate service: stub its "is this an active user of the tenant" answer.
vi.mock("../src/shared/identity-client.js", () => ({ isActiveTenantUser: vi.fn() }));
import { isActiveTenantUser } from "../src/shared/identity-client.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const ACTOR = randomUUID();
const NEW_OWNER = randomUUID();
const OVERDUE = randomUUID();
const FUTURE = randomUUID();
const DONE = randomUUID();
const REASON = "Original owner is on leave this week";

type Tx = Parameters<Parameters<typeof sqlClient.begin>[0]>[0];
function scoped<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    return fn(tx);
  }) as Promise<T>;
}

function headers(roles = ["crm_user"], sub = ACTOR): Record<string, string> {
  return {
    authorization: `Bearer ${signToken({ sub, tid: TENANT, roles, sid: "sess-overdue" }, SECRET)}`,
    "x-tenant-id": TENANT,
  };
}

const app = await buildApp();

beforeEach(() => {
  vi.mocked(isActiveTenantUser).mockReset();
  vi.mocked(isActiveTenantUser).mockResolvedValue(true);
});

beforeAll(async () => {
  await scoped(async (tx) => {
    for (const [id, due, status] of [
      [OVERDUE, "2020-01-01", "open"],
      [FUTURE, "2099-12-31", "open"],
      [DONE, "2020-01-01", "completed"],
    ] as const) {
      await tx`
        INSERT INTO crm.activities (id, tenant_id, actor_name, text, type, subject, status, due_date, created_by)
        VALUES (${id}, ${TENANT}, 'Tester', 'Call back the ward office', 'task', 'Call back', ${status}, ${due}, ${ACTOR})
      `;
    }
  });
  registerAllConsumers(queue);
  await queue.start();
});

afterAll(async () => {
  await drainQueue();
  await scoped(async (tx) => {
    await tx`DELETE FROM crm.activities WHERE tenant_id = ${TENANT}`;
    await tx`DELETE FROM _outbox.messages WHERE tenant_id = ${TENANT}`;
  }).catch(() => {});
  await app.close();
  await sqlClient.end();
});

describe("GAP-CRM-TASK-ESCALATION-06: overdue tasks list", () => {
  it("returns only open, past-due tasks with the owner id (creator by default)", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/crm/activities/overdue-tasks", headers: headers() });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.meta.total).toBe(1);
    expect(body.data.map((t: { id: string }) => t.id)).toEqual([OVERDUE]);
    expect(body.data[0].ownerId).toBe(ACTOR);
    expect(body.data[0].dueDate).toBe("2020-01-01");
  });

  it("is tenant-scoped", async () => {
    const other = {
      authorization: `Bearer ${signToken({ sub: ACTOR, tid: randomUUID(), roles: ["crm_user"], sid: "s2" }, SECRET)}`,
    };
    const res = await app.inject({ method: "GET", url: "/v1/crm/activities/overdue-tasks", headers: { ...other, "x-tenant-id": randomUUID() } });
    expect(res.statusCode).toBe(200);
    expect(res.json().meta.total).toBe(0);
  });
});

describe("GAP-CRM-TASK-ESCALATION-06: reassign and snooze", () => {
  it("rejects a reassign without a reason (400)", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/crm/activities/${OVERDUE}`, headers: headers(),
      payload: { ownerId: NEW_OWNER },
    });
    expect(res.statusCode).toBe(400);
  });

  it("reassigns the task and records the reason on the audit event", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/crm/activities/${OVERDUE}`, headers: headers(),
      payload: { ownerId: NEW_OWNER, reason: REASON },
    });
    expect(res.statusCode).toBe(202);
    await drainQueue();

    const list = await app.inject({ method: "GET", url: "/v1/crm/activities/overdue-tasks", headers: headers() });
    expect(list.json().data[0].ownerId).toBe(NEW_OWNER);

    const audits = await scoped((tx) => tx<Array<{ payload: Record<string, unknown> }>>`
      SELECT payload FROM _outbox.messages
      WHERE tenant_id = ${TENANT} AND event_type = 'audit.event.record' AND payload->>'resourceId' = ${OVERDUE}
    `);
    const reassign = audits.map((a) => a.payload).find((p) => p.action === "reassign");
    expect(reassign).toMatchObject({ action: "reassign", ownerId: NEW_OWNER, reason: REASON, resourceType: "activity" });
  });

  it("snoozes with a reason; the task leaves the overdue list", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/crm/activities/${OVERDUE}`, headers: headers(),
      payload: { dueDate: "2099-01-01", reason: "Citizen asked to call after the holiday" },
    });
    expect(res.statusCode).toBe(202);
    await drainQueue();
    const list = await app.inject({ method: "GET", url: "/v1/crm/activities/overdue-tasks", headers: headers() });
    expect(list.json().meta.total).toBe(0);
  });
});

describe("server-side validation of snooze and reassign", () => {
  const OTHER = randomUUID();

  it("rejects snoozing to a date in the past (400, field-level error)", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/crm/activities/${OVERDUE}`, headers: headers(),
      payload: { dueDate: "2020-01-02", reason: "Citizen asked to call after the holiday" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().fieldErrors).toEqual([expect.objectContaining({ field: "dueDate" })]);
  });

  it("accepts snoozing to today or later", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/crm/activities/${OVERDUE}`, headers: headers(),
      payload: { dueDate: "2099-06-01", reason: "Citizen asked to call after the holiday" },
    });
    expect(res.statusCode).toBe(202);
    await drainQueue();
  });

  it("rejects an owner that is not an active user of the tenant (422) and asks identity with the caller tenant", async () => {
    vi.mocked(isActiveTenantUser).mockResolvedValue(false);
    const res = await app.inject({
      method: "PATCH", url: `/v1/crm/activities/${OVERDUE}`, headers: headers(["crm_admin"]),
      payload: { ownerId: NEW_OWNER, reason: REASON },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("INVALID_OWNER");
    expect(isActiveTenantUser).toHaveBeenCalledWith(TENANT, NEW_OWNER);
  });

  it("fails closed (503) when identity-service cannot verify the owner", async () => {
    vi.mocked(isActiveTenantUser).mockResolvedValue(undefined);
    const res = await app.inject({
      method: "PATCH", url: `/v1/crm/activities/${OVERDUE}`, headers: headers(["crm_admin"]),
      payload: { ownerId: NEW_OWNER, reason: REASON },
    });
    expect(res.statusCode).toBe(503);
  });

  it("404s a reassign of an activity that does not exist in the tenant", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/crm/activities/${randomUUID()}`, headers: headers(["crm_admin"]),
      payload: { ownerId: NEW_OWNER, reason: REASON },
    });
    expect(res.statusCode).toBe(404);
  });

  it("403s a crm_user who does not own the task, and does not even ask identity", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/crm/activities/${FUTURE}`, headers: headers(["crm_user"], OTHER),
      payload: { ownerId: NEW_OWNER, reason: REASON },
    });
    expect(res.statusCode).toBe(403);
    expect(isActiveTenantUser).not.toHaveBeenCalled();
  });

  it("lets the owner reassign their own task", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/crm/activities/${FUTURE}`, headers: headers(["crm_user"], ACTOR),
      payload: { ownerId: NEW_OWNER, reason: REASON },
    });
    expect(res.statusCode).toBe(202);
    await drainQueue();
  });

  it("lets an admin reassign someone else's task", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/crm/activities/${DONE}`, headers: headers(["crm_admin"], OTHER),
      payload: { ownerId: NEW_OWNER, reason: REASON },
    });
    expect(res.statusCode).toBe(202);
    await drainQueue();
  });
});
