/**
 * Recurring task + escalation tests (AC-005).
 * The pure recurrence maths is exercised directly (month-end rollover, leap
 * years, DST-agnostic UTC behaviour) and through the /run endpoint.
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { nextOccurrence, shouldEscalate, isCadence } from "../src/modules/activities/recurrence-domain.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000065";
const ACTOR = "cccccccc-3333-4000-8000-000000000065";
const SUBJECT = "11111111-6500-4000-8000-000000000001";
const NONEXIST = "ffffffff-ffff-4000-8000-000000000065";

function token(roles = ["crm_user"], tenantId = TENANT) {
  return signToken({ sub: ACTOR, tid: tenantId, roles, sid: "sess-recurring" }, SECRET);
}

function headers(roles = ["crm_user"]) {
  return { authorization: `Bearer ${token(roles)}`, "x-tenant-id": TENANT };
}

function inHours(hours: number): string {
  return new Date(Date.now() + hours * 3_600_000).toISOString();
}

async function cleanup(): Promise<void> {
  await sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    await tx`DELETE FROM crm.next_actions WHERE tenant_id = ${TENANT}`.catch(() => {});
    await tx`DELETE FROM crm.recurring_tasks WHERE tenant_id = ${TENANT}`.catch(() => {});
  }).catch(() => {});
}

beforeAll(cleanup);

afterAll(async () => {
  await cleanup();
  await sqlClient.end();
});

async function createTask(payload: Record<string, unknown>, roles = ["crm_user"]) {
  const app = await buildApp();
  const res = await app.inject({
    method: "POST",
    url: "/v1/crm/recurring-tasks",
    headers: headers(roles),
    payload,
  });
  await app.close();
  return res;
}

describe("recurrence-domain — nextOccurrence (pure)", () => {
  it("adds exactly 24h for daily, in UTC", () => {
    const from = new Date("2026-03-28T22:30:00.000Z");
    expect(nextOccurrence("daily", from).toISOString()).toBe("2026-03-29T22:30:00.000Z");
  });

  it("adds exactly 7 days for weekly", () => {
    expect(nextOccurrence("weekly", new Date("2026-01-01T09:00:00.000Z")).toISOString())
      .toBe("2026-01-08T09:00:00.000Z");
  });

  it("clamps Jan 31 + monthly to the end of February", () => {
    // 2026 is not a leap year → 28 Feb, not 3 March.
    expect(nextOccurrence("monthly", new Date("2026-01-31T10:00:00.000Z")).toISOString())
      .toBe("2026-02-28T10:00:00.000Z");
  });

  it("clamps Jan 31 + monthly to Feb 29 in a leap year", () => {
    expect(nextOccurrence("monthly", new Date("2028-01-31T10:00:00.000Z")).toISOString())
      .toBe("2028-02-29T10:00:00.000Z");
  });

  it("rolls the year over for a December monthly", () => {
    expect(nextOccurrence("monthly", new Date("2026-12-15T00:00:00.000Z")).toISOString())
      .toBe("2027-01-15T00:00:00.000Z");
  });

  it("clamps quarterly month-ends too", () => {
    // 30 Nov + 3 months = 28 Feb (Feb has no 30th).
    expect(nextOccurrence("quarterly", new Date("2026-11-30T08:00:00.000Z")).toISOString())
      .toBe("2027-02-28T08:00:00.000Z");
  });

  it("keeps the wall-clock time across a DST boundary (UTC maths)", () => {
    // Northern-hemisphere DST starts on 2026-03-29 in the EU; UTC is unaffected.
    const before = new Date("2026-03-28T01:00:00.000Z");
    expect(nextOccurrence("daily", before).toISOString()).toBe("2026-03-29T01:00:00.000Z");
    expect(nextOccurrence("monthly", before).toISOString()).toBe("2026-04-28T01:00:00.000Z");
  });

  it("accepts an ISO string and rejects garbage", () => {
    expect(nextOccurrence("daily", "2026-05-01T00:00:00.000Z").toISOString())
      .toBe("2026-05-02T00:00:00.000Z");
    expect(() => nextOccurrence("daily", "not-a-date")).toThrow(RangeError);
  });

  it("validates cadence names", () => {
    expect(isCadence("monthly")).toBe(true);
    expect(isCadence("fortnightly")).toBe(false);
  });
});

describe("recurrence-domain — shouldEscalate (pure)", () => {
  const due = new Date("2026-01-01T00:00:00.000Z");

  it("escalates once the window has elapsed", () => {
    expect(shouldEscalate(due, 24, new Date("2026-01-02T00:00:00.000Z"))).toBe(true);
    expect(shouldEscalate(due, 24, new Date("2026-01-02T00:00:01.000Z"))).toBe(true);
  });

  it("does not escalate inside the window", () => {
    expect(shouldEscalate(due, 24, new Date("2026-01-01T23:59:00.000Z"))).toBe(false);
  });

  it("treats a missing or non-positive window as disabled", () => {
    expect(shouldEscalate(due, null, new Date("2027-01-01T00:00:00.000Z"))).toBe(false);
    expect(shouldEscalate(due, undefined, new Date("2027-01-01T00:00:00.000Z"))).toBe(false);
    expect(shouldEscalate(due, 0, new Date("2027-01-01T00:00:00.000Z"))).toBe(false);
    expect(shouldEscalate(due, -5, new Date("2027-01-01T00:00:00.000Z"))).toBe(false);
  });

  it("returns false for an unparseable due date", () => {
    expect(shouldEscalate("nonsense", 1, new Date())).toBe(false);
  });
});

describe("POST /v1/crm/recurring-tasks", () => {
  it("creates a definition → 201", async () => {
    const res = await createTask({
      name: "Monthly check-in",
      subjectType: "contact",
      subjectId: SUBJECT,
      cadence: "monthly",
      nextRunAt: inHours(-1),
      escalateAfterHours: 24,
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().data.cadence).toBe("monthly");
    expect(res.json().data.enabled).toBe(true);
    expect(res.json().data.lastRunAt).toBeNull();
  });

  it("rejects an unknown cadence → 400", async () => {
    const res = await createTask({
      name: "Bad cadence",
      subjectType: "contact",
      subjectId: SUBJECT,
      cadence: "fortnightly",
      nextRunAt: inHours(1),
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a missing nextRunAt → 400", async () => {
    const res = await createTask({
      name: "No schedule",
      subjectType: "contact",
      subjectId: SUBJECT,
      cadence: "daily",
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/recurring-tasks",
      payload: { name: "x", subjectType: "contact", subjectId: SUBJECT, cadence: "daily", nextRunAt: inHours(1) },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for an unrelated role", async () => {
    const res = await createTask(
      { name: "x", subjectType: "contact", subjectId: SUBJECT, cadence: "daily", nextRunAt: inHours(1) },
      ["citizen"],
    );
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/crm/recurring-tasks", () => {
  it("lists definitions with the envelope", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/crm/recurring-tasks", headers: headers() });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().meta.total).toBeGreaterThanOrEqual(1);
  });

  it("filters by cadence, subject and enabled", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/crm/recurring-tasks?cadence=monthly&subjectType=contact&subjectId=${SUBJECT}&enabled=true`,
      headers: headers(),
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    for (const row of res.json().data) {
      expect(row.cadence).toBe("monthly");
      expect(row.enabled).toBe(true);
    }
  });

  it("rejects a bad enabled value → 400", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/recurring-tasks?enabled=maybe",
      headers: headers(),
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/crm/recurring-tasks" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
});

describe("GET /v1/crm/recurring-tasks/due", () => {
  it("lists due definitions with an escalate flag", async () => {
    await createTask({
      name: "Overdue weekly",
      subjectType: "deal",
      subjectId: SUBJECT,
      cadence: "weekly",
      nextRunAt: inHours(-72),
      escalateAfterHours: 24,
    });

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/recurring-tasks/due",
      headers: headers(),
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const escalating = res.json().data.filter((r: { escalate: boolean }) => r.escalate === true);
    expect(escalating.length).toBeGreaterThanOrEqual(1);
  });

  it("excludes future definitions", async () => {
    await createTask({
      name: "Future daily",
      subjectType: "deal",
      subjectId: SUBJECT,
      cadence: "daily",
      nextRunAt: inHours(48),
    });

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/recurring-tasks/due",
      headers: headers(),
    });
    await app.close();

    const names = res.json().data.map((r: { name: string }) => r.name);
    expect(names).not.toContain("Future daily");
  });

  it("returns 401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/crm/recurring-tasks/due" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
});

describe("PATCH /v1/crm/recurring-tasks/:id", () => {
  it("amends cadence and disables → 200", async () => {
    const created = await createTask({
      name: "Patch me",
      subjectType: "contact",
      subjectId: SUBJECT,
      cadence: "daily",
      nextRunAt: inHours(5),
    });
    const id = created.json().data.id;

    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/crm/recurring-tasks/${id}`,
      headers: headers(),
      payload: { cadence: "quarterly", enabled: false, version: 1 },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json().data.version).toBe(2);
  });

  it("returns 409 on a stale version", async () => {
    const created = await createTask({
      name: "Stale",
      subjectType: "contact",
      subjectId: SUBJECT,
      cadence: "daily",
      nextRunAt: inHours(5),
    });
    const id = created.json().data.id;

    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/crm/recurring-tasks/${id}`,
      headers: headers(),
      payload: { enabled: false, version: 77 },
    });
    await app.close();
    expect(res.statusCode).toBe(409);
  });

  it("rejects an empty patch → 400", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/crm/recurring-tasks/${NONEXIST}`,
      headers: headers(),
      payload: {},
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 404 for an unknown definition", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/crm/recurring-tasks/${NONEXIST}`,
      headers: headers(),
      payload: { enabled: false },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("returns 401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/crm/recurring-tasks/${NONEXIST}`,
      payload: { enabled: false },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
});

describe("POST /v1/crm/recurring-tasks/:id/run", () => {
  it("materialises the occurrence and advances the schedule → 201", async () => {
    const dueAt = "2026-01-31T10:00:00.000Z";
    const created = await createTask({
      name: "Month-end review",
      subjectType: "contact",
      subjectId: SUBJECT,
      cadence: "monthly",
      nextRunAt: dueAt,
    });
    const id = created.json().data.id;

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/crm/recurring-tasks/${id}/run`,
      headers: headers(),
    });
    await app.close();

    expect(res.statusCode).toBe(201);
    const d = res.json().data;
    expect(d.dueAt).toBe(dueAt);
    // Month-end rollover through the endpoint, not just the unit test.
    expect(d.nextRunAt).toBe("2026-02-28T10:00:00.000Z");
    expect(d.materialisedActionId).toBeDefined();

    const actions = await sqlClient.begin(async (tx) => {
      await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
      return tx`
        SELECT action_type, subject_id FROM crm.next_actions
        WHERE tenant_id = ${TENANT} AND id = ${d.materialisedActionId}
      `;
    });
    expect(actions[0]?.action_type).toBe("recurring_followup");
    expect(actions[0]?.subject_id).toBe(SUBJECT);
  });

  it("refuses to run a disabled definition → 422", async () => {
    const created = await createTask({
      name: "Disabled",
      subjectType: "contact",
      subjectId: SUBJECT,
      cadence: "daily",
      nextRunAt: inHours(-1),
      enabled: false,
    });
    const id = created.json().data.id;

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/crm/recurring-tasks/${id}/run`,
      headers: headers(),
    });
    await app.close();

    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("TASK_DISABLED");
  });

  it("returns 404 for an unknown definition", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/crm/recurring-tasks/${NONEXIST}/run`,
      headers: headers(),
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("returns 400 for a non-uuid id", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/recurring-tasks/not-a-uuid/run",
      headers: headers(),
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: `/v1/crm/recurring-tasks/${NONEXIST}/run` });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for an unrelated role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/crm/recurring-tasks/${NONEXIST}/run`,
      headers: headers(["citizen"]),
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});
