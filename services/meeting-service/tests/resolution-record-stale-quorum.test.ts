/**
 * Resolution integrity — stale quorum latch at resolution.record (Gap 2 of the governance-chain
 * review).
 *
 * `handleResolutionRecord` used to gate solely on `meeting.quorumEstablished`. Per
 * `attendance/consumer.ts` that boolean is a ONE-WAY LATCH: set true exactly once, and never reset
 * when members simply leave (only an explicit adjourn→resume cycle resets it). So once quorum was
 * ever latched, an official, numbered, "effective" resolution with an arbitrary invented
 * votesFor/votesAgainst/votesAbstain could still be recorded after every real attendee had left.
 *
 * The fix re-derives quorum LIVE from `attendance_records` at record time — the SAME live check
 * `voting/consumer.ts` fix 11 (`computeVoteTimeQuorum`) applies at conclude — and, on the aggregate
 * fallback path (no real `meeting.votes` rows: show_of_hands/secret_ballot), additionally bounds the
 * client-supplied total tally against the live present-member headcount (a resolution can't record
 * more votes than members actually present).
 *
 * Proven live against real Postgres below:
 *   1. A committee-backed meeting whose `quorum_established` is STILL latched true, but whose live
 *      attendance has dropped below the committee's quorum, can no longer have a resolution recorded.
 *   2. A genuinely-quorate meeting (live present >= required) still records an aggregate resolution.
 *   3. On that quorate meeting, an aggregate tally claiming MORE votes than members present is
 *      rejected by the headcount bound.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { runWithTenant } from "@civitasone/db";
import { NonRetryableError, type CommandEnvelope } from "@civitasone/queue";
import { sqlClient } from "../src/shared/db.js";
import { COMMANDS } from "../src/topics.js";
import { registerDecisionConsumers } from "../src/modules/decision/consumer.js";

const TENANT = "a0b8b3e6-57a1-4000-8000-00000000c001";
const ACTOR = randomUUID();

const COMMITTEE_Q = randomUUID(); // quorum rule: minMembers 2, active roster of 3
const MEETING_DROP = randomUUID(); // quorum_established latched true, but only 1 present now (< 2)
const MEETING_OK = randomUUID(); // quorum_established true, 2 present now (== 2, quorate)

const handlers = new Map<string, (msg: CommandEnvelope<any>) => Promise<void>>();
registerDecisionConsumers((topic, h) => handlers.set(topic, h as any));

function msg<T>(type: string, payload: T): CommandEnvelope<T> {
  return {
    messageId: randomUUID(),
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

/** Seed one participant + one attendance row with the given presence status on a meeting. */
async function seedAttendee(
  sql: typeof sqlClient,
  meetingId: string,
  status: "present" | "left_early" | "absent",
): Promise<void> {
  const participantId = randomUUID();
  await sql`
    insert into meeting.participants (id, tenant_id, meeting_id, employee_id, role, created_by, updated_by)
    values (${participantId}, ${TENANT}, ${meetingId}, ${randomUUID()}, 'member', ${ACTOR}, ${ACTOR})`;
  await sql`
    insert into meeting.attendance_records
      (id, tenant_id, meeting_id, participant_id, method, check_in_at, mode, status, created_by, updated_by)
    values (${randomUUID()}, ${TENANT}, ${meetingId}, ${participantId}, 'manual', '2025-06-01T09:00:00Z',
            'in_person', ${status}, ${ACTOR}, ${ACTOR})`;
}

