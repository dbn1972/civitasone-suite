/**
 * Voting module — route-level tests (task 13.3).
 *
 * Exercises the 5 voting endpoints through the real Fastify app via `app.inject()` with HS256
 * test JWTs (steering: route tests must cover happy path + 400 + 401 + 403 + 404). The voting
 * routes are wired into `buildApp()` by the global app.ts registration (task 19.2), so the test
 * simply builds the app and injects requests.
 *
 * Reads hit the real `meeting` schema (Postgres on :5435, memory cache/queue per vitest.config).
 * A small fixture (one meeting + three resolutions + ballots) is seeded directly via the
 * table-owner connection (RLS is owner-bypassed in dev) and torn down afterwards.
 *
 * Covered:
 *   - 401 unauthenticated, 403 wrong role
 *   - 400 missing X-Idempotency-Key + invalid body
 *   - 404 unknown meeting / resolution
 *   - 202 initiate / cast / conclude (CQRS accept)
 *   - 200 results (live tally + projected result + positions) and active listing
 *   - secret_ballot positions withheld (Req 11.1)
 *
 * _Requirements: 11.1, 11.3, 11.4_
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1313-4000-8000-0000000000ff";
const ACTOR = "bbbbbbbb-1313-4000-8000-000000000001";

// Fixture ids.
const MEETING = "11111111-1313-4000-8000-000000000001";
const R_OPEN = "22222222-1313-4000-8000-000000000001"; // roll_call, voting_open
const R_DONE = "22222222-1313-4000-8000-000000000002"; // roll_call, effective, 2 for / 1 against
const R_SECRET = "22222222-1313-4000-8000-000000000003"; // secret_ballot, voting_open
const MEMBER_A = "33333333-1313-4000-8000-000000000001";
const MEMBER_B = "33333333-1313-4000-8000-000000000002";
const MEMBER_C = "33333333-1313-4000-8000-000000000003";
const UNKNOWN = "99999999-1313-4000-8000-000000000000";

function token(roles: string[] = ["super_admin"]): string {
  return signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-vote" }, SECRET, 3600);
}
/** Auth + a fresh idempotency key (writes require X-Idempotency-Key). */
function writeHeaders(roles?: string[], key = `idem-${Math.random().toString(36).slice(2)}`) {
  return { authorization: `Bearer ${token(roles)}`, "x-idempotency-key": key };
}
function readHeaders(roles?: string[]) {
  return { authorization: `Bearer ${token(roles)}` };
}

let app: FastifyInstance;

beforeAll(async () => {
  // votingRoutes are now wired into buildApp() (task 19.2); no manual registration needed.
  app = await buildApp();
  await app.ready();

  // ── Seed fixture (owner connection bypasses RLS in dev) ──────────────────
  await sqlClient`delete from meeting.votes where tenant_id = ${TENANT}`;
  await sqlClient`delete from meeting.resolutions where tenant_id = ${TENANT}`;
  await sqlClient`delete from meeting.meetings where tenant_id = ${TENANT}`;

  await sqlClient`
    insert into meeting.meetings (id, tenant_id, type, title, status, created_by, updated_by)
    values (${MEETING}, ${TENANT}, 'committee', 'Voting fixture meeting', 'in_progress', ${ACTOR}, ${ACTOR})
  `;

  const insertResolution = (id: string, num: string, voteType: string, status: string, result: string) => sqlClient`
    insert into meeting.resolutions
      (id, tenant_id, meeting_id, resolution_number, text, vote_type, majority_rule, result, status, is_circulation, created_by, updated_by)
    values (${id}, ${TENANT}, ${MEETING}, ${num}, ${"Res " + num}, ${voteType}, 'simple_majority', ${result}, ${status}, false, ${ACTOR}, ${ACTOR})
  `;
  await insertResolution(R_OPEN, "OPEN/1", "roll_call", "voting_open", "pending");
  await insertResolution(R_DONE, "DONE/1", "roll_call", "effective", "passed");
  await insertResolution(R_SECRET, "SECR/1", "secret_ballot", "voting_open", "pending");

  const insertVote = (resolutionId: string, memberId: string, position: string) => sqlClient`
    insert into meeting.votes (tenant_id, resolution_id, member_id, position, is_circulation)
    values (${TENANT}, ${resolutionId}, ${memberId}, ${position}, false)
  `;
  // R_DONE: 2 for, 1 against → total 3, simple majority → passed.
  await insertVote(R_DONE, MEMBER_A, "for");
  await insertVote(R_DONE, MEMBER_B, "for");
  await insertVote(R_DONE, MEMBER_C, "against");
  // R_SECRET: 1 for, 1 against (positions must never be disclosed).
  await insertVote(R_SECRET, MEMBER_A, "for");
  await insertVote(R_SECRET, MEMBER_B, "against");
});

