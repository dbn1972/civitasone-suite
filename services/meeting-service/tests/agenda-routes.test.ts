/**
 * Agenda module — HTTP route tests (task 5.3 coverage companion) via `app.inject()`.
 *
 * Exercises the 10 agenda endpoints across the mandated axes: happy path (202/200) + 400
 * (validation) + 401 (unauthenticated) + 403 (wrong role) + 404 (unknown meeting / item).
 *
 * Auth: HS256 test bypass (JWT_ALGORITHM=HS256, JWT_SECRET from vitest.config.ts).
 * Data: a scheduled meeting + one seeded agenda item are inserted directly (RLS-aware, the
 * `app.tenant_id` GUC is set inside the seed transaction) and torn down afterwards. Writes are CQRS
 * (publish → 202) against the in-memory queue; no worker runs, so a command is enqueued but not
 * consumed — exactly the boundary these tests assert. The agenda routes do NOT require an
 * X-Idempotency-Key header (unlike calendar), so none is sent.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-cafe-4a1a-9b2c-000000000503";
const MEETING = "cccccccc-cafe-4a1a-9b2c-000000000503";
const MISSING_MEETING = "dddddddd-cafe-4a1a-9b2c-000000000503";
const ITEM = "11111111-cafe-4a1a-9b2c-000000000503";
const MISSING_ITEM = "99999999-cafe-4a1a-9b2c-000000000503";
const ACTOR = "0a000000-cafe-4a1a-9b2c-000000000503";

const FUTURE = "2035-05-20T10:00:00.000Z";

function token(roles: string[] = ["committee_secretary"], tid: string = TENANT): string {
  return signToken({ sub: ACTOR, tid, roles, sid: "sess-0503" }, SECRET);
}

let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`
      insert into meeting.meetings
        (id, tenant_id, type, title, status, scheduled_at, duration_minutes, created_by, updated_by)
      values (${MEETING}, ${TENANT}, 'committee', 'Agenda Routes', 'scheduled', ${FUTURE}, 60, ${ACTOR}, ${ACTOR})
      on conflict (id) do nothing`;
    await sql`
      insert into meeting.agenda_items
        (id, tenant_id, meeting_id, sequence, title, outcome_type, category, status, created_by, updated_by)
      values (${ITEM}, ${TENANT}, ${MEETING}, 1, 'Seed item', 'discussion', 'standing', 'proposed', ${ACTOR}, ${ACTOR})
      on conflict (id) do nothing`;
  });
  app = await buildApp();
});

afterAll(async () => {
  if (app) await app.close();
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`delete from meeting.agenda_items where tenant_id = ${TENANT}`;
    await sql`delete from meeting.meetings where tenant_id = ${TENANT}`;
  });
  await sqlClient.end();
});

// ─── POST /:meetingId/agenda (submit) ─────────────────────────────────────────

describe("POST /v1/meetings/:meetingId/agenda", () => {
  const url = `/v1/meetings/${MEETING}/agenda`;
  const body = { title: "New item", outcomeType: "discussion", category: "new_business" };

  it("401 when unauthenticated", async () => {
    const res = await app.inject({ method: "POST", url, payload: body });
    expect(res.statusCode).toBe(401);
  });

  it("403 for a read-only role", async () => {
    const res = await app.inject({ method: "POST", url, headers: { authorization: `Bearer ${token(["observer"])}` }, payload: body });
    expect(res.statusCode).toBe(403);
  });

  it("400 for an invalid body (missing outcomeType)", async () => {
    const res = await app.inject({ method: "POST", url, headers: { authorization: `Bearer ${token()}` }, payload: { title: "x" } });
    expect(res.statusCode).toBe(400);
  });

  it("404 for an unknown meeting", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/meetings/${MISSING_MEETING}/agenda`, headers: { authorization: `Bearer ${token()}` }, payload: body });
    expect(res.statusCode).toBe(404);
  });

  it("202 accepts a valid submission", async () => {
    const res = await app.inject({ method: "POST", url, headers: { authorization: `Bearer ${token(["meeting_admin"])}` }, payload: body });
    expect(res.statusCode).toBe(202);
    expect(res.json().data.status).toBe("accepted");
  });
});

// ─── GET /:meetingId/agenda (list) ────────────────────────────────────────────

describe("GET /v1/meetings/:meetingId/agenda", () => {
  const url = `/v1/meetings/${MEETING}/agenda`;

  it("401 when unauthenticated", async () => {
    const res = await app.inject({ method: "GET", url });
    expect(res.statusCode).toBe(401);
  });

  it("404 for an unknown meeting", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/meetings/${MISSING_MEETING}/agenda`, headers: { authorization: `Bearer ${token()}` } });
    expect(res.statusCode).toBe(404);
  });

  it("200 lists the meeting's agenda ordered by sequence", async () => {
    const res = await app.inject({ method: "GET", url, headers: { authorization: `Bearer ${token(["committee_member"])}` } });
    expect(res.statusCode).toBe(200);
    const { data } = res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.some((r: { id: string }) => r.id === ITEM)).toBe(true);
  });
});

// ─── PATCH /:meetingId/agenda/:itemId (update) ────────────────────────────────

describe("PATCH /v1/meetings/:meetingId/agenda/:itemId", () => {
  const url = `/v1/meetings/${MEETING}/agenda/${ITEM}`;

  it("401 when unauthenticated", async () => {
    const res = await app.inject({ method: "PATCH", url, payload: { version: 1, patch: { title: "z" } } });
    expect(res.statusCode).toBe(401);
  });

  it("403 for a read-only role", async () => {
    const res = await app.inject({ method: "PATCH", url, headers: { authorization: `Bearer ${token(["committee_member"])}` }, payload: { version: 1, patch: { title: "z" } } });
    expect(res.statusCode).toBe(403);
  });

  it("400 for an empty patch", async () => {
    const res = await app.inject({ method: "PATCH", url, headers: { authorization: `Bearer ${token()}` }, payload: { version: 1, patch: {} } });
    expect(res.statusCode).toBe(400);
  });

  it("404 for an unknown item", async () => {
    const res = await app.inject({ method: "PATCH", url: `/v1/meetings/${MEETING}/agenda/${MISSING_ITEM}`, headers: { authorization: `Bearer ${token()}` }, payload: { version: 1, patch: { title: "z" } } });
    expect(res.statusCode).toBe(404);
  });

  it("202 accepts a valid patch", async () => {
    const res = await app.inject({ method: "PATCH", url, headers: { authorization: `Bearer ${token()}` }, payload: { version: 1, patch: { title: "Renamed", status: "accepted" } } });
    expect(res.statusCode).toBe(202);
    expect(res.json().data.id).toBe(ITEM);
  });
});

// ─── DELETE /:meetingId/agenda/:itemId (withdraw) ─────────────────────────────

describe("DELETE /v1/meetings/:meetingId/agenda/:itemId", () => {
  const url = `/v1/meetings/${MEETING}/agenda/${ITEM}`;

  it("401 when unauthenticated", async () => {
    const res = await app.inject({ method: "DELETE", url, payload: { version: 1 } });
    expect(res.statusCode).toBe(401);
  });

  it("404 for an unknown item", async () => {
    const res = await app.inject({ method: "DELETE", url: `/v1/meetings/${MEETING}/agenda/${MISSING_ITEM}`, headers: { authorization: `Bearer ${token()}` }, payload: { version: 1 } });
    expect(res.statusCode).toBe(404);
  });

  it("202 accepts a valid withdrawal", async () => {
    const res = await app.inject({ method: "DELETE", url, headers: { authorization: `Bearer ${token()}` }, payload: { version: 1, reason: "duplicate" } });
    expect(res.statusCode).toBe(202);
    expect(res.json().data.id).toBe(ITEM);
  });
});

// ─── POST /:meetingId/agenda/reorder ──────────────────────────────────────────

describe("POST /v1/meetings/:meetingId/agenda/reorder", () => {
  const url = `/v1/meetings/${MEETING}/agenda/reorder`;

  it("401 when unauthenticated", async () => {
    const res = await app.inject({ method: "POST", url, payload: { order: [{ agendaItemId: ITEM, sequence: 1 }] } });
    expect(res.statusCode).toBe(401);
  });

  it("400 for an empty order array", async () => {
    const res = await app.inject({ method: "POST", url, headers: { authorization: `Bearer ${token()}` }, payload: { order: [] } });
    expect(res.statusCode).toBe(400);
  });

  it("404 for an unknown meeting", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/meetings/${MISSING_MEETING}/agenda/reorder`, headers: { authorization: `Bearer ${token()}` }, payload: { order: [{ agendaItemId: ITEM, sequence: 1 }] } });
    expect(res.statusCode).toBe(404);
  });

  it("202 accepts a valid reorder payload", async () => {
    const res = await app.inject({ method: "POST", url, headers: { authorization: `Bearer ${token()}` }, payload: { order: [{ agendaItemId: ITEM, sequence: 1 }] } });
    expect(res.statusCode).toBe(202);
    expect(res.json().data.status).toBe("accepted");
  });
});

// ─── POST /:meetingId/agenda/lock + /unlock ───────────────────────────────────

describe("POST /v1/meetings/:meetingId/agenda/lock", () => {
  const url = `/v1/meetings/${MEETING}/agenda/lock`;

  it("401 when unauthenticated", async () => {
    const res = await app.inject({ method: "POST", url, payload: { version: 1 } });
    expect(res.statusCode).toBe(401);
  });

  it("403 for a read-only role", async () => {
    const res = await app.inject({ method: "POST", url, headers: { authorization: `Bearer ${token(["committee_member"])}` }, payload: { version: 1 } });
    expect(res.statusCode).toBe(403);
  });

  it("404 for an unknown meeting", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/meetings/${MISSING_MEETING}/agenda/lock`, headers: { authorization: `Bearer ${token()}` }, payload: { version: 1 } });
    expect(res.statusCode).toBe(404);
  });

  it("202 accepts a lock request (LOCK_ROLES incl. chairperson)", async () => {
    const res = await app.inject({ method: "POST", url, headers: { authorization: `Bearer ${token(["committee_chairperson"])}` }, payload: { version: 1 } });
    expect(res.statusCode).toBe(202);
    expect(res.json().data.id).toBe(MEETING);
  });
});

describe("POST /v1/meetings/:meetingId/agenda/unlock", () => {
  const url = `/v1/meetings/${MEETING}/agenda/unlock`;

  it("401 when unauthenticated", async () => {
    const res = await app.inject({ method: "POST", url, payload: { version: 1 } });
    expect(res.statusCode).toBe(401);
  });

  it("403 for a secretary (unlock is chairperson-only)", async () => {
    const res = await app.inject({ method: "POST", url, headers: { authorization: `Bearer ${token(["committee_secretary"])}` }, payload: { version: 1 } });
    expect(res.statusCode).toBe(403);
  });

  it("202 accepts an unlock from the chairperson", async () => {
    const res = await app.inject({ method: "POST", url, headers: { authorization: `Bearer ${token(["committee_chairperson"])}` }, payload: { version: 2 } });
    expect(res.statusCode).toBe(202);
    expect(res.json().data.id).toBe(MEETING);
  });
});

// ─── agenda-book generate / circulate / status ────────────────────────────────

describe("POST /v1/meetings/:meetingId/agenda-book/generate", () => {
  const url = `/v1/meetings/${MEETING}/agenda-book/generate`;

  it("401 when unauthenticated", async () => {
    const res = await app.inject({ method: "POST", url, payload: {} });
    expect(res.statusCode).toBe(401);
  });

  it("404 for an unknown meeting", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/meetings/${MISSING_MEETING}/agenda-book/generate`, headers: { authorization: `Bearer ${token()}` }, payload: {} });
    expect(res.statusCode).toBe(404);
  });

  it("202 accepts a generate request", async () => {
    const res = await app.inject({ method: "POST", url, headers: { authorization: `Bearer ${token()}` }, payload: { includeAtr: true } });
    expect(res.statusCode).toBe(202);
    expect(res.json().data.status).toBe("accepted");
  });
});

describe("POST /v1/meetings/:meetingId/agenda-book/circulate", () => {
  const url = `/v1/meetings/${MEETING}/agenda-book/circulate`;
  const agendaBookId = "abababab-cafe-4a1a-9b2c-000000000503";

  it("401 when unauthenticated", async () => {
    const res = await app.inject({ method: "POST", url, payload: { agendaBookId } });
    expect(res.statusCode).toBe(401);
  });

  it("400 when agendaBookId is missing", async () => {
    const res = await app.inject({ method: "POST", url, headers: { authorization: `Bearer ${token()}` }, payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it("404 for an unknown meeting", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/meetings/${MISSING_MEETING}/agenda-book/circulate`, headers: { authorization: `Bearer ${token()}` }, payload: { agendaBookId } });
    expect(res.statusCode).toBe(404);
  });

  it("202 accepts a circulate request", async () => {
    const res = await app.inject({ method: "POST", url, headers: { authorization: `Bearer ${token()}` }, payload: { agendaBookId } });
    expect(res.statusCode).toBe(202);
    expect(res.json().data.id).toBe(agendaBookId);
  });
});

describe("GET /v1/meetings/:meetingId/agenda-book/status", () => {
  const url = `/v1/meetings/${MEETING}/agenda-book/status`;

  it("401 when unauthenticated", async () => {
    const res = await app.inject({ method: "GET", url });
    expect(res.statusCode).toBe(401);
  });

  it("404 for an unknown meeting", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/meetings/${MISSING_MEETING}/agenda-book/status`, headers: { authorization: `Bearer ${token()}` } });
    expect(res.statusCode).toBe(404);
  });

  it("200 reports agenda readiness + a not-yet-generated book placeholder", async () => {
    const res = await app.inject({ method: "GET", url, headers: { authorization: `Bearer ${token(["committee_member"])}` } });
    expect(res.statusCode).toBe(200);
    const { data } = res.json();
    expect(data.meetingId).toBe(MEETING);
    expect(data.book).toMatchObject({ generated: false, circulated: false });
  });
});
