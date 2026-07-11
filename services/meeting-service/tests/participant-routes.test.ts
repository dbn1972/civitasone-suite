/**
 * Participant module — HTTP route tests (task 7.3) via `app.inject()`.
 *
 * Exercises every one of the 8 participant endpoints across the mandated axes:
 * happy path + 400 (validation / missing idempotency key) + 401 (unauthenticated) +
 * 403 (wrong role) + 404 (unknown meeting/participant).
 *
 * Auth: HS256 test bypass (JWT_ALGORITHM=HS256, JWT_SECRET from vitest.config.ts).
 * Data: a committee + scheduled meeting + two participants are seeded directly (RLS-aware,
 * with the `app.tenant_id` GUC set inside the seed transaction) and torn down afterwards.
 * Writes are CQRS (publish → 202) against the in-memory queue; no worker runs, so the command
 * is enqueued but not consumed — exactly the boundary these tests assert.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-7c3d-4a1a-9b2c-0000000007a3";
const COMMITTEE = "bbbbbbbb-7c3d-4a1a-9b2c-0000000007a3";
const MEETING = "cccccccc-7c3d-4a1a-9b2c-0000000007a3";
const MISSING_MEETING = "dddddddd-7c3d-4a1a-9b2c-0000000007a3";
const P_CHAIR = "e1111111-7c3d-4a1a-9b2c-0000000007a3";
const P_MEMBER = "e2222222-7c3d-4a1a-9b2c-0000000007a3";
const MISSING_PARTICIPANT = "e9999999-7c3d-4a1a-9b2c-0000000007a3";
const CHAIR_EMP = "f1111111-7c3d-4a1a-9b2c-0000000007a3";
const MEMBER_EMP = "f2222222-7c3d-4a1a-9b2c-0000000007a3";
const NEW_EMP = "f3333333-7c3d-4a1a-9b2c-0000000007a3";
const NOMINEE_EMP = "f4444444-7c3d-4a1a-9b2c-0000000007a3";
const ACTOR = "0a000000-7c3d-4a1a-9b2c-0000000007a3";

const IDEMPOTENCY = { "x-idempotency-key": "test-key-7c3d-0001" } as const;

function token(roles: string[] = ["committee_secretary"], tid: string = TENANT): string {
  return signToken({ sub: ACTOR, tid, roles, sid: "sess-7c3d" }, SECRET);
}

let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  // Seed committee + scheduled meeting + two participants, RLS-aware (GUC in-tx).
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`
      insert into meeting.committees (id, tenant_id, name, type, constitution_date, quorum_rule, created_by, updated_by)
      values (${COMMITTEE}, ${TENANT}, 'Finance Committee', 'standing', '2020-01-01',
              ${sql.json({ minMembers: 2, vcCountsForQuorum: true })}, ${ACTOR}, ${ACTOR})
      on conflict (id) do nothing`;
    await sql`
      insert into meeting.meetings
        (id, tenant_id, type, title, status, committee_id, chairperson_id, secretary_id, scheduled_at, created_by, updated_by)
      values (${MEETING}, ${TENANT}, 'committee', 'Q2 Review', 'scheduled', ${COMMITTEE}, ${CHAIR_EMP}, ${ACTOR},
              now() + interval '7 days', ${ACTOR}, ${ACTOR})
      on conflict (id) do nothing`;
    await sql`
      insert into meeting.participants
        (id, tenant_id, meeting_id, employee_id, role, invitation_status, created_by, updated_by)
      values (${P_CHAIR}, ${TENANT}, ${MEETING}, ${CHAIR_EMP}, 'chairperson', 'accepted', ${ACTOR}, ${ACTOR}),
             (${P_MEMBER}, ${TENANT}, ${MEETING}, ${MEMBER_EMP}, 'member', 'pending', ${ACTOR}, ${ACTOR})
      on conflict (id) do nothing`;
  });
  app = await buildApp();
});

afterAll(async () => {
  if (app) await app.close();
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`delete from meeting.participants where meeting_id = ${MEETING}`;
    await sql`delete from meeting.meetings where id = ${MEETING}`;
    await sql`delete from meeting.committees where id = ${COMMITTEE}`;
  });
  await sqlClient.end();
});

// ─── GET /participants (list) ─────────────────────────────────────────────────

describe("GET /v1/meetings/:meetingId/participants", () => {
  it("401 when unauthenticated", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/meetings/${MEETING}/participants` });
    expect(res.statusCode).toBe(401);
  });

  it("403 for a role without read access", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/meetings/${MEETING}/participants`,
      headers: { authorization: `Bearer ${token(["citizen"])}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("404 for an unknown meeting", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/meetings/${MISSING_MEETING}/participants`,
      headers: { authorization: `Bearer ${token()}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("200 with the seeded roster + list meta", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/meetings/${MEETING}/participants`,
      headers: { authorization: `Bearer ${token(["committee_member"])}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBe(2);
    expect(body.meta).toMatchObject({ page: 1, total: 2 });
    // PII columns must never surface in the read model (Req 15.3).
    expect(body.data[0]).not.toHaveProperty("personalEmail");
    expect(body.data[0]).not.toHaveProperty("personalPhone");
  });

  it("200 filtered by invitationStatus", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/meetings/${MEETING}/participants?invitationStatus=accepted`,
      headers: { authorization: `Bearer ${token()}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.every((p: { invitationStatus: string }) => p.invitationStatus === "accepted")).toBe(true);
  });
});

// ─── GET /participants/quorum-status ──────────────────────────────────────────

describe("GET /v1/meetings/:meetingId/participants/quorum-status", () => {
  it("401 when unauthenticated", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/meetings/${MEETING}/participants/quorum-status`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("404 for an unknown meeting", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/meetings/${MISSING_MEETING}/participants/quorum-status`,
      headers: { authorization: `Bearer ${token()}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("200 with a real-time confirmed-vs-threshold tally", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/meetings/${MEETING}/participants/quorum-status`,
      headers: { authorization: `Bearer ${token()}` },
    });
    expect(res.statusCode).toBe(200);
    const { data } = res.json();
    // threshold=2 (minMembers), chair accepted + member pending → confirmed=1, not met.
    expect(data.threshold).toBe(2);
    expect(data.confirmedCount).toBe(1);
    expect(data.met).toBe(false);
    expect(data.shortfall).toBe(1);
  });
});

// ─── POST /participants (add) ─────────────────────────────────────────────────

describe("POST /v1/meetings/:meetingId/participants", () => {
  it("401 when unauthenticated", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING}/participants`,
      payload: { employeeId: NEW_EMP, role: "member" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("403 for a role without write access", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING}/participants`,
      headers: { authorization: `Bearer ${token(["committee_member"])}`, ...IDEMPOTENCY },
      payload: { employeeId: NEW_EMP, role: "member" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("400 when the X-Idempotency-Key header is missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING}/participants`,
      headers: { authorization: `Bearer ${token()}` },
      payload: { employeeId: NEW_EMP, role: "member" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("400 for an invalid body (special_invitee without agenda scope)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING}/participants`,
      headers: { authorization: `Bearer ${token()}`, ...IDEMPOTENCY },
      payload: { employeeId: NEW_EMP, role: "special_invitee" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("404 for an unknown meeting", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MISSING_MEETING}/participants`,
      headers: { authorization: `Bearer ${token()}`, ...IDEMPOTENCY },
      payload: { employeeId: NEW_EMP, role: "member" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("202 accepts a valid single participant add", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING}/participants`,
      headers: { authorization: `Bearer ${token(["meeting_admin"])}`, ...IDEMPOTENCY },
      payload: { employeeId: NEW_EMP, role: "member" },
    });
    expect(res.statusCode).toBe(202);
    const { data } = res.json();
    expect(data.status).toBe("accepted");
    expect(data.id).toBe(MEETING);
  });

  it("202 accepts a batch add", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING}/participants`,
      headers: { authorization: `Bearer ${token()}`, ...IDEMPOTENCY },
      payload: { participants: [{ employeeId: NOMINEE_EMP, role: "observer" }] },
    });
    expect(res.statusCode).toBe(202);
  });
});

// ─── PATCH /participants/:id (update) ─────────────────────────────────────────

describe("PATCH /v1/meetings/:meetingId/participants/:participantId", () => {
  it("401 when unauthenticated", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/meetings/${MEETING}/participants/${P_MEMBER}`,
      payload: { patch: { isMandatory: false } },
    });
    expect(res.statusCode).toBe(401);
  });

  it("403 for a role without write access", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/meetings/${MEETING}/participants/${P_MEMBER}`,
      headers: { authorization: `Bearer ${token(["observer"])}`, ...IDEMPOTENCY },
      payload: { isMandatory: false },
    });
    expect(res.statusCode).toBe(403);
  });

  it("400 when the X-Idempotency-Key header is missing", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/meetings/${MEETING}/participants/${P_MEMBER}`,
      headers: { authorization: `Bearer ${token()}` },
      payload: { isMandatory: false },
    });
    expect(res.statusCode).toBe(400);
  });

  it("400 for an empty patch", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/meetings/${MEETING}/participants/${P_MEMBER}`,
      headers: { authorization: `Bearer ${token()}`, ...IDEMPOTENCY },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("404 for an unknown participant", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/meetings/${MEETING}/participants/${MISSING_PARTICIPANT}`,
      headers: { authorization: `Bearer ${token()}`, ...IDEMPOTENCY },
      payload: { isMandatory: false },
    });
    expect(res.statusCode).toBe(404);
  });

  it("202 accepts a valid patch", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/meetings/${MEETING}/participants/${P_MEMBER}`,
      headers: { authorization: `Bearer ${token()}`, ...IDEMPOTENCY },
      payload: { isMandatory: false },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().data.id).toBe(P_MEMBER);
  });
});

// ─── DELETE /participants/:id (remove) ────────────────────────────────────────

describe("DELETE /v1/meetings/:meetingId/participants/:participantId", () => {
  it("401 when unauthenticated", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/meetings/${MEETING}/participants/${P_MEMBER}`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("403 for a role without write access", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/meetings/${MEETING}/participants/${P_MEMBER}`,
      headers: { authorization: `Bearer ${token(["committee_member"])}`, ...IDEMPOTENCY },
    });
    expect(res.statusCode).toBe(403);
  });

  it("400 when the X-Idempotency-Key header is missing", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/meetings/${MEETING}/participants/${P_MEMBER}`,
      headers: { authorization: `Bearer ${token()}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it("404 for an unknown participant", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/meetings/${MEETING}/participants/${MISSING_PARTICIPANT}`,
      headers: { authorization: `Bearer ${token()}`, ...IDEMPOTENCY },
    });
    expect(res.statusCode).toBe(404);
  });

  it("202 accepts a valid remove", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/meetings/${MEETING}/participants/${P_CHAIR}`,
      headers: { authorization: `Bearer ${token()}`, ...IDEMPOTENCY },
      payload: { reason: "left the committee" },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().data.id).toBe(P_CHAIR);
  });
});

// ─── POST /participants/:id/respond ───────────────────────────────────────────

describe("POST /v1/meetings/:meetingId/participants/:participantId/respond", () => {
  it("401 when unauthenticated", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING}/participants/${P_MEMBER}/respond`,
      payload: { response: "accept" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("403 for a role without respond access", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING}/participants/${P_MEMBER}/respond`,
      headers: { authorization: `Bearer ${token(["citizen"])}`, ...IDEMPOTENCY },
      payload: { response: "accept" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("400 for a decline without a reason", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING}/participants/${P_MEMBER}/respond`,
      headers: { authorization: `Bearer ${token(["committee_member"])}`, ...IDEMPOTENCY },
      payload: { response: "decline" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("404 for an unknown participant", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING}/participants/${MISSING_PARTICIPANT}/respond`,
      headers: { authorization: `Bearer ${token(["committee_member"])}`, ...IDEMPOTENCY },
      payload: { response: "accept" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("202 accepts a valid RSVP", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING}/participants/${P_MEMBER}/respond`,
      headers: { authorization: `Bearer ${token(["committee_member"])}`, ...IDEMPOTENCY },
      payload: { response: "accept", attendanceMode: "in_person" },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().data.id).toBe(P_MEMBER);
  });
});

// ─── POST /participants/:id/nominate ──────────────────────────────────────────

describe("POST /v1/meetings/:meetingId/participants/:participantId/nominate", () => {
  it("401 when unauthenticated", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING}/participants/${P_MEMBER}/nominate`,
      payload: { nomineeId: NOMINEE_EMP },
    });
    expect(res.statusCode).toBe(401);
  });

  it("403 for a role that may not nominate", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING}/participants/${P_MEMBER}/nominate`,
      headers: { authorization: `Bearer ${token(["observer"])}`, ...IDEMPOTENCY },
      payload: { nomineeId: NOMINEE_EMP },
    });
    expect(res.statusCode).toBe(403);
  });

  it("400 for a non-uuid nominee", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING}/participants/${P_MEMBER}/nominate`,
      headers: { authorization: `Bearer ${token(["committee_member"])}`, ...IDEMPOTENCY },
      payload: { nomineeId: "not-a-uuid" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("404 for an unknown participant", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING}/participants/${MISSING_PARTICIPANT}/nominate`,
      headers: { authorization: `Bearer ${token(["committee_member"])}`, ...IDEMPOTENCY },
      payload: { nomineeId: NOMINEE_EMP },
    });
    expect(res.statusCode).toBe(404);
  });

  it("202 accepts a valid nomination", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING}/participants/${P_MEMBER}/nominate`,
      headers: { authorization: `Bearer ${token(["committee_member"])}`, ...IDEMPOTENCY },
      payload: { nomineeId: NOMINEE_EMP, reason: "on official tour" },
    });
    expect(res.statusCode).toBe(202);
  });
});

// ─── POST /participants/invite ────────────────────────────────────────────────

describe("POST /v1/meetings/:meetingId/participants/invite", () => {
  it("401 when unauthenticated", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING}/participants/invite`,
      payload: {},
    });
    expect(res.statusCode).toBe(401);
  });

  it("403 for a role without write access", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING}/participants/invite`,
      headers: { authorization: `Bearer ${token(["committee_member"])}`, ...IDEMPOTENCY },
      payload: {},
    });
    expect(res.statusCode).toBe(403);
  });

  it("400 when the X-Idempotency-Key header is missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING}/participants/invite`,
      headers: { authorization: `Bearer ${token()}` },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("400 for an invalid channel", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING}/participants/invite`,
      headers: { authorization: `Bearer ${token()}`, ...IDEMPOTENCY },
      payload: { channels: ["carrier_pigeon"] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("404 for an unknown meeting", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MISSING_MEETING}/participants/invite`,
      headers: { authorization: `Bearer ${token()}`, ...IDEMPOTENCY },
      payload: {},
    });
    expect(res.statusCode).toBe(404);
  });

  it("202 accepts an invite dispatch", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING}/participants/invite`,
      headers: { authorization: `Bearer ${token()}`, ...IDEMPOTENCY },
      payload: { channels: ["email", "push"] },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().data.id).toBe(MEETING);
  });
});
