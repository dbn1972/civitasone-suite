/**
 * Voting module — committee-membership / authority IDOR.
 *
 * `requireRole` (src/shared/context.ts:131-135) is `hasAnyRole(ctx, roles)` — a flat check
 * against the JWT's tenant-wide `roles: string[]` claim (confirmed directly in
 * packages/auth/src/index.ts:216-218). It carries no notion of WHICH committee the actor
 * belongs to. Every voting route (src/modules/voting/routes.ts) gates on `requireRole` plus
 * `assertResolutionInMeeting`/`assertMeetingExists` (tenant + meeting/resolution linkage only —
 * routes.ts:71-91). No route, and no handler in consumer.ts, ever queries
 * `meeting.committee_members` to confirm the caller actually sits on the committee that owns
 * the meeting/resolution being acted on. Confirmed by grep: `getMemberVoteWeight`
 * (consumer.ts:231-252) is the ONLY touch of `committee_members` in the whole cast path, and it
 * silently DEFAULTS to weight 1 ("headcount") when the caller has no roster row at all, rather
 * than rejecting.
 *
 * This file proves, against real Postgres, that:
 *   1. A tenant user who is not on COMMITTEE_B's roster at all can cast a counted ballot on
 *      COMMITTEE_B's resolution (handleVoteCast).
 *   2. A member REMOVED from COMMITTEE_B (status='removed') can still cast a counted ballot —
 *      the stale-permission variant of the same gap.
 *   3. `vote.recuse` (consumer.ts:863-911) never checks any relationship between the caller
 *      (`msg.actorId`) and the member they are recusing (`p.memberId`) — so, combined with
 *      `RECUSE_ROLES` including the lowest-privilege `committee_member` role (routes.ts:50), any
 *      ordinary member can forcibly disqualify ANY other named member from voting on a motion,
 *      before that member has cast their own ballot.
 *   4. Quorum is verified once, at `vote.initiate` (consumer.ts:442-453) — never again at
 *      `vote.conclude` (consumer.ts:588-701 has no quorum check at all) — so a vote that loses
 *      quorum mid-flight (e.g. members leaving) still concludes as a valid, effective result.
 *   5. (HTTP layer) A `committee_chairperson` token with zero roster standing on the target
 *      committee is accepted (202) by `POST /votes/initiate`, proving the gap exists at the
 *      route boundary too, not just in the consumer.
 *
 * `it.fails()` encodes the CORRECT behavior and is expected to stay red until fixed (repo
 * precedent: visitor-service/tests/badge-print-revoked-pass.test.ts) — flip to a plain `it()`
 * once the guard exists.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { runWithTenant } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import type { CommandEnvelope } from "@civitasone/queue";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { COMMANDS } from "../src/topics.js";
import { registerVotingConsumers } from "../src/modules/voting/consumer.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "a0b8b3e6-1d0a-4000-8000-0000000000ad";

// Two DISTINCT committees in the same tenant — the whole point of an IDOR test.
const COMMITTEE_A = "b0b8b3e6-1d0a-4000-8000-00000000a001";
const COMMITTEE_B = "b0b8b3e6-1d0a-4000-8000-00000000b002";
const MEETING_A = "c0b8b3e6-1d0a-4000-8000-00000000a001"; // owned by COMMITTEE_A
const MEETING_B = "c0b8b3e6-1d0a-4000-8000-00000000b002"; // owned by COMMITTEE_B

const MEMBER_A1 = "d0b8b3e6-1d0a-4000-8000-0000000a0001"; // active member of A only
const MEMBER_A_REMOVED = "d0b8b3e6-1d0a-4000-8000-0000000a0002"; // REMOVED from A
const OUTSIDER = "d0b8b3e6-1d0a-4000-8000-00000000ff01"; // on no committee at all
const CHAIR_OF_A = "d0b8b3e6-1d0a-4000-8000-0000000a0003"; // chairperson OF A, not B
const ACTOR = "e0b8b3e6-1d0a-4000-8000-0000000000ac";

const handlers = new Map<string, (msg: CommandEnvelope<any>) => Promise<void>>();
registerVotingConsumers((topic, h) => handlers.set(topic, h as any));

function msg<T>(type: string, payload: T, messageId = randomUUID()): CommandEnvelope<T> {
  return {
    messageId,
    type,
    tenantId: TENANT,
    actorId: ACTOR,
    correlationId: randomUUID(),
    schemaVersion: "1.0",
    payload,
  } as CommandEnvelope<T>;
}
function run<T>(m: CommandEnvelope<T>): Promise<void> {
  const handler = handlers.get(m.type);
  if (!handler) throw new Error(`no handler for ${m.type}`);
  return runWithTenant(TENANT, () => handler(m)) as Promise<void>;
}
function tenantQuery<T>(fn: (sql: typeof sqlClient) => Promise<T>): Promise<T> {
  return runWithTenant(TENANT, () =>
    sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
      return fn(sql as unknown as typeof sqlClient);
    }),
  ) as Promise<T>;
}
async function readResolution(id: string): Promise<any | null> {
  const rows = await tenantQuery((sql) => sql`select * from meeting.resolutions where id = ${id}`);
  return rows[0] ?? null;
}
async function voteRow(resolutionId: string, memberId: string): Promise<any | null> {
  const rows = await tenantQuery(
    (sql) => sql`select * from meeting.votes where resolution_id = ${resolutionId} and member_id = ${memberId}`,
  );
  return rows[0] ?? null;
}
async function recusalRow(resolutionId: string, memberId: string): Promise<any | null> {
  const rows = await tenantQuery(
    (sql) => sql`select * from meeting.recusals where resolution_id = ${resolutionId} and member_id = ${memberId}`,
  );
  return rows[0] ?? null;
}

/** Insert an in-meeting resolution already open for voting (mirrors voting-consumer.test.ts). */
async function seedOpenResolution(resolutionId: string, meetingId: string): Promise<void> {
  await tenantQuery(
    (sql) => sql`
      insert into meeting.resolutions
        (id, tenant_id, meeting_id, resolution_number, text, vote_type, majority_rule, result, status, is_circulation, created_by, updated_by)
      values (${resolutionId}, ${TENANT}, ${meetingId}, ${"PENDING-" + resolutionId}, 'Open motion', 'roll_call',
              'simple_majority', 'pending', 'voting_open', false, ${ACTOR}, ${ACTOR})`,
  );
}