afterAll(async () => {
  await sqlClient`delete from meeting.votes where tenant_id = ${TENANT}`;
  await sqlClient`delete from meeting.resolutions where tenant_id = ${TENANT}`;
  await sqlClient`delete from meeting.meetings where tenant_id = ${TENANT}`;
  await app.close();
  await sqlClient.end();
});

describe("authentication & authorization", () => {
  it("401 when unauthenticated (GET active)", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/meetings/${MEETING}/votes/active` });
    expect(res.statusCode).toBe(401);
  });

  it("403 when role is not permitted to initiate a vote", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING}/votes/initiate`,
      headers: writeHeaders(["observer"]),
      payload: { resolutionText: "Approve the annual budget", voteType: "roll_call" },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("validation (400)", () => {
  it("400 when X-Idempotency-Key header is missing on a write", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING}/votes/initiate`,
      headers: readHeaders(), // no idempotency key
      payload: { resolutionText: "Approve the annual budget", voteType: "roll_call" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("400 when the initiate body is invalid (missing resolutionText)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING}/votes/initiate`,
      headers: writeHeaders(),
      payload: { voteType: "roll_call" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("400 when the cast position is invalid", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING}/votes/cast`,
      headers: writeHeaders(),
      payload: { resolutionId: R_OPEN, position: "maybe" },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("not found (404)", () => {
  it("404 on GET results for an unknown resolution", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/meetings/${MEETING}/votes/${UNKNOWN}/results`,
      headers: readHeaders(),
    });
    expect(res.statusCode).toBe(404);
  });

  it("404 on GET active for an unknown meeting", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/meetings/${UNKNOWN}/votes/active`,
      headers: readHeaders(),
    });
    expect(res.statusCode).toBe(404);
  });

  it("404 on cast for an unknown resolution", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING}/votes/cast`,
      headers: writeHeaders(),
      payload: { resolutionId: UNKNOWN, position: "for" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("404 on conclude for an unknown resolution", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING}/votes/${UNKNOWN}/conclude`,
      headers: writeHeaders(),
      payload: {},
    });
    expect(res.statusCode).toBe(404);
  });

  it("404 on GET results when the resolution belongs to a different meeting", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/meetings/${UNKNOWN}/votes/${R_DONE}/results`,
      headers: readHeaders(),
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("writes accepted (202)", () => {
  it("202 initiates a vote and returns an accepted envelope with a Location header", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING}/votes/initiate`,
      headers: writeHeaders(),
      payload: { resolutionText: "Approve the annual budget", voteType: "roll_call", majorityRule: "two_thirds" },
    });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.data.status).toBe("accepted");
    expect(body.data.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.headers.location).toContain(`/v1/meetings/${MEETING}/votes/`);
  });

  it("202 casts a ballot on an open resolution", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING}/votes/cast`,
      headers: writeHeaders(),
      payload: { resolutionId: R_OPEN, position: "for", reason: "supports the proposal" },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().data.id).toBe(R_OPEN);
  });

  it("202 concludes an open vote", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING}/votes/${R_OPEN}/conclude`,
      headers: writeHeaders(),
      payload: {},
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().data.id).toBe(R_OPEN);
  });
});

describe("reads (200)", () => {
  it("200 returns the live tally, projected result, and roll-call positions", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/meetings/${MEETING}/votes/${R_DONE}/results`,
      headers: readHeaders(),
    });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.tally).toEqual({ votesFor: 2, votesAgainst: 1, votesAbstain: 0, total: 3 });
    expect(data.projectedResult).toBe("passed"); // 2/3 > 1/2 simple majority
    expect(data.result).toBe("passed");
    expect(data.resolutionNumber).toBe("DONE/1");
    expect(data.secret).toBe(false);
    expect(data.positions).toHaveLength(3);
  });

  it("200 lists active votes for the meeting", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/meetings/${MEETING}/votes/active`,
      headers: readHeaders(),
    });
    expect(res.statusCode).toBe(200);
    const rows = res.json().data as Array<{ resolutionId: string }>;
    const ids = rows.map((r) => r.resolutionId);
    expect(ids).toContain(R_SECRET);
    // R_DONE is effective (concluded) and must NOT appear among active votes.
    expect(ids).not.toContain(R_DONE);
  });

  it("200 withholds individual positions for a secret ballot (Req 11.1)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/meetings/${MEETING}/votes/${R_SECRET}/results`,
      headers: readHeaders(),
    });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.secret).toBe(true);
    expect(data.positions).toEqual([]);
    // Aggregate tally is still exposed.
    expect(data.tally.total).toBe(2);
  });
});
