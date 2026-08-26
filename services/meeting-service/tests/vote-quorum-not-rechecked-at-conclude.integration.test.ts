/**
 * CROSS-MODULE INTEGRATION FINDING (HIGH) — quorum, fed from the attendance
 * module, is verified exactly ONCE for a resolution's entire lifecycle — at
 * `voteInitiate` — and never again. If every quorum-eligible attendee leaves
 * before `voteConclude` is called, the resolution still concludes and can still
 * be recorded PASSED, with a real resolution number and DSC-hash-anchored
 * official record, while live attendance shows ZERO members present.
 *
 * Root cause: `voting/consumer.ts`'s `computeVoteTimeQuorum` /
 * `assertQuorumAtVoteTime` pairing (consumer.ts:275-300, invoked at
 * consumer.ts:443-453) is called ONLY from `handleVoteInitiate`. Neither
 * `handleVoteCast` (consumer.ts:506 onward) nor `handleVoteConclude`
 * (consumer.ts:588 onward) calls `computeVoteTimeQuorum` or reads
 * `attendance_records` at all — `handleVoteConclude` only ever selects from
 * `votes` (already-cast ballots) to build the tally. This is a real gap in the
 * exact cross-module seam this cluster exists to check: the design intent
 * (voteInitiate's own JSDoc in topics.ts: "quorum re-verified before open") is
 * satisfied at the START of a vote, but nothing re-derives it from the
 * attendance module's live data before the vote becomes an official record.
 *
 * This is distinct from `tests/integration-quorum-resume.test.ts` (Gap 5),
 * which correctly proves meeting-core's OWN adjourned -> in_progress RESUME
 * transition re-checks quorum from live attendance. That coverage is about the
 * MEETING's state transition. This finding is about an individual VOTE's
 * lifecycle: once a resolution is opened, its own conclusion never looks at
 * attendance again, independent of whatever the parent meeting's transitions
 * do.
 *
 * Proven live below: a committee requiring 3 present members opens a resolution
 * while exactly 3 are present (quorum barely met). All three then leave
 * (`attendance_records.status` moves out of the quorum-eligible set) before any
 * vote is cast. Two votes are then cast and the resolution is concluded —
 * successfully, as PASSED — while a live recount shows 0 of the 3 required
 * members present.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { runWithTenant } from "@civitasone/db";
import type { CommandEnvelope } from "@civitasone/queue";
import { sqlClient } from "../src/shared/db.js";
import { COMMANDS } from "../src/topics.js";
import { registerVotingConsumers } from "../src/modules/voting/consumer.js";

const TENANT = randomUUID();
const COMMITTEE = randomUUID();
const MEETING = randomUUID();
const RESOLUTION = randomUUID();
const ACTOR = randomUUID();
const MEMBERS = [randomUUID(), randomUUID(), randomUUID(), randomUUID()]; // A,B,C present initially; D never present
const PARTICIPANT_IDS: string[] = [];

const handlers = new Map<string, (msg: CommandEnvelope<any>) => Promise<void>>();
registerVotingConsumers((topic: string, h: any) => handlers.set(topic, h));

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
/** Live quorum-eligible headcount, mirroring committee/domain.ts's PRESENT_STATUSES set. */
async function liveEligibleCount(): Promise<number> {
  const rows = await tenantQuery(
    (sql) => sql`
      select count(*)::int as n from meeting.attendance_records
      where meeting_id = ${MEETING} and tenant_id = ${TENANT} and status in ('present', 'joined_late')`,
  );
  return (rows as any[])[0].n as number;
}