beforeAll(async () => {
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`delete from meeting.recusals where tenant_id = ${TENANT}`;
    await sql`delete from meeting.votes where tenant_id = ${TENANT}`;
    await sql`delete from meeting.resolutions where tenant_id = ${TENANT}`;
    await sql`delete from meeting.attendance_records where tenant_id = ${TENANT}`;
    await sql`delete from meeting.participants where tenant_id = ${TENANT}`;
    await sql`delete from meeting.committee_members where tenant_id = ${TENANT}`;
    await sql`delete from meeting.committees where tenant_id = ${TENANT}`;
    await sql`delete from meeting.meetings where tenant_id = ${TENANT}`;
    await sql`delete from _outbox.messages where tenant_id = ${TENANT}`;

    await sql`
      insert into meeting.committees (id, tenant_id, name, code, type, constitution_date, quorum_rule, created_by, updated_by)
      values
        (${COMMITTEE_A}, ${TENANT}, 'Committee A', 'CA', 'board', '2025-01-01', ${sql.json({ minMembers: 1 })}, ${ACTOR}, ${ACTOR}),
        (${COMMITTEE_B}, ${TENANT}, 'Committee B', 'CB', 'board', '2025-01-01', ${sql.json({ minMembers: 2 })}, ${ACTOR}, ${ACTOR})`;

    // COMMITTEE_A roster: one active member, one REMOVED member, one chairperson.
    await sql`
      insert into meeting.committee_members (id, tenant_id, committee_id, member_id, role, appointment_date, status, created_by, updated_by)
      values
        (${randomUUID()}, ${TENANT}, ${COMMITTEE_A}, ${MEMBER_A1}, 'member', '2025-01-01', 'active', ${ACTOR}, ${ACTOR}),
        (${randomUUID()}, ${TENANT}, ${COMMITTEE_A}, ${MEMBER_A_REMOVED}, 'member', '2025-01-01', 'removed', ${ACTOR}, ${ACTOR}),
        (${randomUUID()}, ${TENANT}, ${COMMITTEE_A}, ${CHAIR_OF_A}, 'chairperson', '2025-01-01', 'active', ${ACTOR}, ${ACTOR})`;
    // COMMITTEE_B roster: two DIFFERENT active members. Note OUTSIDER/MEMBER_A1/CHAIR_OF_A have
    // NO row here at all — they have no standing on Committee B whatsoever.
    const b1 = randomUUID();
    const b2 = randomUUID();
    await sql`
      insert into meeting.committee_members (id, tenant_id, committee_id, member_id, role, appointment_date, status, created_by, updated_by)
      values
        (${b1}, ${TENANT}, ${COMMITTEE_B}, ${randomUUID()}, 'member', '2025-01-01', 'active', ${ACTOR}, ${ACTOR}),
        (${b2}, ${TENANT}, ${COMMITTEE_B}, ${randomUUID()}, 'member', '2025-01-01', 'active', ${ACTOR}, ${ACTOR})`;

    await sql`
      insert into meeting.meetings (id, tenant_id, type, title, status, committee_id, financial_year, scheduled_at, quorum_established, created_by, updated_by)
      values
        (${MEETING_A}, ${TENANT}, 'committee', 'Committee A meeting', 'in_progress', ${COMMITTEE_A}, '2025-26', '2025-06-01T09:00:00Z', true, ${ACTOR}, ${ACTOR}),
        (${MEETING_B}, ${TENANT}, 'committee', 'Committee B meeting', 'in_progress', ${COMMITTEE_B}, '2025-26', '2025-06-01T09:00:00Z', true, ${ACTOR}, ${ACTOR})`;
  });
});

