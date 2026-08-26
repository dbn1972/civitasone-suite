/**
 * decision module — HTTP route tests (task 10.3) via app.inject().
 *
 * Exercises all 12 decision/resolution endpoints against a real Fastify app (buildApp) and a
 * real Postgres (civitas_meeting) with HS256 test JWTs (JWT_ALGORITHM=HS256, JWT_SECRET set in
 * vitest.config.ts). Every endpoint is covered for the mandated cases: happy path + 400
 * (validation) + 401 (unauthenticated) + 403 (forbidden) + 404 (not found).
 *
 * Writes assert 202 (queued via the in-memory queue) and reads assert 200 with the standard
 * `{ data }` envelope. Fixtures are seeded directly with the shared sql client (meeting_svc owns
 * the DB, so RLS is bypassed for seeding) under a dedicated test tenant; the app itself resolves
 * tenant scope from the JWT.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "d1d1d1d1-0000-4000-8000-000000000001";
const OTHER_TENANT = "d2d2d2d2-0000-4000-8000-000000000002";

const MEETING_ID = "aaaa1111-0000-4000-8000-000000000001";
const COMMITTEE_ID = "bbbb2222-0000-4000-8000-000000000001";
const MEMBER_A = "cccc3333-0000-4000-8000-000000000001";
const MEMBER_B = "cccc3333-0000-4000-8000-000000000002";
const MEMBER_C = "cccc3333-0000-4000-8000-000000000003";
const DECISION_ID = "dddd4444-0000-4000-8000-000000000001";
const RESOLUTION_ID = "eeee5555-0000-4000-8000-000000000001"; // in-meeting, passed
const CIRC_RES_ID = "ffff6666-0000-4000-8000-000000000001"; // circulation
const MISSING = "00000000-0000-4000-8000-0000000000ff";
const ACTOR = "99999999-0000-4000-8000-000000000001";

function token(roles: string[], tid: string = TENANT) {
  return signToken({ sub: ACTOR, tid, roles, sid: "sess-1" }, SECRET);
}
function auth(roles: string[], tid: string = TENANT) {
  return { authorization: `Bearer ${token(roles, tid)}` };
}

let app: FastifyInstance;

beforeAll(async () => {
  // Idempotent seed: clear then insert the fixture graph for the test tenant.
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`DELETE FROM meeting.votes WHERE tenant_id = ${TENANT}`;
  });
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`DELETE FROM meeting.resolutions WHERE tenant_id = ${TENANT}`;
  });
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`DELETE FROM meeting.decisions WHERE tenant_id = ${TENANT}`;
  });
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`DELETE FROM meeting.committee_members WHERE tenant_id = ${TENANT}`;
  });
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`DELETE FROM meeting.committees WHERE tenant_id = ${TENANT}`;
  });
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`DELETE FROM meeting.meetings WHERE tenant_id = ${TENANT}`;
  });

  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`
    INSERT INTO meeting.committees
      (id, tenant_id, name, code, type, constitution_date, quorum_rule, created_by, updated_by)
    VALUES (${COMMITTEE_ID}, ${TENANT}, 'Finance Committee', 'FC', 'finance', '2025-01-01',
            ${'{"minMembers":2}'}::jsonb, ${ACTOR}, ${ACTOR})`;
  });

  for (const m of [MEMBER_A, MEMBER_B, MEMBER_C]) {
    await sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
      await sql`
      INSERT INTO meeting.committee_members
        (tenant_id, committee_id, member_id, role, appointment_date, status, created_by, updated_by)
      VALUES (${TENANT}, ${COMMITTEE_ID}, ${m}, 'member', '2025-01-01', 'active', ${ACTOR}, ${ACTOR})`;
    });
  }

  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`
    INSERT INTO meeting.meetings
      (id, tenant_id, type, title, status, committee_id, financial_year, scheduled_at,
       quorum_established, created_by, updated_by)
    VALUES (${MEETING_ID}, ${TENANT}, 'board', 'Q1 Board Meeting', 'in_progress', ${COMMITTEE_ID},
            '2025-26', '2025-06-01T09:00:00Z', true, ${ACTOR}, ${ACTOR})`;
  });

  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`
    INSERT INTO meeting.decisions
      (id, tenant_id, meeting_id, text, type, status, financial_implication, currency, created_by, updated_by)
    VALUES (${DECISION_ID}, ${TENANT}, ${MEETING_ID}, 'Approve vendor payment', 'financial', 'effective',
            250000000, 'INR', ${ACTOR}, ${ACTOR})`;
  });

  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`
    INSERT INTO meeting.resolutions
      (id, tenant_id, meeting_id, resolution_number, text, vote_type, votes_for, votes_against,
       votes_abstain, majority_rule, result, status, is_circulation, created_by, updated_by)
    VALUES (${RESOLUTION_ID}, ${TENANT}, ${MEETING_ID}, 'FC/RES/2025-26/001', 'Resolved to approve budget',
            'electronic_poll', 5, 1, 0, 'simple_majority', 'passed', 'effective', false, ${ACTOR}, ${ACTOR})`;
  });

  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`
    INSERT INTO meeting.resolutions
      (id, tenant_id, meeting_id, resolution_number, text, vote_type, majority_rule, result, status,
       is_circulation, circulation_deadline, created_by, updated_by)
    VALUES (${CIRC_RES_ID}, ${TENANT}, ${MEETING_ID}, 'FC/RES/2025-26/002', 'Circulation: emergency spend',
            'electronic_poll', 'simple_majority', 'invalid', 'effective', true,
            ${new Date(Date.now() + 86400000).toISOString()}, ${ACTOR}, ${ACTOR})`;
  });

  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`
    INSERT INTO meeting.votes (tenant_id, resolution_id, member_id, position, is_circulation)
    VALUES (${TENANT}, ${CIRC_RES_ID}, ${MEMBER_A}, 'approve', true)`;
  });

  app = await buildApp();
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

// ─── POST /decisions (record) ──────────────────────────────────────────────
describe("POST /v1/meetings/:meetingId/decisions", () => {
  const body = { text: "Approve new procurement", type: "procurement" };

  it("202 accepts a recorded decision (secretary)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING_ID}/decisions`,
      headers: auth(["committee_secretary"]),
      payload: body,
    });
    expect(res.statusCode).toBe(202);
    const json = res.json();
    expect(json.data.status).toBe("accepted");
    expect(typeof json.data.id).toBe("string");
  });

  it("202 accepts a large-but-within-bound bigint-paise financial implication as a string", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING_ID}/decisions`,
      headers: auth(["committee_secretary"]),
      // ₹1,00,000 crore in paise — one order of magnitude below the platform ceiling
      // (decision/validators.ts MAX_FINANCIAL_IMPLICATION_MINOR), still exercises bigint-paise
      // string handling well beyond a value you'd type as a JS number by hand.
      payload: { text: "Sanction expenditure", type: "financial", financialImplication: "100000000000000" },
    });
    expect(res.statusCode).toBe(202);
  });

  it("400 rejects a financial implication above the platform's sane ceiling (schema/migration review finding — this field was previously unbounded and accepted any magnitude)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING_ID}/decisions`,
      headers: auth(["committee_secretary"]),
      // ~₹90 trillion in paise (also > Number.MAX_SAFE_INTEGER) — absurd for a single meeting
      // decision (bigger than a meaningful fraction of India's entire annual Union Budget) and
      // now correctly rejected instead of silently accepted.
      payload: { text: "Sanction expenditure", type: "financial", financialImplication: "9007199254740993" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("400 rejects a currency code that is not on the platform's supported ISO-4217 list", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING_ID}/decisions`,
      headers: auth(["committee_secretary"]),
      // "ZZZ" is 3 uppercase letters (passed the old regex) but not a real/supported ISO-4217 code.
      payload: { text: "Sanction expenditure", type: "financial", financialImplication: "500000", currency: "ZZZ" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("202 still accepts the platform's default currency (INR)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING_ID}/decisions`,
      headers: auth(["committee_secretary"]),
      payload: { text: "Sanction expenditure", type: "financial", financialImplication: "500000", currency: "INR" },
    });
    expect(res.statusCode).toBe(202);
  });

  it("400 on an invalid body (unknown type)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING_ID}/decisions`,
      headers: auth(["committee_secretary"]),
      payload: { text: "x", type: "not-a-type" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("401 without a token", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING_ID}/decisions`,
      payload: body,
    });
    expect(res.statusCode).toBe(401);
  });

  it("403 for a role without record rights", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING_ID}/decisions`,
      headers: auth(["observer"]),
      payload: body,
    });
    expect(res.statusCode).toBe(403);
  });

  it("404 when the meeting does not exist", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MISSING}/decisions`,
      headers: auth(["committee_secretary"]),
      payload: body,
    });
    expect(res.statusCode).toBe(404);
  });
});

// ─── GET /decisions (list) ─────────────────────────────────────────────────
describe("GET /v1/meetings/:meetingId/decisions", () => {
  it("200 returns the meeting's decisions with money as a string", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/meetings/${MEETING_ID}/decisions`,
      headers: auth(["observer"]),
    });
    expect(res.statusCode).toBe(200);
    const rows = res.json().data as Array<{ id: string; financialImplication: string | null }>;
    const seeded = rows.find((r) => r.id === DECISION_ID);
    expect(seeded).toBeTruthy();
    expect(seeded?.financialImplication).toBe("250000000");
  });

  it("401 without a token", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/meetings/${MEETING_ID}/decisions` });
    expect(res.statusCode).toBe(401);
  });

  it("403 for an unknown role", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/meetings/${MEETING_ID}/decisions`,
      headers: auth(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });

  it("404 when the meeting does not exist", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/meetings/${MISSING}/decisions`,
      headers: auth(["observer"]),
    });
    expect(res.statusCode).toBe(404);
  });

  it("tenant isolation: another tenant sees no decisions (404 — meeting not visible)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/meetings/${MEETING_ID}/decisions`,
      headers: auth(["observer"], OTHER_TENANT),
    });
    expect(res.statusCode).toBe(404);
  });
});

// ─── PATCH /decisions/:decisionId (update) ─────────────────────────────────
describe("PATCH /v1/meetings/:meetingId/decisions/:decisionId", () => {
  it("202 accepts an optimistic-locked patch", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/meetings/${MEETING_ID}/decisions/${DECISION_ID}`,
      headers: auth(["meeting_admin"]),
      payload: { version: 1, patch: { status: "withdrawn" } },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().data.id).toBe(DECISION_ID);
  });

  it("400 on an empty patch", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/meetings/${MEETING_ID}/decisions/${DECISION_ID}`,
      headers: auth(["meeting_admin"]),
      payload: { version: 1, patch: {} },
    });
    expect(res.statusCode).toBe(400);
  });

  it("401 without a token", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/meetings/${MEETING_ID}/decisions/${DECISION_ID}`,
      payload: { version: 1, patch: { status: "effective" } },
    });
    expect(res.statusCode).toBe(401);
  });

  it("403 for a role without record rights", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/meetings/${MEETING_ID}/decisions/${DECISION_ID}`,
      headers: auth(["committee_member"]),
      payload: { version: 1, patch: { status: "effective" } },
    });
    expect(res.statusCode).toBe(403);
  });

  it("404 when the decision does not exist", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/meetings/${MEETING_ID}/decisions/${MISSING}`,
      headers: auth(["meeting_admin"]),
      payload: { version: 1, patch: { status: "effective" } },
    });
    expect(res.statusCode).toBe(404);
  });
});

// ─── POST /resolutions (record) ────────────────────────────────────────────
describe("POST /v1/meetings/:meetingId/resolutions", () => {
  const body = { text: "Resolved to adopt the annual plan", voteType: "electronic_poll", votesFor: 4, votesAgainst: 1 };

  it("202 accepts a recorded resolution", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING_ID}/resolutions`,
      headers: auth(["committee_secretary"]),
      payload: body,
    });
    expect(res.statusCode).toBe(202);
  });

  it("400 on a missing text", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING_ID}/resolutions`,
      headers: auth(["committee_secretary"]),
      payload: { voteType: "electronic_poll" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("401 without a token", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/meetings/${MEETING_ID}/resolutions`, payload: body });
    expect(res.statusCode).toBe(401);
  });

  it("403 for an unknown role", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING_ID}/resolutions`,
      headers: auth(["citizen"]),
      payload: body,
    });
    expect(res.statusCode).toBe(403);
  });

  it("404 when the meeting does not exist", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MISSING}/resolutions`,
      headers: auth(["committee_secretary"]),
      payload: body,
    });
    expect(res.statusCode).toBe(404);
  });
});

// ─── GET /resolutions (list) ───────────────────────────────────────────────
describe("GET /v1/meetings/:meetingId/resolutions", () => {
  it("200 returns the meeting's resolutions", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/meetings/${MEETING_ID}/resolutions`,
      headers: auth(["committee_member"]),
    });
    expect(res.statusCode).toBe(200);
    const rows = res.json().data as Array<{ id: string }>;
    expect(rows.some((r) => r.id === RESOLUTION_ID)).toBe(true);
  });

  it("404 when the meeting does not exist", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/meetings/${MISSING}/resolutions`,
      headers: auth(["committee_member"]),
    });
    expect(res.statusCode).toBe(404);
  });
});

// ─── POST /resolutions/:id/sign ────────────────────────────────────────────
describe("POST /v1/meetings/:meetingId/resolutions/:resolutionId/sign", () => {
  const body = { signerId: ACTOR };

  it("202 accepts a sign request from the chairperson", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING_ID}/resolutions/${RESOLUTION_ID}/sign`,
      headers: auth(["committee_chairperson"]),
      payload: body,
    });
    expect(res.statusCode).toBe(202);
  });

  it("400 on a missing signerId", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING_ID}/resolutions/${RESOLUTION_ID}/sign`,
      headers: auth(["committee_chairperson"]),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("401 without a token", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING_ID}/resolutions/${RESOLUTION_ID}/sign`,
      payload: body,
    });
    expect(res.statusCode).toBe(401);
  });

  it("403 for a secretary (sign is chairperson-only)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING_ID}/resolutions/${RESOLUTION_ID}/sign`,
      headers: auth(["committee_secretary"]),
      payload: body,
    });
    expect(res.statusCode).toBe(403);
  });

  it("404 when the resolution does not exist", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING_ID}/resolutions/${MISSING}/sign`,
      headers: auth(["committee_chairperson"]),
      payload: body,
    });
    expect(res.statusCode).toBe(404);
  });
});

// ─── POST /resolutions/:id/dissent ─────────────────────────────────────────
describe("POST /v1/meetings/:meetingId/resolutions/:resolutionId/dissent", () => {
  const body = { memberId: MEMBER_B, note: "I dissent on procedural grounds" };

  it("202 accepts a dissent note from a member", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING_ID}/resolutions/${RESOLUTION_ID}/dissent`,
      headers: auth(["committee_member"]),
      payload: body,
    });
    expect(res.statusCode).toBe(202);
  });

  it("400 on a missing note", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING_ID}/resolutions/${RESOLUTION_ID}/dissent`,
      headers: auth(["committee_member"]),
      payload: { memberId: MEMBER_B },
    });
    expect(res.statusCode).toBe(400);
  });

  it("401 without a token", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING_ID}/resolutions/${RESOLUTION_ID}/dissent`,
      payload: body,
    });
    expect(res.statusCode).toBe(401);
  });

  it("403 for an observer", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING_ID}/resolutions/${RESOLUTION_ID}/dissent`,
      headers: auth(["observer"]),
      payload: body,
    });
    expect(res.statusCode).toBe(403);
  });

  it("404 when the resolution does not exist", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING_ID}/resolutions/${MISSING}/dissent`,
      headers: auth(["committee_member"]),
      payload: body,
    });
    expect(res.statusCode).toBe(404);
  });
});

// ─── GET committees/:id/resolution-register ────────────────────────────────
describe("GET /v1/meetings/committees/:committeeId/resolution-register", () => {
  it("200 returns the committee register", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/meetings/committees/${COMMITTEE_ID}/resolution-register`,
      headers: auth(["observer"]),
    });
    expect(res.statusCode).toBe(200);
    const rows = res.json().data as Array<{ id: string; committeeId: string | null }>;
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.every((r) => r.committeeId === COMMITTEE_ID)).toBe(true);
  });

  it("200 applies the search + circulation filters", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/meetings/committees/${COMMITTEE_ID}/resolution-register?q=emergency&isCirculation=true`,
      headers: auth(["observer"]),
    });
    expect(res.statusCode).toBe(200);
    const rows = res.json().data as Array<{ id: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(CIRC_RES_ID);
  });

  it("400 on an invalid financialYear filter", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/meetings/committees/${COMMITTEE_ID}/resolution-register?financialYear=2025`,
      headers: auth(["observer"]),
    });
    expect(res.statusCode).toBe(400);
  });

  it("401 without a token", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/meetings/committees/${COMMITTEE_ID}/resolution-register`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("403 for an unknown role", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/meetings/committees/${COMMITTEE_ID}/resolution-register`,
      headers: auth(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });

  it("404 when the committee does not exist", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/meetings/committees/${MISSING}/resolution-register`,
      headers: auth(["observer"]),
    });
    expect(res.statusCode).toBe(404);
  });
});

// ─── GET decisions/search ──────────────────────────────────────────────────
describe("GET /v1/meetings/decisions/search", () => {
  it("200 returns matching decisions with meeting context", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/meetings/decisions/search?type=financial`,
      headers: auth(["meeting_admin"]),
    });
    expect(res.statusCode).toBe(200);
    const rows = res.json().data as Array<{ id: string; committeeId: string | null; financialImplication: string | null }>;
    const seeded = rows.find((r) => r.id === DECISION_ID);
    expect(seeded?.committeeId).toBe(COMMITTEE_ID);
    expect(seeded?.financialImplication).toBe("250000000");
  });

  it("200 with a free-text query", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/meetings/decisions/search?q=vendor%20payment`,
      headers: auth(["meeting_admin"]),
    });
    expect(res.statusCode).toBe(200);
    expect((res.json().data as unknown[]).length).toBeGreaterThanOrEqual(1);
  });

  it("400 on an over-large limit", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/meetings/decisions/search?limit=5000`,
      headers: auth(["meeting_admin"]),
    });
    expect(res.statusCode).toBe(400);
  });

  it("401 without a token", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/meetings/decisions/search` });
    expect(res.statusCode).toBe(401);
  });

  it("403 for an unknown role", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/meetings/decisions/search`,
      headers: auth(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });
});

// ─── POST /resolutions/circulation (init) ──────────────────────────────────
describe("POST /v1/meetings/resolutions/circulation", () => {
  const body = () => ({
    committeeId: COMMITTEE_ID,
    text: "Circulation resolution for urgent approval",
    deadline: new Date(Date.now() + 172800000).toISOString(),
  });

  it("202 initiates a circulation resolution", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/resolutions/circulation`,
      headers: auth(["committee_secretary"]),
      payload: body(),
    });
    expect(res.statusCode).toBe(202);
  });

  it("400 on a missing deadline", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/resolutions/circulation`,
      headers: auth(["committee_secretary"]),
      payload: { committeeId: COMMITTEE_ID, text: "x" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("401 without a token", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/meetings/resolutions/circulation`, payload: body() });
    expect(res.statusCode).toBe(401);
  });

  it("403 for an observer", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/resolutions/circulation`,
      headers: auth(["observer"]),
      payload: body(),
    });
    expect(res.statusCode).toBe(403);
  });

  it("404 when the committee does not exist", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/resolutions/circulation`,
      headers: auth(["committee_secretary"]),
      payload: { ...body(), committeeId: MISSING },
    });
    expect(res.statusCode).toBe(404);
  });
});

// ─── POST /resolutions/circulation/:id/vote ────────────────────────────────
describe("POST /v1/meetings/resolutions/circulation/:resolutionId/vote", () => {
  const body = { memberId: MEMBER_B, position: "approve" };

  it("202 records a circulation vote", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/resolutions/circulation/${CIRC_RES_ID}/vote`,
      headers: auth(["committee_member"]),
      payload: body,
    });
    expect(res.statusCode).toBe(202);
  });

  it("400 on an invalid position", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/resolutions/circulation/${CIRC_RES_ID}/vote`,
      headers: auth(["committee_member"]),
      payload: { memberId: MEMBER_B, position: "maybe" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("401 without a token", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/resolutions/circulation/${CIRC_RES_ID}/vote`,
      payload: body,
    });
    expect(res.statusCode).toBe(401);
  });

  it("403 for an observer", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/resolutions/circulation/${CIRC_RES_ID}/vote`,
      headers: auth(["observer"]),
      payload: body,
    });
    expect(res.statusCode).toBe(403);
  });

  it("404 for a non-circulation resolution", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/resolutions/circulation/${RESOLUTION_ID}/vote`,
      headers: auth(["committee_member"]),
      payload: body,
    });
    expect(res.statusCode).toBe(404);
  });
});

// ─── GET /resolutions/circulation/:id/status ───────────────────────────────
describe("GET /v1/meetings/resolutions/circulation/:resolutionId/status", () => {
  it("200 returns circulation status with the response tally", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/meetings/resolutions/circulation/${CIRC_RES_ID}/status`,
      headers: auth(["observer"]),
    });
    expect(res.statusCode).toBe(200);
    const s = res.json().data;
    expect(s.resolutionId).toBe(CIRC_RES_ID);
    expect(s.totalMembers).toBe(3);
    expect(s.approveCount).toBe(1);
    expect(s.respondedCount).toBe(1);
    expect(s.requiredCount).toBe(2); // ceil(3 * 2/3)
    expect(s.responseThresholdMet).toBe(false);
  });

  it("401 without a token", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/meetings/resolutions/circulation/${CIRC_RES_ID}/status`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("403 for an unknown role", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/meetings/resolutions/circulation/${CIRC_RES_ID}/status`,
      headers: auth(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });

  it("404 for a non-circulation resolution", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/meetings/resolutions/circulation/${RESOLUTION_ID}/status`,
      headers: auth(["observer"]),
    });
    expect(res.statusCode).toBe(404);
  });
});