beforeAll(async () => {
  await tenantQuery(async (sql) => {
    // Quorum requires 3 of 4 active members present.
    await sql`
      insert into meeting.committees (id, tenant_id, name, code, type, constitution_date, quorum_rule, created_by, updated_by)
      values (${COMMITTEE}, ${TENANT}, 'Stale-Quorum Test Committee', 'SQT', 'standing', '2025-01-01',
        ${sql.json({ minMembers: 3 })}, ${ACTOR}, ${ACTOR})`;
    for (const m of MEMBERS) {
      await sql`
        insert into meeting.committee_members (id, tenant_id, committee_id, member_id, role, appointment_date, status, created_by, updated_by)
        values (${randomUUID()}, ${TENANT}, ${COMMITTEE}, ${m}, 'member', '2025-01-01', 'active', ${ACTOR}, ${ACTOR})`;
    }

    await sql`
      insert into meeting.meetings
        (id, tenant_id, type, title, status, committee_id, financial_year, scheduled_at,
         actual_start_at, quorum_established, meeting_number, created_by, updated_by)
      values (${MEETING}, ${TENANT}, 'committee', 'Stale-Quorum Test Meeting', 'in_progress', ${COMMITTEE},
        '2025-26', '2025-06-15T10:00:00Z', '2025-06-15T10:05:00Z', true,
        ${"SQT/2025-26/" + MEETING.slice(0, 8)}, ${ACTOR}, ${ACTOR})`;

    // Exactly 3 present (A, B, C) — quorum barely met. D never attends.
    for (const m of MEMBERS.slice(0, 3)) {
      const pid = randomUUID();
      PARTICIPANT_IDS.push(pid);
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

describe("vote quorum is checked once at initiate and never re-verified before conclude", () => {
  it("sanity: vote initiates while quorum is genuinely met (3 of 3 required present)", async () => {
    expect(await liveEligibleCount()).toBe(3);
    await run(msg(COMMANDS.voteInitiate, {
      resolutionId: RESOLUTION, meetingId: MEETING, tenantId: TENANT,
      resolutionText: "Approve site acquisition", voteType: "roll_call", majorityRule: "simple_majority",
    }));
    const rows = await tenantQuery((sql) => sql`select status from meeting.resolutions where id = ${RESOLUTION}`);
    expect((rows as any[])[0].status).toBe("voting_open");
  });

  it("all three present members then leave — live quorum is now 0 of 3 required", async () => {
    await tenantQuery(
      (sql) => sql`update meeting.attendance_records set status = 'left_early' where meeting_id = ${MEETING} and tenant_id = ${TENANT}`,
    );
    expect(await liveEligibleCount()).toBe(0);
  });

  it("FIXED: votes are still accepted (cast doesn't check attendance), but conclude now re-verifies live quorum and refuses to record a passed/effective outcome with 0 members live-present", async () => {
    // Only 2 of the 4 committee members bother to cast — cast doesn't check attendance either
    // (that's not this gap; vote.cast's own committee-membership check is a separate fix).
    await run(msg(COMMANDS.voteCast, { meetingId: MEETING, resolutionId: RESOLUTION, memberId: MEMBERS[0], position: "for", tenantId: TENANT }));
    await run(msg(COMMANDS.voteCast, { meetingId: MEETING, resolutionId: RESOLUTION, memberId: MEMBERS[1], position: "for", tenantId: TENANT }));

    // Reconfirm live quorum is still 0 right before conclude — the assertion below is not a
    // stale snapshot from the previous test.
    expect(await liveEligibleCount()).toBe(0);

    await run(msg(COMMANDS.voteConclude, { meetingId: MEETING, resolutionId: RESOLUTION, tenantId: TENANT }));

    const rows = await tenantQuery(
      (sql) => sql`select result, status, votes_for, resolution_number, hash_current from meeting.resolutions where id = ${RESOLUTION}`,
    );
    const r = (rows as any[])[0];
    // handleVoteConclude now re-runs the SAME live-attendance quorum check handleVoteInitiate
    // uses. With 0 of the 3 constitutionally-required members actually in the room, the vote
    // cannot be recorded passed/effective — it concludes `invalid` (the same terminal outcome
    // already used for a circulation resolution that never reached its required response rate),
    // never claims a real sequential resolution number, and is never hash-anchored.
    expect(r.result).toBe("invalid");
    expect(r.status).toBe("invalid");
    expect(r.resolution_number).toBe(`PENDING-${RESOLUTION}`);
    expect(r.hash_current).toBeNull();
  });
});