afterAll(async () => {
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`delete from meeting.recusals where tenant_id = ${TENANT}`;
    await sql`delete from meeting.votes where tenant_id = ${TENANT}`;
    await sql`delete from meeting.resolutions where tenant_id = ${TENANT}`;
    await sql`delete from meeting.attendance_records where tenant_id = ${TENANT}`;
    await sql`delete from meeting.participants where tenant_id = ${TENANT}`;
    await sql`delete from meeting.committee_members where tenant_id = ${TENANT}`;
    await sql`delete from meeting.committees where tenant_id = ${TENANT}`;
    await sql`delete from meeting.meetings where tenant_id = ${TENANT}`;
    await sql`delete from _outbox.messages where tenant_id = ${TENANT}`;
  });
  await sqlClient.end();
});

describe("[BUG] vote.cast has no committee-membership check", () => {
  it.fails("an OUTSIDER with zero committee_members rows anywhere must not be able to cast a counted vote", async () => {
    const resolutionId = randomUUID();
    await seedOpenResolution(resolutionId, MEETING_B);

    await run(
      msg(COMMANDS.voteCast, {
        meetingId: MEETING_B,
        resolutionId,
        memberId: OUTSIDER,
        position: "for",
        tenantId: TENANT,
      }),
    );

    const row = await voteRow(resolutionId, OUTSIDER);
    expect(row).toBeNull(); // fails today — the ballot IS recorded

    const resolution = await readResolution(resolutionId);
    expect(resolution.votes_for).toBe(0); // fails today — the tally IS incremented
  });

  it.fails("a member of Committee A must not be able to cast a counted vote on Committee B's resolution", async () => {
    const resolutionId = randomUUID();
    await seedOpenResolution(resolutionId, MEETING_B);

    await run(
      msg(COMMANDS.voteCast, {
        meetingId: MEETING_B,
        resolutionId,
        memberId: MEMBER_A1, // real member — of the WRONG committee
        position: "against",
        tenantId: TENANT,
      }),
    );

    expect(await voteRow(resolutionId, MEMBER_A1)).toBeNull();
  });

  it.fails("a member REMOVED from the committee (stale permission) must not be able to cast a counted vote", async () => {
    const resolutionId = randomUUID();
    await seedOpenResolution(resolutionId, MEETING_A);

    await run(
      msg(COMMANDS.voteCast, {
        meetingId: MEETING_A,
        resolutionId,
        memberId: MEMBER_A_REMOVED, // status = 'removed' in committee_members
        position: "for",
        tenantId: TENANT,
      }),
    );

    expect(await voteRow(resolutionId, MEMBER_A_REMOVED)).toBeNull();
  });

  it("characterizes today's actual (buggy) behavior: the outsider's ballot IS recorded and tallied", async () => {
    const resolutionId = randomUUID();
    await seedOpenResolution(resolutionId, MEETING_B);

    await run(
      msg(COMMANDS.voteCast, {
        meetingId: MEETING_B,
        resolutionId,
        memberId: OUTSIDER,
        position: "for",
        tenantId: TENANT,
      }),
    );

    const row = await voteRow(resolutionId, OUTSIDER);
    expect(row).not.toBeNull();
    expect(row.weight).toBe(1); // getMemberVoteWeight silently defaults a non-member to weight 1
    const resolution = await readResolution(resolutionId);
    expect(resolution.votes_for).toBe(1);
  });
});