beforeAll(async () => {
  await tenantQuery(async (sql) => {
    await sql`delete from meeting.votes where tenant_id = ${TENANT}`;
    await sql`delete from meeting.resolutions where tenant_id = ${TENANT}`;
    await sql`delete from meeting.attendance_records where tenant_id = ${TENANT}`;
    await sql`delete from meeting.participants where tenant_id = ${TENANT}`;
    await sql`delete from meeting.committee_members where tenant_id = ${TENANT}`;
    await sql`delete from meeting.meetings where tenant_id = ${TENANT}`;
    await sql`delete from meeting.committees where tenant_id = ${TENANT}`;
    await sql`delete from _outbox.messages where tenant_id = ${TENANT}`;

    // Quorum rule: at least 2 members present. Active roster of 3.
    await sql`
      insert into meeting.committees (id, tenant_id, name, code, type, constitution_date, quorum_rule, created_by, updated_by)
      values (${COMMITTEE_Q}, ${TENANT}, 'Quorum Committee', 'QC', 'board', '2025-01-01', ${sql.json({ minMembers: 2 })}, ${ACTOR}, ${ACTOR})`;
    await sql`
      insert into meeting.committee_members (id, tenant_id, committee_id, member_id, role, appointment_date, status, created_by, updated_by)
      values
        (${randomUUID()}, ${TENANT}, ${COMMITTEE_Q}, ${randomUUID()}, 'chairperson', '2025-01-01', 'active', ${ACTOR}, ${ACTOR}),
        (${randomUUID()}, ${TENANT}, ${COMMITTEE_Q}, ${randomUUID()}, 'member', '2025-01-01', 'active', ${ACTOR}, ${ACTOR}),
        (${randomUUID()}, ${TENANT}, ${COMMITTEE_Q}, ${randomUUID()}, 'member', '2025-01-01', 'active', ${ACTOR}, ${ACTOR})`;

    // Both meetings had quorum earlier, so `quorum_established` is latched TRUE on both.
    await sql`
      insert into meeting.meetings (id, tenant_id, type, title, status, committee_id, financial_year, scheduled_at, quorum_established, created_by, updated_by)
      values
        (${MEETING_DROP}, ${TENANT}, 'committee', 'Quorate-then-emptied meeting', 'in_progress', ${COMMITTEE_Q}, '2025-26', '2025-06-01T09:00:00Z', true, ${ACTOR}, ${ACTOR}),
        (${MEETING_OK}, ${TENANT}, 'committee', 'Still-quorate meeting', 'in_progress', ${COMMITTEE_Q}, '2025-26', '2025-06-01T09:00:00Z', true, ${ACTOR}, ${ACTOR})`;

    // MEETING_DROP: only 1 attendee still present (2 left) — live present 1 < required 2.
    await seedAttendee(sql, MEETING_DROP, "present");
    await seedAttendee(sql, MEETING_DROP, "left_early");
    await seedAttendee(sql, MEETING_DROP, "left_early");

    // MEETING_OK: 2 attendees present — live present 2 == required 2 (quorate).
    await seedAttendee(sql, MEETING_OK, "present");
    await seedAttendee(sql, MEETING_OK, "present");
  });
});

afterAll(async () => {
  await tenantQuery(async (sql) => {
    await sql`delete from meeting.votes where tenant_id = ${TENANT}`;
    await sql`delete from meeting.resolutions where tenant_id = ${TENANT}`;
    await sql`delete from meeting.attendance_records where tenant_id = ${TENANT}`;
    await sql`delete from meeting.participants where tenant_id = ${TENANT}`;
    await sql`delete from meeting.committee_members where tenant_id = ${TENANT}`;
    await sql`delete from meeting.meetings where tenant_id = ${TENANT}`;
    await sql`delete from meeting.committees where tenant_id = ${TENANT}`;
    await sql`delete from _outbox.messages where tenant_id = ${TENANT}`;
  });
  await sqlClient.end();
});

describe("[FIXED, Gap 2] resolution.record re-derives quorum LIVE instead of trusting the stale latch", () => {
  it("rejects a fabricated tally once live attendance has dropped below quorum, even with quorum_established still latched true", async () => {
    // Sanity: the latch really is still true — the OLD gate would have let this through.
    const meetingRow = await tenantQuery((sql) => sql`select quorum_established from meeting.meetings where id = ${MEETING_DROP}`);
    expect((meetingRow as any[])[0].quorum_established).toBe(true);

    const resolutionId = randomUUID();
    await expect(
      run(
        msg(COMMANDS.resolutionRecord, {
          resolutionId,
          meetingId: MEETING_DROP,
          tenantId: TENANT,
          text: "Resolved: business rammed through after the room emptied",
          voteType: "show_of_hands",
          majorityRule: "simple_majority",
          votesFor: 5,
          votesAgainst: 0,
          votesAbstain: 0,
        }),
      ),
    ).rejects.toBeInstanceOf(NonRetryableError);

    expect(await readResolution(resolutionId)).toBeNull();
  });

  it("confirms the fix: a legitimately-quorate meeting (live present >= required) still records an aggregate resolution", async () => {
    const resolutionId = randomUUID();
    await run(
      msg(COMMANDS.resolutionRecord, {
        resolutionId,
        meetingId: MEETING_OK,
        tenantId: TENANT,
        text: "Resolved: legitimate business, conducted while quorate",
        voteType: "show_of_hands",
        majorityRule: "simple_majority",
        votesFor: 2, // total 2 <= 2 present — within the live headcount
        votesAgainst: 0,
        votesAbstain: 0,
      }),
    );

    const row = await readResolution(resolutionId);
    expect(row).not.toBeNull();
    expect(row.status).toBe("effective");
    expect(row.result).toBe("passed");
    expect(row.votes_for).toBe(2);
  });

  it("rejects an aggregate tally claiming MORE votes than members present (the headcount bound)", async () => {
    const resolutionId = randomUUID();
    await expect(
      run(
        msg(COMMANDS.resolutionRecord, {
          resolutionId,
          meetingId: MEETING_OK,
          tenantId: TENANT,
          text: "Resolved: nine ayes in a room of two",
          voteType: "show_of_hands",
          majorityRule: "simple_majority",
          votesFor: 9, // total 9 > 2 present — impossible, must be rejected
          votesAgainst: 0,
          votesAbstain: 0,
        }),
      ),
    ).rejects.toBeInstanceOf(NonRetryableError);

    expect(await readResolution(resolutionId)).toBeNull();
  });
});
