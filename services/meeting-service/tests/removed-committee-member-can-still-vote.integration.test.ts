/**
 * CROSS-MODULE INTEGRATION FINDING (HIGH) — a member REMOVED from a committee can
 * still successfully cast a vote on that committee's in-flight resolution, and
 * that vote is fully counted into the official tally — capable of flipping a
 * resolution from rejected to passed on behalf of someone no longer on the
 * committee at all.
 *
 * Root cause: `voting/consumer.ts`'s `handleVoteCast` (consumer.ts:506 onward)
 * only checks (a) the resolution exists and is not a circulation vote, (b)
 * `resolution.status === "voting_open"`, (c) no duplicate vote already exists
 * for this member (P17), and (d) the member is not recused on this motion. It
 * NEVER queries `meeting.committee_members` for the voter's current
 * `status`/`voting_right` at all. The only place `committee_members.status` is
 * even consulted in the whole cast path is `getMemberVoteWeight`
 * (consumer.ts:231-252) — and that function's WHERE clause filters on
 * `status = "active"` only to decide the vote's WEIGHT: when a member doesn't
 * match (e.g. because they were removed), it doesn't reject anything — it just
 * falls through to its documented default, `return ... w > 0 ? w : 1`, and the
 * ballot is inserted anyway with `weight = 1`. `handleVoteConclude`
 * (consumer.ts:588 onward) then tallies purely from the `votes` table rows
 * already on disk (`computeTally` / `computeWeightedTally` over
 * `select position, weight from votes where resolution_id = ...`) — it has no
 * awareness of committee membership either, so a removed member's ballot counts
 * exactly like anyone else's.
 *
 * `committee/consumer.ts`'s `handleMemberRemove` (consumer.ts:416-451) is a
 * clean, narrowly-scoped status flip (`committee_members.status = "removed"`,
 * Req 2.x) — correctly, it does NOT reach into `votes`/`resolutions` to corrupt
 * ballots already cast before the removal (that would be its own bug). But
 * nothing anywhere in the codebase closes the other direction: a member removed
 * WHILE a resolution is open can still cast a brand-new ballot afterward.
 *
 * Proven live below: a 3-member committee opens a resolution while all three are
 * active. The third member is then removed from the committee. Members 1 and 2
 * split 1-for/1-against (a tie — rejected under simple majority). The REMOVED
 * third member then casts "for" — and the resolution concludes PASSED, with a
 * real resolution number and a DSC-hash-anchored official record, decided by a
 * vote from someone with zero standing on the committee at cast time.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { runWithTenant } from "@civitasone/db";
import { NonRetryableError, type CommandEnvelope } from "@civitasone/queue";
import { sqlClient } from "../src/shared/db.js";
import { COMMANDS } from "../src/topics.js";
import { registerVotingConsumers } from "../src/modules/voting/consumer.js";
import { registerCommitteeConsumers } from "../src/modules/committee/consumer.js";

const TENANT = randomUUID();
const COMMITTEE = randomUUID();
const MEETING = randomUUID();
const RESOLUTION = randomUUID();
const ACTOR = randomUUID();
const MEMBER_A = randomUUID();
const MEMBER_B = randomUUID();
const MEMBER_C = randomUUID(); // will be removed mid-vote
let MEMBERSHIP_C: string;

const handlers = new Map<string, (msg: CommandEnvelope<any>) => Promise<void>>();
registerVotingConsumers((topic: string, h: any) => handlers.set(topic, h));
registerCommitteeConsumers((topic: string, h: any) => handlers.set(topic, h));

function msg<T>(type: string, payload: T): CommandEnvelope<T> {
  return { messageId: randomUUID(), type, tenantId: TENANT, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0", payload } as CommandEnvelope<T>;
}
function run<T>(m: CommandEnvelope<T>): Promise<void> {
  return runWithTenant(TENANT, () => handlers.get(m.type)!(m)) as Promise<void>;
}
function tenantQuery<T>(fn: (sql: typeof sqlClient) => Promise<T>): Promise<T> {
  return runWithTenant(TENANT, () =>
    sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
      return fn(sql as unknown as typeof sqlClient);
    }),
  ) as Promise<T>;
}

beforeAll(async () => {
  await tenantQuery(async (sql) => {
    await sql`
      insert into meeting.committees (id, tenant_id, name, code, type, constitution_date, quorum_rule, created_by, updated_by)
      values (${COMMITTEE}, ${TENANT}, 'Removed-Member-Vote Test Committee', 'RMV', 'standing', '2025-01-01',
        ${sql.json({ minMembers: 2 })}, ${ACTOR}, ${ACTOR})`;

    MEMBERSHIP_C = randomUUID();
    for (const [id, m] of [
      [randomUUID(), MEMBER_A],
      [randomUUID(), MEMBER_B],
      [MEMBERSHIP_C, MEMBER_C],
    ] as const) {
      await sql`
        insert into meeting.committee_members (id, tenant_id, committee_id, member_id, role, appointment_date, status, voting_right, created_by, updated_by)
        values (${id}, ${TENANT}, ${COMMITTEE}, ${m}, 'member', '2025-01-01', 'active', true, ${ACTOR}, ${ACTOR})`;
    }

    await sql`
      insert into meeting.meetings
        (id, tenant_id, type, title, status, committee_id, financial_year, scheduled_at,
         actual_start_at, quorum_established, meeting_number, created_by, updated_by)
      values (${MEETING}, ${TENANT}, 'committee', 'Removed-Member-Vote Test Meeting', 'in_progress', ${COMMITTEE},
        '2025-26', '2025-06-15T10:00:00Z', '2025-06-15T10:05:00Z', true,
        ${"RMV/2025-26/" + MEETING.slice(0, 8)}, ${ACTOR}, ${ACTOR})`;

    // 2 present attendees — satisfies the committee's minMembers=2 quorum rule.
    for (const m of [MEMBER_A, MEMBER_B]) {
      const pid = randomUUID();
      await sql`
        insert into meeting.participants (id, tenant_id, meeting_id, employee_id, role, invitation_status, created_by, updated_by)
        values (${pid}, ${TENANT}, ${MEETING}, ${m}, 'member', 'accepted', ${ACTOR}, ${ACTOR})`;
      await sql`
        insert into meeting.attendance_records (id, tenant_id, meeting_id, participant_id, method, check_in_at, mode, status, created_by, updated_by)
        values (${randomUUID()}, ${TENANT}, ${MEETING}, ${pid}, 'manual', now(), 'in_person', 'present', ${ACTOR}, ${ACTOR})`;
    }
  });
});

afterAll(async () => {
  await tenantQuery(async (sql) => {
    await sql`delete from meeting.votes where tenant_id = ${TENANT}`;
    await sql`delete from meeting.resolutions where tenant_id = ${TENANT}`;
    await sql`delete from meeting.attendance_records where tenant_id = ${TENANT}`;
    await sql`delete from meeting.participants where tenant_id = ${TENANT}`;
    await sql`delete from meeting.meetings where tenant_id = ${TENANT}`;
    await sql`delete from meeting.committee_members where tenant_id = ${TENANT}`;
    await sql`delete from meeting.committees where tenant_id = ${TENANT}`;
    await sql`delete from _outbox.messages where tenant_id = ${TENANT}`;
  });
  await sqlClient.end();
});

describe("committee member removed mid-vote can still cast and decide the outcome", () => {
  it("sanity: vote initiates normally while all three members are active (quorum 2 of committee met)", async () => {
    await run(msg(COMMANDS.voteInitiate, {
      resolutionId: RESOLUTION, meetingId: MEETING, tenantId: TENANT,
      resolutionText: "Approve revised procurement policy", voteType: "roll_call", majorityRule: "simple_majority",
    }));
    const rows = await tenantQuery((sql) => sql`select status from meeting.resolutions where id = ${RESOLUTION}`);
    expect((rows as any[])[0].status).toBe("voting_open");
  });

  it("sanity: member C is removed from the committee", async () => {
    await run(msg(COMMANDS.committeeMemberRemove, {
      committeeId: COMMITTEE, membershipId: MEMBERSHIP_C, version: 1, reason: "resigned",
    }));
    const rows = await tenantQuery((sql) => sql`select status from meeting.committee_members where id = ${MEMBERSHIP_C}`);
    expect((rows as any[])[0].status).toBe("removed");
  });

  it("A (active) votes for, B (active) votes against — a tie, which simple majority rejects", async () => {
    await run(msg(COMMANDS.voteCast, { meetingId: MEETING, resolutionId: RESOLUTION, memberId: MEMBER_A, position: "for", tenantId: TENANT }));
    await run(msg(COMMANDS.voteCast, { meetingId: MEETING, resolutionId: RESOLUTION, memberId: MEMBER_B, position: "against", tenantId: TENANT }));
    const rows = await tenantQuery(
      (sql) => sql`select count(*)::int as n from meeting.votes where resolution_id = ${RESOLUTION} and tenant_id = ${TENANT}`,
    );
    expect((rows as any[])[0].n).toBe(2);
  });

  it("FIXED: C, now REMOVED from the committee, cannot cast a vote", async () => {
    await expect(
      run(msg(COMMANDS.voteCast, { meetingId: MEETING, resolutionId: RESOLUTION, memberId: MEMBER_C, position: "for", tenantId: TENANT })),
    ).rejects.toBeInstanceOf(NonRetryableError);

    const rows = await tenantQuery(
      (sql) => sql`select position, weight from meeting.votes where resolution_id = ${RESOLUTION} and member_id = ${MEMBER_C} and tenant_id = ${TENANT}`,
    );
    // getMemberVoteWeight now REJECTS instead of silently defaulting a non-active member to
    // weight 1 — no ballot was ever inserted for C.
    expect((rows as any[]).length).toBe(0);
  });

  it("FIXED: without the removed member's vote, the resolution concludes as a tie — REJECTED, not passed", async () => {
    await run(msg(COMMANDS.voteConclude, { meetingId: MEETING, resolutionId: RESOLUTION, tenantId: TENANT }));

    const rows = await tenantQuery(
      (sql) => sql`select result, status, votes_for, votes_against, resolution_number from meeting.resolutions where id = ${RESOLUTION}`,
    );
    const r = (rows as any[])[0];
    // Only A's and B's real ballots ever counted — 1-for/1-against, a tie, rejected under simple
    // majority. C's vote was never recorded, so it can no longer flip the outcome.
    expect(r.votes_for).toBe(1);
    expect(r.votes_against).toBe(1);
    expect(r.result).toBe("rejected");
    expect(r.status).toBe("rejected");
  });
});