describe("[BUG] vote.recuse has no check tying the caller to the member being recused", () => {
  it.fails(
    "an arbitrary caller must not be able to record a recusal against a DIFFERENT member with no relationship check",
    async () => {
      const resolutionId = randomUUID();
      await seedOpenResolution(resolutionId, MEETING_A);

      // msg.actorId (ACTOR) has no standing on COMMITTEE_A at all, yet names MEMBER_A1 (a real,
      // eligible voter) as the person being recused. handleVoteRecuse (consumer.ts:863-911)
      // never checks who ACTOR is relative to MEMBER_A1 — only that MEMBER_A1 hasn't voted yet.
      await run(
        msg(COMMANDS.voteRecuse, {
          meetingId: MEETING_A,
          resolutionId,
          memberId: MEMBER_A1,
          reason: "forced recusal by an unrelated caller",
          tenantId: TENANT,
        }),
      );

      expect(await recusalRow(resolutionId, MEMBER_A1)).toBeNull();
    },
  );

  it("characterizes today's actual (buggy) behavior: the forced recusal IS recorded and then blocks the target member's real ballot", async () => {
    const resolutionId = randomUUID();
    await seedOpenResolution(resolutionId, MEETING_A);

    await run(
      msg(COMMANDS.voteRecuse, {
        meetingId: MEETING_A,
        resolutionId,
        memberId: MEMBER_A1,
        reason: "forced recusal by an unrelated caller",
        tenantId: TENANT,
      }),
    );
    expect(await recusalRow(resolutionId, MEMBER_A1)).not.toBeNull();

    // MEMBER_A1 now tries to cast their OWN, genuine ballot and is silently blocked by the
    // recusal someone else registered against them without permission.
    await expect(
      run(
        msg(COMMANDS.voteCast, {
          meetingId: MEETING_A,
          resolutionId,
          memberId: MEMBER_A1,
          position: "for",
          tenantId: TENANT,
        }),
      ),
    ).rejects.toThrow(/recused/i);
  });
});

describe("[BUG] quorum is re-verified at vote.initiate but never again at vote.conclude", () => {
  it.fails("a resolution that loses quorum after being opened must not be concludable as effective", async () => {
    const resolutionId = randomUUID();

    // Open the vote while quorum genuinely holds on Committee A's meeting (quorum_established
    // was seeded true, and computeVoteTimeQuorum falls back to that flag when there's no
    // attendance-based roster check available here).
    await run(
      msg(COMMANDS.voteInitiate, {
        resolutionId,
        meetingId: MEETING_A,
        tenantId: TENANT,
        resolutionText: "Motion opened while quorate",
        voteType: "roll_call",
      }),
    );
    expect((await readResolution(resolutionId)).status).toBe("voting_open");

    // Quorum is lost mid-flight (e.g. members leaving/checking out) — flip the meeting's own
    // quorum flag to simulate exactly that, the same signal handleVoteInitiate itself reads.
    await tenantQuery(
      (sql) => sql`update meeting.meetings set quorum_established = false where id = ${MEETING_A}`,
    );

    await run(
      msg(COMMANDS.voteCast, {
        meetingId: MEETING_A,
        resolutionId,
        memberId: MEMBER_A1,
        position: "for",
        tenantId: TENANT,
      }),
    );
    await run(msg(COMMANDS.voteConclude, { meetingId: MEETING_A, resolutionId, tenantId: TENANT }));

    const resolution = await readResolution(resolutionId);
    // Correct behavior: concluding a vote that has lost quorum should be rejected
    // (MEETING_QUORUM_NOT_MET), leaving the resolution open rather than "effective".
    expect(resolution.status).not.toBe("effective");
  });
});

describe("[BUG, HTTP layer] a chairperson of Committee A can initiate a vote for Committee B's meeting", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildApp();
  });
  afterAll(async () => {
    await app.close();
  });

  function token(roles: string[], sub: string) {
    return signToken({ sub, tid: TENANT, roles, sid: "sess-idor" }, SECRET);
  }

  it.fails("must reject a chairperson who does not chair the target meeting's committee", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING_B}/votes/initiate`,
      headers: {
        authorization: `Bearer ${token(["committee_chairperson"], CHAIR_OF_A)}`,
        "x-idempotency-key": randomUUID(),
      },
      payload: { resolutionText: "Motion on Committee B business", voteType: "roll_call" },
    });
    // Correct behavior: 403/404 — CHAIR_OF_A has zero committee_members rows for COMMITTEE_B.
    expect(res.statusCode).not.toBe(202);
  });

  it("characterizes today's actual (buggy) behavior: the route accepts it (202)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING_B}/votes/initiate`,
      headers: {
        authorization: `Bearer ${token(["committee_chairperson"], CHAIR_OF_A)}`,
        "x-idempotency-key": randomUUID(),
      },
      payload: { resolutionText: "Motion on Committee B business", voteType: "roll_call" },
    });
    expect(res.statusCode).toBe(202);
  });
});
