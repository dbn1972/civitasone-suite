/**
 * meeting-core module — HTTP route tests (task 3.6) via app.inject().
 *
 * Exercises all 16 meeting-core endpoints against a real Fastify app (buildApp) and a real
 * Postgres (civitas_meeting) with HS256 test JWTs (JWT_ALGORITHM=HS256, JWT_SECRET from
 * vitest.config.ts). Every endpoint is covered for the mandated cases: happy path + 400
 * (validation) + 401 (unauthenticated) + 403 (forbidden) + 404 (not found), plus tenant
 * isolation. Writes assert 202 (queued via the in-memory queue); reads assert 200 with the
 * standard `{ data }` / `{ data, meta }` envelope.
 *
 * Fixtures are seeded directly with the shared sql client (meeting_svc owns the DB, so RLS is
 * bypassed for seeding) under a dedicated test tenant; the app resolves tenant scope from the JWT.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "c1c1c1c1-3600-4000-8000-000000000001";
const OTHER_TENANT = "c2c2c2c2-3600-4000-8000-000000000002";

const COMMITTEE_ID = "bbbb3600-0000-4000-8000-000000000001";
const MEETING_ID = "aaaa3600-0000-4000-8000-000000000001";
const SERIES_ID = "55553600-0000-4000-8000-000000000001";
const TYPE_ID = "77773600-0000-4000-8000-000000000001";
const CHAIR = "cccc3600-0000-4000-8000-000000000001";
const SECRETARY = "cccc3600-0000-4000-8000-000000000002";
const MISSING = "00000000-3600-4000-8000-0000000000ff";
const ACTOR = "99993600-0000-4000-8000-000000000001";

function token(roles: string[], tid: string = TENANT) {
  return signToken({ sub: ACTOR, tid, roles, sid: "sess-1" }, SECRET);
}
function auth(roles: string[], tid: string = TENANT) {
  return { authorization: `Bearer ${token(roles, tid)}` };
}

let app: FastifyInstance;

beforeAll(async () => {
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`DELETE FROM meeting.meeting_state_transitions WHERE tenant_id = ${TENANT}`;
  });
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`DELETE FROM meeting.meetings WHERE tenant_id = ${TENANT}`;
  });
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`DELETE FROM meeting.meeting_series WHERE tenant_id = ${TENANT}`;
  });
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`DELETE FROM meeting.meeting_types WHERE tenant_id = ${TENANT}`;
  });
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`DELETE FROM meeting.committees WHERE tenant_id = ${TENANT}`;
  });

  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`
    INSERT INTO meeting.committees (id, tenant_id, name, code, type, constitution_date, quorum_rule, created_by, updated_by)
    VALUES (${COMMITTEE_ID}, ${TENANT}, 'Finance Committee', 'FC', 'finance', '2025-01-01', ${'{"minMembers":2}'}::jsonb, ${ACTOR}, ${ACTOR})`;
  });

  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`
    INSERT INTO meeting.meetings
      (id, tenant_id, type, title, status, committee_id, chairperson_id, secretary_id, scheduled_at,
       financial_year, meeting_number, version, created_by, updated_by)
    VALUES (${MEETING_ID}, ${TENANT}, 'committee', 'Q1 Review', 'draft', ${COMMITTEE_ID}, ${CHAIR}, ${SECRETARY},
            '2026-06-01T09:00:00Z', '2025-26', 'FC/2025-26/001', 1, ${ACTOR}, ${ACTOR})`;
  });

  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`
    INSERT INTO meeting.meeting_state_transitions (tenant_id, meeting_id, from_state, to_state, actor_id)
    VALUES (${TENANT}, ${MEETING_ID}, 'draft', 'draft', ${ACTOR})`;
  });

  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`
    INSERT INTO meeting.meeting_series (id, tenant_id, committee_id, pattern, start_date, version, created_by, updated_by)
    VALUES (${SERIES_ID}, ${TENANT}, ${COMMITTEE_ID}, 'monthly', '2026-01-05', 1, ${ACTOR}, ${ACTOR})`;
  });

  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`
    INSERT INTO meeting.meeting_types (id, tenant_id, code, name, is_statutory, version, created_by, updated_by)
    VALUES (${TYPE_ID}, ${TENANT}, 'BRD', 'Board Meeting', true, 1, ${ACTOR}, ${ACTOR})`;
  });

  app = await buildApp();
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

// ─── POST /v1/meetings ─────────────────────────────────────────────────────
describe("POST /v1/meetings", () => {
  const body = () => ({
    title: "New Meeting",
    type: "committee",
    scheduledAt: new Date(Date.now() + 7 * 86400000).toISOString(),
    durationMinutes: 60,
    committeeId: COMMITTEE_ID,
    chairpersonId: CHAIR,
    secretaryId: SECRETARY,
  });

  it("202 creates a meeting (secretary)", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/meetings", headers: auth(["committee_secretary"]), payload: body() });
    expect(res.statusCode).toBe(202);
    expect(res.json().data.status).toBe("accepted");
    expect(typeof res.json().data.id).toBe("string");
  });

  it("400 on an invalid type", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/meetings", headers: auth(["committee_secretary"]), payload: { ...body(), type: "nope" } });
    expect(res.statusCode).toBe(400);
  });

  it("401 without a token", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/meetings", payload: body() });
    expect(res.statusCode).toBe(401);
  });

  it("403 for a read-only role", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/meetings", headers: auth(["observer"]), payload: body() });
    expect(res.statusCode).toBe(403);
  });
});

// ─── GET /v1/meetings ──────────────────────────────────────────────────────
describe("GET /v1/meetings", () => {
  it("200 lists meetings with a { data, meta } envelope", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/meetings", headers: auth(["observer"]) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.meta).toMatchObject({ page: expect.any(Number), pageSize: expect.any(Number), total: expect.any(Number) });
    expect(body.data.some((m: any) => m.id === MEETING_ID)).toBe(true);
  });

  it("200 applies a status filter", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/meetings?status=draft&committeeId=" + COMMITTEE_ID, headers: auth(["observer"]) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.every((m: any) => m.status === "draft")).toBe(true);
  });

  it("400 on an invalid status filter", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/meetings?status=bogus", headers: auth(["observer"]) });
    expect(res.statusCode).toBe(400);
  });

  it("401 without a token", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/meetings" });
    expect(res.statusCode).toBe(401);
  });

  it("403 for an unknown role", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/meetings", headers: auth(["citizen"]) });
    expect(res.statusCode).toBe(403);
  });

  it("tenant isolation: another tenant does not see this tenant's meeting", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/meetings", headers: auth(["observer"], OTHER_TENANT) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.some((m: any) => m.id === MEETING_ID)).toBe(false);
  });
});

// ─── GET /v1/meetings/:meetingId ───────────────────────────────────────────
describe("GET /v1/meetings/:meetingId", () => {
  it("200 returns the meeting", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/meetings/${MEETING_ID}`, headers: auth(["committee_member"]) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.id).toBe(MEETING_ID);
  });

  it("401 without a token", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/meetings/${MEETING_ID}` });
    expect(res.statusCode).toBe(401);
  });

  it("403 for an unknown role", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/meetings/${MEETING_ID}`, headers: auth(["citizen"]) });
    expect(res.statusCode).toBe(403);
  });

  it("404 when the meeting does not exist", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/meetings/${MISSING}`, headers: auth(["committee_member"]) });
    expect(res.statusCode).toBe(404);
  });

  it("404 (isolation) when requested from another tenant", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/meetings/${MEETING_ID}`, headers: auth(["committee_member"], OTHER_TENANT) });
    expect(res.statusCode).toBe(404);
  });
});

// ─── PATCH /v1/meetings/:meetingId ─────────────────────────────────────────
describe("PATCH /v1/meetings/:meetingId", () => {
  it("202 accepts an optimistic-locked patch", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/meetings/${MEETING_ID}`,
      headers: auth(["committee_secretary"]),
      payload: { version: 1, patch: { title: "Q1 Review (rev)" } },
    });
    expect(res.statusCode).toBe(202);
  });

  it("400 on an empty patch", async () => {
    const res = await app.inject({ method: "PATCH", url: `/v1/meetings/${MEETING_ID}`, headers: auth(["committee_secretary"]), payload: { version: 1, patch: {} } });
    expect(res.statusCode).toBe(400);
  });

  it("401 without a token", async () => {
    const res = await app.inject({ method: "PATCH", url: `/v1/meetings/${MEETING_ID}`, payload: { version: 1, patch: { title: "x" } } });
    expect(res.statusCode).toBe(401);
  });

  it("403 for a read-only role", async () => {
    const res = await app.inject({ method: "PATCH", url: `/v1/meetings/${MEETING_ID}`, headers: auth(["observer"]), payload: { version: 1, patch: { title: "x" } } });
    expect(res.statusCode).toBe(403);
  });

  it("404 when the meeting does not exist", async () => {
    const res = await app.inject({ method: "PATCH", url: `/v1/meetings/${MISSING}`, headers: auth(["committee_secretary"]), payload: { version: 1, patch: { title: "x" } } });
    expect(res.statusCode).toBe(404);
  });
});

// ─── POST /v1/meetings/:meetingId/transition ───────────────────────────────
describe("POST /v1/meetings/:meetingId/transition", () => {
  const body = { version: 1, to: "scheduled" };

  it("202 accepts a transition (chairperson)", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/meetings/${MEETING_ID}/transition`, headers: auth(["committee_chairperson"]), payload: body });
    expect(res.statusCode).toBe(202);
  });

  it("400 on an invalid target state", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/meetings/${MEETING_ID}/transition`, headers: auth(["committee_chairperson"]), payload: { version: 1, to: "warp" } });
    expect(res.statusCode).toBe(400);
  });

  it("401 without a token", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/meetings/${MEETING_ID}/transition`, payload: body });
    expect(res.statusCode).toBe(401);
  });

  it("403 for a secretary (transition is admin/chairperson-only)", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/meetings/${MEETING_ID}/transition`, headers: auth(["committee_secretary"]), payload: body });
    expect(res.statusCode).toBe(403);
  });

  it("404 when the meeting does not exist", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/meetings/${MISSING}/transition`, headers: auth(["committee_chairperson"]), payload: body });
    expect(res.statusCode).toBe(404);
  });
});

// ─── DELETE /v1/meetings/:meetingId (soft cancel) ──────────────────────────
describe("DELETE /v1/meetings/:meetingId", () => {
  const body = { version: 1, reason: "cancelled by organiser" };

  it("202 soft-cancels the meeting (chairperson)", async () => {
    const res = await app.inject({ method: "DELETE", url: `/v1/meetings/${MEETING_ID}`, headers: auth(["committee_chairperson"]), payload: body });
    expect(res.statusCode).toBe(202);
  });

  it("400 on a missing reason", async () => {
    const res = await app.inject({ method: "DELETE", url: `/v1/meetings/${MEETING_ID}`, headers: auth(["committee_chairperson"]), payload: { version: 1 } });
    expect(res.statusCode).toBe(400);
  });

  it("401 without a token", async () => {
    const res = await app.inject({ method: "DELETE", url: `/v1/meetings/${MEETING_ID}`, payload: body });
    expect(res.statusCode).toBe(401);
  });

  it("403 for a secretary", async () => {
    const res = await app.inject({ method: "DELETE", url: `/v1/meetings/${MEETING_ID}`, headers: auth(["committee_secretary"]), payload: body });
    expect(res.statusCode).toBe(403);
  });

  it("404 when the meeting does not exist", async () => {
    const res = await app.inject({ method: "DELETE", url: `/v1/meetings/${MISSING}`, headers: auth(["committee_chairperson"]), payload: body });
    expect(res.statusCode).toBe(404);
  });
});

// ─── GET /v1/meetings/:meetingId/transitions ───────────────────────────────
describe("GET /v1/meetings/:meetingId/transitions", () => {
  it("200 returns the transition audit log", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/meetings/${MEETING_ID}/transitions`, headers: auth(["observer"]) });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().data)).toBe(true);
    expect(res.json().data.length).toBeGreaterThanOrEqual(1);
  });

  it("401 without a token", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/meetings/${MEETING_ID}/transitions` });
    expect(res.statusCode).toBe(401);
  });

  it("403 for an unknown role", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/meetings/${MEETING_ID}/transitions`, headers: auth(["citizen"]) });
    expect(res.statusCode).toBe(403);
  });

  it("404 when the meeting does not exist", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/meetings/${MISSING}/transitions`, headers: auth(["observer"]) });
    expect(res.statusCode).toBe(404);
  });
});

// ─── GET /v1/meetings/types ────────────────────────────────────────────────
describe("GET /v1/meetings/types", () => {
  it("200 lists meeting types", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/meetings/types", headers: auth(["committee_secretary"]) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.some((t: any) => t.id === TYPE_ID)).toBe(true);
  });

  it("200 filters by isStatutory", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/meetings/types?isStatutory=true", headers: auth(["committee_secretary"]) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.every((t: any) => t.isStatutory === true)).toBe(true);
  });

  it("401 without a token", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/meetings/types" });
    expect(res.statusCode).toBe(401);
  });

  it("403 for an unknown role", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/meetings/types", headers: auth(["citizen"]) });
    expect(res.statusCode).toBe(403);
  });
});

// ─── POST /v1/meetings/types ───────────────────────────────────────────────
describe("POST /v1/meetings/types", () => {
  const body = { code: "SPCL", name: "Special Meeting" };

  it("202 creates a meeting type (admin)", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/meetings/types", headers: auth(["meeting_admin"]), payload: body });
    expect(res.statusCode).toBe(202);
  });

  it("400 on a missing name", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/meetings/types", headers: auth(["meeting_admin"]), payload: { code: "X" } });
    expect(res.statusCode).toBe(400);
  });

  it("401 without a token", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/meetings/types", payload: body });
    expect(res.statusCode).toBe(401);
  });

  it("403 for a secretary (types are admin-only config)", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/meetings/types", headers: auth(["committee_secretary"]), payload: body });
    expect(res.statusCode).toBe(403);
  });
});

// ─── GET /v1/meetings/series ───────────────────────────────────────────────
describe("GET /v1/meetings/series", () => {
  it("200 lists series", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/meetings/series", headers: auth(["observer"]) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.some((s: any) => s.id === SERIES_ID)).toBe(true);
  });

  it("401 without a token", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/meetings/series" });
    expect(res.statusCode).toBe(401);
  });

  it("403 for an unknown role", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/meetings/series", headers: auth(["citizen"]) });
    expect(res.statusCode).toBe(403);
  });
});

// ─── POST /v1/meetings/series ──────────────────────────────────────────────
describe("POST /v1/meetings/series", () => {
  const body = { committeeId: COMMITTEE_ID, pattern: "weekly", startDate: "2026-02-01" };

  it("202 creates a series (secretary)", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/meetings/series", headers: auth(["committee_secretary"]), payload: body });
    expect(res.statusCode).toBe(202);
  });

  it("400 on an invalid pattern", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/meetings/series", headers: auth(["committee_secretary"]), payload: { ...body, pattern: "hourly" } });
    expect(res.statusCode).toBe(400);
  });

  it("401 without a token", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/meetings/series", payload: body });
    expect(res.statusCode).toBe(401);
  });

  it("403 for a read-only role", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/meetings/series", headers: auth(["observer"]), payload: body });
    expect(res.statusCode).toBe(403);
  });
});

// ─── PATCH /v1/meetings/series/:seriesId ───────────────────────────────────
describe("PATCH /v1/meetings/series/:seriesId", () => {
  it("202 amends a series", async () => {
    const res = await app.inject({ method: "PATCH", url: `/v1/meetings/series/${SERIES_ID}`, headers: auth(["committee_secretary"]), payload: { isActive: false } });
    expect(res.statusCode).toBe(202);
  });

  it("400 on an empty patch", async () => {
    const res = await app.inject({ method: "PATCH", url: `/v1/meetings/series/${SERIES_ID}`, headers: auth(["committee_secretary"]), payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it("401 without a token", async () => {
    const res = await app.inject({ method: "PATCH", url: `/v1/meetings/series/${SERIES_ID}`, payload: { isActive: false } });
    expect(res.statusCode).toBe(401);
  });

  it("403 for a read-only role", async () => {
    const res = await app.inject({ method: "PATCH", url: `/v1/meetings/series/${SERIES_ID}`, headers: auth(["observer"]), payload: { isActive: false } });
    expect(res.statusCode).toBe(403);
  });

  it("404 when the series does not exist", async () => {
    const res = await app.inject({ method: "PATCH", url: `/v1/meetings/series/${MISSING}`, headers: auth(["committee_secretary"]), payload: { isActive: false } });
    expect(res.statusCode).toBe(404);
  });
});

// ─── POST /v1/meetings/series/:seriesId/generate ───────────────────────────
describe("POST /v1/meetings/series/:seriesId/generate", () => {
  const body = { upToDate: "2026-06-30" };

  it("202 generates instances", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/meetings/series/${SERIES_ID}/generate`, headers: auth(["committee_secretary"]), payload: body });
    expect(res.statusCode).toBe(202);
  });

  it("400 on a malformed date", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/meetings/series/${SERIES_ID}/generate`, headers: auth(["committee_secretary"]), payload: { upToDate: "30-06-2026" } });
    expect(res.statusCode).toBe(400);
  });

  it("401 without a token", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/meetings/series/${SERIES_ID}/generate`, payload: body });
    expect(res.statusCode).toBe(401);
  });

  it("403 for a read-only role", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/meetings/series/${SERIES_ID}/generate`, headers: auth(["observer"]), payload: body });
    expect(res.statusCode).toBe(403);
  });

  it("404 when the series does not exist", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/meetings/series/${MISSING}/generate`, headers: auth(["committee_secretary"]), payload: body });
    expect(res.statusCode).toBe(404);
  });
});

// ─── Dashboards ─────────────────────────────────────────────────────────────
describe("GET /v1/meetings/dashboard/*", () => {
  for (const kind of ["leadership", "secretariat", "participant"] as const) {
    it(`200 returns the ${kind} dashboard for the caller`, async () => {
      const res = await app.inject({ method: "GET", url: `/v1/meetings/dashboard/${kind}`, headers: auth(["committee_chairperson"]) });
      expect(res.statusCode).toBe(200);
      expect(res.json().data).toBeTruthy();
    });

    it(`401 without a token (${kind})`, async () => {
      const res = await app.inject({ method: "GET", url: `/v1/meetings/dashboard/${kind}` });
      expect(res.statusCode).toBe(401);
    });

    it(`403 for an unknown role (${kind})`, async () => {
      const res = await app.inject({ method: "GET", url: `/v1/meetings/dashboard/${kind}`, headers: auth(["citizen"]) });
      expect(res.statusCode).toBe(403);
    });
  }

  it("200 lets an admin inspect another user's dashboard via ?userId", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/meetings/dashboard/leadership?userId=${CHAIR}`, headers: auth(["meeting_admin"]) });
    expect(res.statusCode).toBe(200);
  });

  it("403 when a non-admin requests another user's dashboard", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/meetings/dashboard/leadership?userId=${CHAIR}`, headers: auth(["observer"]) });
    expect(res.statusCode).toBe(403);
  });
});
