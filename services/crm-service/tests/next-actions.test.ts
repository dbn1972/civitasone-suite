/**
 * Mandatory next-action tests (AC-002).
 * Covers create/list/overdue/complete plus the compliance report that names the
 * active leads and open deals with no open next step.
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { requiresNextAction, isOverdue } from "../src/modules/activities/next-action-domain.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000063";
const ACTOR = "cccccccc-3333-4000-8000-000000000063";
const NONEXIST = "ffffffff-ffff-4000-8000-000000000063";

const LEAD_OPEN = "11111111-6300-4000-8000-000000000001";
const LEAD_CONVERTED = "11111111-6300-4000-8000-000000000002";
const DEAL_OPEN = "22222222-6300-4000-8000-000000000001";
const DEAL_WON = "22222222-6300-4000-8000-000000000002";

function token(roles = ["crm_user"], tenantId = TENANT) {
  return signToken({ sub: ACTOR, tid: tenantId, roles, sid: "sess-next" }, SECRET);
}

function headers(roles = ["crm_user"]) {
  return { authorization: `Bearer ${token(roles)}`, "x-tenant-id": TENANT };
}

function inHours(hours: number): string {
  return new Date(Date.now() + hours * 3_600_000).toISOString();
}

async function seed(): Promise<void> {
  await sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    await tx`
      INSERT INTO crm.contacts (id, tenant_id, name, lead_status, status, version, created_at, updated_at, created_by, updated_by)
      VALUES
        (${LEAD_OPEN}, ${TENANT}, 'Open Lead', 'qualified', 'active', 1, now(), now(), ${ACTOR}, ${ACTOR}),
        (${LEAD_CONVERTED}, ${TENANT}, 'Converted Lead', 'converted', 'active', 1, now(), now(), ${ACTOR}, ${ACTOR})
      ON CONFLICT (id) DO NOTHING
    `;
    await tx`
      INSERT INTO crm.deals (id, tenant_id, name, stage, value_minor, currency, status, version, created_at, updated_at, created_by, updated_by)
      VALUES
        (${DEAL_OPEN}, ${TENANT}, 'Open Deal', 'Negotiation', 100000, 'INR', 'active', 1, now(), now(), ${ACTOR}, ${ACTOR}),
        (${DEAL_WON}, ${TENANT}, 'Won Deal', 'Won', 200000, 'INR', 'active', 1, now(), now(), ${ACTOR}, ${ACTOR})
      ON CONFLICT (id) DO NOTHING
    `;
  });
}

async function cleanup(): Promise<void> {
  await sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    await tx`DELETE FROM crm.next_actions WHERE tenant_id = ${TENANT}`.catch(() => {});
    await tx`DELETE FROM crm.deals WHERE tenant_id = ${TENANT}`.catch(() => {});
    await tx`DELETE FROM crm.contacts WHERE tenant_id = ${TENANT}`.catch(() => {});
  }).catch(() => {});
}

beforeAll(async () => {
  await cleanup();
  await seed();
});

afterAll(async () => {
  await cleanup();
  await sqlClient.end();
});

async function createAction(payload: Record<string, unknown>, roles = ["crm_user"]) {
  const app = await buildApp();
  const res = await app.inject({
    method: "POST",
    url: "/v1/crm/next-actions",
    headers: headers(roles),
    payload,
  });
  await app.close();
  return res;
}

describe("next-action-domain (pure)", () => {
  it("requires a next action on open statuses", () => {
    expect(requiresNextAction("new")).toBe(true);
    expect(requiresNextAction("qualified")).toBe(true);
    expect(requiresNextAction("nurture")).toBe(true);
    expect(requiresNextAction("Negotiation")).toBe(true);
  });

  it("exempts closed and inactive statuses", () => {
    expect(requiresNextAction("Won")).toBe(false);
    expect(requiresNextAction("lost")).toBe(false);
    expect(requiresNextAction("converted")).toBe(false);
    expect(requiresNextAction("disqualified")).toBe(false);
    expect(requiresNextAction(null)).toBe(false);
    expect(requiresNextAction("")).toBe(false);
    expect(requiresNextAction("   ")).toBe(false);
  });

  it("detects overdue dates against an injected now", () => {
    const now = new Date("2026-03-01T00:00:00Z");
    expect(isOverdue(new Date("2026-02-28T23:59:00Z"), now)).toBe(true);
    expect(isOverdue("2026-03-02T00:00:00Z", now)).toBe(false);
    expect(isOverdue(now, now)).toBe(false);
    expect(isOverdue("not-a-date", now)).toBe(false);
  });
});

describe("POST /v1/crm/next-actions", () => {
  it("creates an action → 201", async () => {
    const res = await createAction({
      subjectType: "contact",
      subjectId: LEAD_OPEN,
      actionType: "call",
      dueAt: inHours(24),
      notes: "Discovery call",
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().data.completedAt).toBeNull();
    expect(res.json().data.subjectType).toBe("contact");
  });

  it("rejects an unknown subjectType → 400", async () => {
    const res = await createAction({
      subjectType: "account",
      subjectId: LEAD_OPEN,
      actionType: "call",
      dueAt: inHours(24),
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a missing dueAt → 400", async () => {
    const res = await createAction({ subjectType: "deal", subjectId: DEAL_OPEN, actionType: "call" });
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/next-actions",
      payload: { subjectType: "deal", subjectId: DEAL_OPEN, actionType: "call", dueAt: inHours(1) },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for an unrelated role", async () => {
    const res = await createAction(
      { subjectType: "deal", subjectId: DEAL_OPEN, actionType: "call", dueAt: inHours(1) },
      ["citizen"],
    );
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/crm/next-actions", () => {
  it("lists with the envelope and an overdue flag", async () => {
    await createAction({
      subjectType: "deal",
      subjectId: DEAL_OPEN,
      actionType: "email",
      dueAt: inHours(-48),
    });

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/crm/next-actions", headers: headers() });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json().meta.total).toBeGreaterThanOrEqual(2);
    const overdueRow = res.json().data.find((r: { overdue: boolean }) => r.overdue === true);
    expect(overdueRow).toBeDefined();
  });

  it("filters by subject", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/crm/next-actions?subjectType=deal&subjectId=${DEAL_OPEN}`,
      headers: headers(),
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    for (const row of res.json().data) {
      expect(row.subjectType).toBe("deal");
      expect(row.subjectId).toBe(DEAL_OPEN);
    }
  });

  it("filters to overdue only", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/next-actions?overdue=true",
      headers: headers(),
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json().data.length).toBeGreaterThanOrEqual(1);
    for (const row of res.json().data) {
      expect(row.overdue).toBe(true);
    }
  });

  it("rejects a bad overdue value → 400", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/next-actions?overdue=yes",
      headers: headers(),
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/crm/next-actions" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
});

describe("GET /v1/crm/next-actions/compliance", () => {
  it("names only the subjects that need a next step and lack one", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/next-actions/compliance",
      headers: headers(),
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const ids = res.json().data.map((r: { subjectId: string }) => r.subjectId);
    // LEAD_OPEN and DEAL_OPEN already have open actions from earlier tests.
    expect(ids).not.toContain(LEAD_OPEN);
    expect(ids).not.toContain(DEAL_OPEN);
    // Converted leads and won deals are exempt by policy.
    expect(ids).not.toContain(LEAD_CONVERTED);
    expect(ids).not.toContain(DEAL_WON);
    expect(res.json().meta.missingByType).toBeDefined();
  });

  it("reports a subject once its only open action is completed", async () => {
    const created = await createAction({
      subjectType: "contact",
      subjectId: LEAD_CONVERTED,
      actionType: "call",
      dueAt: inHours(5),
    });
    expect(created.statusCode).toBe(201);

    // A fresh contact with an open status and no action must appear.
    const NEW_LEAD = "11111111-6300-4000-8000-000000000003";
    await sqlClient.begin(async (tx) => {
      await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
      await tx`
        INSERT INTO crm.contacts (id, tenant_id, name, lead_status, status, version, created_at, updated_at, created_by, updated_by)
        VALUES (${NEW_LEAD}, ${TENANT}, 'Neglected Lead', 'new', 'active', 1, now(), now(), ${ACTOR}, ${ACTOR})
        ON CONFLICT (id) DO NOTHING
      `;
    });

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/next-actions/compliance",
      headers: headers(),
    });
    await app.close();

    const ids = res.json().data.map((r: { subjectId: string }) => r.subjectId);
    expect(ids).toContain(NEW_LEAD);
    expect(res.json().meta.missingByType.contact).toBeGreaterThanOrEqual(1);
  });

  it("rejects an over-large limit → 400", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/next-actions/compliance?limit=9999",
      headers: headers(),
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/crm/next-actions/compliance" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for an unrelated role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/next-actions/compliance",
      headers: headers(["citizen"]),
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

describe("POST /v1/crm/next-actions/:id/complete", () => {
  it("completes an open action → 200", async () => {
    const created = await createAction({
      subjectType: "deal",
      subjectId: DEAL_OPEN,
      actionType: "meeting",
      dueAt: inHours(12),
    });
    const id = created.json().data.id;

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/crm/next-actions/${id}/complete`,
      headers: headers(),
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json().data.completedAt).toBeTruthy();
    expect(res.json().data.version).toBe(2);
  });

  it("refuses to complete twice → 422", async () => {
    const created = await createAction({
      subjectType: "deal",
      subjectId: DEAL_OPEN,
      actionType: "meeting",
      dueAt: inHours(12),
    });
    const id = created.json().data.id;

    const app = await buildApp();
    await app.inject({ method: "POST", url: `/v1/crm/next-actions/${id}/complete`, headers: headers() });
    const again = await app.inject({
      method: "POST",
      url: `/v1/crm/next-actions/${id}/complete`,
      headers: headers(),
    });
    await app.close();

    expect(again.statusCode).toBe(422);
    expect(again.json().code).toBe("ALREADY_COMPLETED");
  });

  it("returns 404 for an unknown action", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/crm/next-actions/${NONEXIST}/complete`,
      headers: headers(),
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("returns 400 for a non-uuid id", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/next-actions/not-a-uuid/complete",
      headers: headers(),
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: `/v1/crm/next-actions/${NONEXIST}/complete` });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
});
