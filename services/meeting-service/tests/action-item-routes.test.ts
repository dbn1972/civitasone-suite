/**
 * action-item module — HTTP route tests (task 11.3) via `app.inject()`.
 *
 * Exercises all 11 action-item / ATR endpoints against a real Fastify app (buildApp) and a real
 * Postgres (civitas_meeting) with HS256 test JWTs (JWT_ALGORITHM=HS256, JWT_SECRET set in
 * vitest.config.ts). Every endpoint is covered for the mandated cases: happy path + 400
 * (validation / missing idempotency key) + 401 (unauthenticated) + 403 (forbidden) + 404
 * (not found).
 *
 * Writes assert 202 (queued via the in-memory queue; no worker runs, so the command is enqueued
 * but not consumed — exactly the boundary these tests assert). Reads assert 200 with the standard
 * `{ data }` envelope. Fixtures are seeded directly with the shared sql client under a dedicated
 * test tenant; the app resolves tenant scope from the JWT.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "a1a1a1a1-0000-4000-8000-0000000000a1";
const OTHER_TENANT = "a2a2a2a2-0000-4000-8000-0000000000a2";

const MEETING_ID = "b1b1b1b1-0000-4000-8000-000000000001";
const COMMITTEE_ID = "c1c1c1c1-0000-4000-8000-000000000001";
const ACTION_MINE = "d1d1d1d1-0000-4000-8000-000000000001"; // assignee == ACTOR, has progress
const ACTION_OVERDUE = "d1d1d1d1-0000-4000-8000-000000000002"; // deadline in the past, in_progress
const MEMBER_B = "e1e1e1e1-0000-4000-8000-000000000002";
const MISSING = "00000000-0000-4000-8000-0000000000ff";
const ACTOR = "99999999-0000-4000-8000-000000000001";

const IDEMPOTENCY = { "x-idempotency-key": "ai-test-key-0001" } as const;

function token(roles: string[], tid: string = TENANT) {
  return signToken({ sub: ACTOR, tid, roles, sid: "sess-1" }, SECRET);
}
function auth(roles: string[], tid: string = TENANT) {
  return { authorization: `Bearer ${token(roles, tid)}` };
}

let app: FastifyInstance;

beforeAll(async () => {
  // Idempotent seed: clear then insert the fixture graph for the test tenant.
  await sqlClient`DELETE FROM meeting.action_progress WHERE tenant_id = ${TENANT}`;
  await sqlClient`DELETE FROM meeting.action_items WHERE tenant_id = ${TENANT}`;
  await sqlClient`DELETE FROM meeting.meetings WHERE tenant_id = ${TENANT}`;
  await sqlClient`DELETE FROM meeting.committees WHERE tenant_id = ${TENANT}`;

  await sqlClient`
    INSERT INTO meeting.committees
      (id, tenant_id, name, code, type, constitution_date, quorum_rule, created_by, updated_by)
    VALUES (${COMMITTEE_ID}, ${TENANT}, 'Finance Committee', 'FC', 'finance', '2025-01-01',
            ${'{"minMembers":2}'}::jsonb, ${ACTOR}, ${ACTOR})`;

  // In-progress meeting with a past actual_start_at so assigned deadlines fall after the start (P19).
  await sqlClient`
    INSERT INTO meeting.meetings
      (id, tenant_id, type, title, status, committee_id, chairperson_id, secretary_id, financial_year,
       scheduled_at, actual_start_at, quorum_established, created_by, updated_by)
    VALUES (${MEETING_ID}, ${TENANT}, 'committee', 'Q1 Review', 'in_progress', ${COMMITTEE_ID}, ${ACTOR}, ${ACTOR},
            '2025-26', '2025-06-01T09:00:00Z', '2025-06-01T09:05:00Z', true, ${ACTOR}, ${ACTOR})`;

  // Action item assigned to the acting user — backs my / list / patch / acknowledge / progress /
  // evidence / verify / history.
  await sqlClient`
    INSERT INTO meeting.action_items
      (id, tenant_id, meeting_id, description, assignee_id, deadline, priority, status, created_by, updated_by)
    VALUES (${ACTION_MINE}, ${TENANT}, ${MEETING_ID}, 'Prepare vendor payment file', ${ACTOR},
            ${new Date(Date.now() + 7 * 86400000).toISOString()}, 'high', 'assigned', ${ACTOR}, ${ACTOR})`;

  // Overdue action item — deadline in the past, not settled.
  await sqlClient`
    INSERT INTO meeting.action_items
      (id, tenant_id, meeting_id, description, assignee_id, deadline, priority, status, created_by, updated_by)
    VALUES (${ACTION_OVERDUE}, ${TENANT}, ${MEETING_ID}, 'Submit compliance report', ${MEMBER_B},
            ${new Date(Date.now() - 3 * 86400000).toISOString()}, 'critical', 'in_progress', ${ACTOR}, ${ACTOR})`;

  await sqlClient`
    INSERT INTO meeting.action_progress
      (tenant_id, action_item_id, update_text, percentage, updated_by)
    VALUES (${TENANT}, ${ACTION_MINE}, 'Started drafting the payment file', 40, ${ACTOR})`;

  app = await buildApp();
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

// ─── POST /:meetingId/action-items (assign) ────────────────────────────────
describe("POST /v1/meetings/:meetingId/action-items", () => {
  const body = () => ({
    description: "Follow up on audit findings",
    assigneeId: MEMBER_B,
    deadline: new Date(Date.now() + 10 * 86400000).toISOString(),
    priority: "high",
  });

  it("202 accepts an assigned action item (secretary)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING_ID}/action-items`,
      headers: { ...auth(["committee_secretary"]), ...IDEMPOTENCY },
      payload: body(),
    });
    expect(res.statusCode).toBe(202);
    const json = res.json();
    expect(json.data.status).toBe("accepted");
    expect(typeof json.data.id).toBe("string");
  });

  it("400 on an invalid body (missing deadline)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING_ID}/action-items`,
      headers: { ...auth(["committee_secretary"]), ...IDEMPOTENCY },
      payload: { description: "x", assigneeId: MEMBER_B },
    });
    expect(res.statusCode).toBe(400);
  });

  it("400 when the X-Idempotency-Key header is missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING_ID}/action-items`,
      headers: auth(["committee_secretary"]),
      payload: body(),
    });
    expect(res.statusCode).toBe(400);
  });

  it("401 without a token", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING_ID}/action-items`,
      payload: body(),
    });
    expect(res.statusCode).toBe(401);
  });

  it("403 for a role without assign rights (member)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING_ID}/action-items`,
      headers: { ...auth(["committee_member"]), ...IDEMPOTENCY },
      payload: body(),
    });
    expect(res.statusCode).toBe(403);
  });

  it("404 when the meeting does not exist", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MISSING}/action-items`,
      headers: { ...auth(["committee_secretary"]), ...IDEMPOTENCY },
      payload: body(),
    });
    expect(res.statusCode).toBe(404);
  });
});

// ─── GET /:meetingId/action-items (list) ───────────────────────────────────
describe("GET /v1/meetings/:meetingId/action-items", () => {
  it("200 returns the meeting's action items (ISO timestamps)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/meetings/${MEETING_ID}/action-items`,
      headers: auth(["committee_member"]),
    });
    expect(res.statusCode).toBe(200);
    const rows = res.json().data as Array<{ id: string; deadline: string }>;
    const mine = rows.find((r) => r.id === ACTION_MINE);
    expect(mine).toBeTruthy();
    expect(typeof mine?.deadline).toBe("string");
  });

  it("400 on a non-uuid meetingId", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/meetings/not-a-uuid/action-items`,
      headers: auth(["committee_member"]),
    });
    expect(res.statusCode).toBe(400);
  });

  it("401 without a token", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/meetings/${MEETING_ID}/action-items` });
    expect(res.statusCode).toBe(401);
  });

  it("403 for an unknown role", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/meetings/${MEETING_ID}/action-items`,
      headers: auth(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });

  it("404 when the meeting does not exist", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/meetings/${MISSING}/action-items`,
      headers: auth(["committee_member"]),
    });
    expect(res.statusCode).toBe(404);
  });

  it("tenant isolation: another tenant sees the meeting as absent (404)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/meetings/${MEETING_ID}/action-items`,
      headers: auth(["committee_member"], OTHER_TENANT),
    });
    expect(res.statusCode).toBe(404);
  });
});

// ─── PATCH /action-items/:actionId (update) ────────────────────────────────
describe("PATCH /v1/meetings/action-items/:actionId", () => {
  it("202 accepts an optimistic-locked patch", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/meetings/action-items/${ACTION_MINE}`,
      headers: { ...auth(["meeting_admin"]), ...IDEMPOTENCY },
      payload: { version: 1, patch: { priority: "critical" } },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().data.id).toBe(ACTION_MINE);
  });

  it("400 on an empty patch", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/meetings/action-items/${ACTION_MINE}`,
      headers: { ...auth(["meeting_admin"]), ...IDEMPOTENCY },
      payload: { version: 1, patch: {} },
    });
    expect(res.statusCode).toBe(400);
  });

  it("400 when the X-Idempotency-Key header is missing", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/meetings/action-items/${ACTION_MINE}`,
      headers: auth(["meeting_admin"]),
      payload: { version: 1, patch: { priority: "low" } },
    });
    expect(res.statusCode).toBe(400);
  });

  it("401 without a token", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/meetings/action-items/${ACTION_MINE}`,
      payload: { version: 1, patch: { priority: "low" } },
    });
    expect(res.statusCode).toBe(401);
  });

  it("403 for a role without update rights (observer)", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/meetings/action-items/${ACTION_MINE}`,
      headers: { ...auth(["observer"]), ...IDEMPOTENCY },
      payload: { version: 1, patch: { priority: "low" } },
    });
    expect(res.statusCode).toBe(403);
  });

  it("404 when the action item does not exist", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/meetings/action-items/${MISSING}`,
      headers: { ...auth(["meeting_admin"]), ...IDEMPOTENCY },
      payload: { version: 1, patch: { priority: "low" } },
    });
    expect(res.statusCode).toBe(404);
  });
});

// ─── POST /action-items/:actionId/acknowledge ──────────────────────────────
describe("POST /v1/meetings/action-items/:actionId/acknowledge", () => {
  it("202 accepts an acknowledgement", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/action-items/${ACTION_MINE}/acknowledge`,
      headers: { ...auth(["committee_member"]), ...IDEMPOTENCY },
      payload: { version: 1 },
    });
    expect(res.statusCode).toBe(202);
  });

  it("400 on a missing version", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/action-items/${ACTION_MINE}/acknowledge`,
      headers: { ...auth(["committee_member"]), ...IDEMPOTENCY },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("400 when the X-Idempotency-Key header is missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/action-items/${ACTION_MINE}/acknowledge`,
      headers: auth(["committee_member"]),
      payload: { version: 1 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("401 without a token", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/action-items/${ACTION_MINE}/acknowledge`,
      payload: { version: 1 },
    });
    expect(res.statusCode).toBe(401);
  });

  it("403 for a role without assignee rights (citizen)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/action-items/${ACTION_MINE}/acknowledge`,
      headers: { ...auth(["citizen"]), ...IDEMPOTENCY },
      payload: { version: 1 },
    });
    expect(res.statusCode).toBe(403);
  });

  it("404 when the action item does not exist", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/action-items/${MISSING}/acknowledge`,
      headers: { ...auth(["committee_member"]), ...IDEMPOTENCY },
      payload: { version: 1 },
    });
    expect(res.statusCode).toBe(404);
  });
});

// ─── POST /action-items/:actionId/progress ─────────────────────────────────
describe("POST /v1/meetings/action-items/:actionId/progress", () => {
  const body = { updateText: "Halfway through the reconciliation", percentage: 50 };

  it("202 accepts a progress update", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/action-items/${ACTION_MINE}/progress`,
      headers: { ...auth(["committee_member"]), ...IDEMPOTENCY },
      payload: body,
    });
    expect(res.statusCode).toBe(202);
  });

  it("400 on an empty update text", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/action-items/${ACTION_MINE}/progress`,
      headers: { ...auth(["committee_member"]), ...IDEMPOTENCY },
      payload: { updateText: "" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("401 without a token", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/action-items/${ACTION_MINE}/progress`,
      payload: body,
    });
    expect(res.statusCode).toBe(401);
  });

  it("403 for an observer", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/action-items/${ACTION_MINE}/progress`,
      headers: { ...auth(["observer"]), ...IDEMPOTENCY },
      payload: body,
    });
    expect(res.statusCode).toBe(403);
  });

  it("404 when the action item does not exist", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/action-items/${MISSING}/progress`,
      headers: { ...auth(["committee_member"]), ...IDEMPOTENCY },
      payload: body,
    });
    expect(res.statusCode).toBe(404);
  });
});

// ─── POST /action-items/:actionId/evidence ─────────────────────────────────
describe("POST /v1/meetings/action-items/:actionId/evidence", () => {
  const body = { evidenceNote: "Uploaded the signed reconciliation statement" };

  it("202 accepts submitted evidence", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/action-items/${ACTION_MINE}/evidence`,
      headers: { ...auth(["committee_member"]), ...IDEMPOTENCY },
      payload: body,
    });
    expect(res.statusCode).toBe(202);
  });

  it("400 when neither evidenceUrl nor evidenceNote is present", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/action-items/${ACTION_MINE}/evidence`,
      headers: { ...auth(["committee_member"]), ...IDEMPOTENCY },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("401 without a token", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/action-items/${ACTION_MINE}/evidence`,
      payload: body,
    });
    expect(res.statusCode).toBe(401);
  });

  it("403 for an observer", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/action-items/${ACTION_MINE}/evidence`,
      headers: { ...auth(["observer"]), ...IDEMPOTENCY },
      payload: body,
    });
    expect(res.statusCode).toBe(403);
  });

  it("404 when the action item does not exist", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/action-items/${MISSING}/evidence`,
      headers: { ...auth(["committee_member"]), ...IDEMPOTENCY },
      payload: body,
    });
    expect(res.statusCode).toBe(404);
  });
});

// ─── POST /action-items/:actionId/verify ───────────────────────────────────
describe("POST /v1/meetings/action-items/:actionId/verify", () => {
  const body = { verifierId: ACTOR, verified: true };

  it("202 accepts a verification from the chairperson", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/action-items/${ACTION_MINE}/verify`,
      headers: { ...auth(["committee_chairperson"]), ...IDEMPOTENCY },
      payload: body,
    });
    expect(res.statusCode).toBe(202);
  });

  it("400 on a missing verified flag", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/action-items/${ACTION_MINE}/verify`,
      headers: { ...auth(["committee_chairperson"]), ...IDEMPOTENCY },
      payload: { verifierId: ACTOR },
    });
    expect(res.statusCode).toBe(400);
  });

  it("401 without a token", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/action-items/${ACTION_MINE}/verify`,
      payload: body,
    });
    expect(res.statusCode).toBe(401);
  });

  it("403 for a secretary (verify is chairperson-only)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/action-items/${ACTION_MINE}/verify`,
      headers: { ...auth(["committee_secretary"]), ...IDEMPOTENCY },
      payload: body,
    });
    expect(res.statusCode).toBe(403);
  });

  it("404 when the action item does not exist", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/action-items/${MISSING}/verify`,
      headers: { ...auth(["committee_chairperson"]), ...IDEMPOTENCY },
      payload: body,
    });
    expect(res.statusCode).toBe(404);
  });
});

// ─── GET /action-items/my ──────────────────────────────────────────────────
describe("GET /v1/meetings/action-items/my", () => {
  it("200 returns the acting user's assigned action items", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/meetings/action-items/my`,
      headers: auth(["committee_member"]),
    });
    expect(res.statusCode).toBe(200);
    const rows = res.json().data as Array<{ id: string; assigneeId: string }>;
    expect(rows.some((r) => r.id === ACTION_MINE)).toBe(true);
    expect(rows.every((r) => r.assigneeId === ACTOR)).toBe(true);
  });

  it("401 without a token", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/meetings/action-items/my` });
    expect(res.statusCode).toBe(401);
  });

  it("403 for an unknown role", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/meetings/action-items/my`,
      headers: auth(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });
});

// ─── GET /action-items/overdue ─────────────────────────────────────────────
describe("GET /v1/meetings/action-items/overdue", () => {
  it("200 lists overdue items (derived from deadline < now, not settled)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/meetings/action-items/overdue`,
      headers: auth(["meeting_admin"]),
    });
    expect(res.statusCode).toBe(200);
    const rows = res.json().data as Array<{ id: string }>;
    expect(rows.some((r) => r.id === ACTION_OVERDUE)).toBe(true);
    expect(rows.some((r) => r.id === ACTION_MINE)).toBe(false);
  });

  it("200 scoped to a committee", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/meetings/action-items/overdue?committeeId=${COMMITTEE_ID}`,
      headers: auth(["meeting_admin"]),
    });
    expect(res.statusCode).toBe(200);
    const rows = res.json().data as Array<{ id: string }>;
    expect(rows.some((r) => r.id === ACTION_OVERDUE)).toBe(true);
  });

  it("400 on a non-uuid committeeId filter", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/meetings/action-items/overdue?committeeId=not-a-uuid`,
      headers: auth(["meeting_admin"]),
    });
    expect(res.statusCode).toBe(400);
  });

  it("401 without a token", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/meetings/action-items/overdue` });
    expect(res.statusCode).toBe(401);
  });

  it("403 for an unknown role", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/meetings/action-items/overdue`,
      headers: auth(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });

  it("404 when the committee filter references an unknown committee", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/meetings/action-items/overdue?committeeId=${MISSING}`,
      headers: auth(["meeting_admin"]),
    });
    expect(res.statusCode).toBe(404);
  });
});

// ─── GET /committees/:committeeId/atr ──────────────────────────────────────
describe("GET /v1/meetings/committees/:committeeId/atr", () => {
  it("200 returns a compiled ATR with summary statistics", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/meetings/committees/${COMMITTEE_ID}/atr`,
      headers: auth(["meeting_admin"]),
    });
    expect(res.statusCode).toBe(200);
    const atr = res.json().data;
    expect(atr.committeeId).toBe(COMMITTEE_ID);
    expect(atr.statistics.total).toBeGreaterThanOrEqual(2);
    expect(atr.statistics).toHaveProperty("completedOnTime");
    expect(atr.statistics).toHaveProperty("overdue");
    expect(atr.statistics).toHaveProperty("compliancePct");
    expect(Array.isArray(atr.entries)).toBe(true);
    expect(Array.isArray(atr.perAssignee)).toBe(true);
  });

  it("200 honours the meetings window query", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/meetings/committees/${COMMITTEE_ID}/atr?meetings=1`,
      headers: auth(["meeting_admin"]),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.meetingWindow).toBe(1);
  });

  it("400 on a non-positive meetings window", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/meetings/committees/${COMMITTEE_ID}/atr?meetings=0`,
      headers: auth(["meeting_admin"]),
    });
    expect(res.statusCode).toBe(400);
  });

  it("401 without a token", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/meetings/committees/${COMMITTEE_ID}/atr` });
    expect(res.statusCode).toBe(401);
  });

  it("403 for an unknown role", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/meetings/committees/${COMMITTEE_ID}/atr`,
      headers: auth(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });

  it("404 when the committee does not exist", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/meetings/committees/${MISSING}/atr`,
      headers: auth(["meeting_admin"]),
    });
    expect(res.statusCode).toBe(404);
  });
});

// ─── GET /action-items/:actionId/history ───────────────────────────────────
describe("GET /v1/meetings/action-items/:actionId/history", () => {
  it("200 returns the append-only progress log", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/meetings/action-items/${ACTION_MINE}/history`,
      headers: auth(["committee_member"]),
    });
    expect(res.statusCode).toBe(200);
    const rows = res.json().data as Array<{ actionItemId: string; percentage: number }>;
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0]?.actionItemId).toBe(ACTION_MINE);
  });

  it("401 without a token", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/meetings/action-items/${ACTION_MINE}/history`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("403 for an unknown role", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/meetings/action-items/${ACTION_MINE}/history`,
      headers: auth(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });

  it("404 when the action item does not exist", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/meetings/action-items/${MISSING}/history`,
      headers: auth(["committee_member"]),
    });
    expect(res.statusCode).toBe(404);
  });
});
