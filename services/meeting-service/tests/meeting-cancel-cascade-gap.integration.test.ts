/**
 * CROSS-MODULE INTEGRATION FINDING (CRITICAL) — cancelling a meeting cascades to
 * NOTHING outside the `meetings` row itself: its agenda items, any in-flight
 * (voting_open) resolution and the individual votes on it, its confirmed room
 * booking, its active VC session, and its participants all keep whatever state
 * they had the instant before cancellation — forever. No notification is sent
 * to participants either.
 *
 * Root cause: `meeting-core/consumer.ts`'s `handleMeetingCancel`
 * (consumer.ts:649-666) does exactly two things inside its transaction —
 * `applyTransition(tx, ..., { to: "cancelled", ... })` and `audit(tx, msg,
 * "cancel", "meeting", p.meetingId)` — then invalidates one cache key. That is
 * the ENTIRE handler. `meeting-core/consumer.ts` never imports
 * `resolutions`/`votes` (voting/decision schema), `room_bookings` (calendar
 * schema), or `vc_sessions` (vc-integration schema) at all — it is structurally
 * incapable of touching them. A repo-wide check confirms no consumer.ts in this
 * service ever calls `queue.publish()` to hand off to another module's command
 * (grep across every `consumer.ts` under `src/modules` for `.publish(` returns
 * zero hits — commands.ts/routes.ts publish COMMANDS as write-intents from HTTP
 * routes, but no consumer ever re-publishes a command to trigger a sibling
 * module). Cross-module effects in this codebase only happen when a handler
 * directly imports and writes another module's Drizzle table in the same
 * transaction; meeting-core's cancel handler does neither for calendar,
 * vc-integration, voting, or decision.
 *
 * The state machine (meeting-core/domain.ts BASE_TRANSITIONS) makes this a real,
 * reachable scenario, not a hypothetical: `cancel` is legal from `draft`,
 * `scheduled`, `agenda_locked`, AND `adjourned` — and `adjourned` is only
 * reachable via `in_progress -> adjourn`. So `in_progress -> adjourned ->
 * cancelled` is a fully legal path, meaning a meeting CAN be cancelled after it
 * already has agenda items, a room booking, a live VC session, and an
 * open (not yet concluded) resolution with votes already cast on it.
 *
 * Contrast with participant/consumer.ts, which DOES correctly wire
 * `notification.send` fan-out for invitations (Req 15.3) — the notification
 * mechanism itself works fine elsewhere in this service; meeting-core's cancel
 * path simply never calls it.
 *
 * Proven live below against real Postgres: after cancelling a meeting that was
 * adjourned mid-session with an open vote, a room booking, and an active VC
 * session — every one of those stays exactly as it was, and (the sharpest
 * consequence) a committee member can still successfully cast a vote on the
 * "cancelled" meeting's still-`voting_open` resolution.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { runWithTenant } from "@civitasone/db";
import type { CommandEnvelope } from "@civitasone/queue";
import { sqlClient } from "../src/shared/db.js";
import { COMMANDS } from "../src/topics.js";
import { registerMeetingCoreConsumers } from "../src/modules/meeting-core/consumer.js";
import { registerVotingConsumers } from "../src/modules/voting/consumer.js";

const TENANT = randomUUID();
const COMMITTEE = randomUUID();
const MEETING = randomUUID();
const ROOM = randomUUID();
const ROOM_BOOKING = randomUUID();
const VC_SESSION = randomUUID();
const RESOLUTION = randomUUID();
const AGENDA_ITEM = randomUUID();
const ACTOR = randomUUID();
const MEMBER_A = randomUUID();
const MEMBER_B = randomUUID();

const handlers = new Map<string, (msg: CommandEnvelope<any>) => Promise<void>>();
registerMeetingCoreConsumers((topic: string, h: any) => handlers.set(topic, h));
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
async function meetingStatus(): Promise<string> {
  const rows = await tenantQuery((sql) => sql`select status from meeting.meetings where id = ${MEETING}`);
  return (rows as any[])[0].status as string;
}
async function outboxCount(topic: string): Promise<number> {
  const rows = await tenantQuery(
    (sql) => sql`select count(*)::int as n from _outbox.messages where tenant_id = ${TENANT} and topic = ${topic}`,
  );
  return (rows as any[])[0].n as number;
}

beforeAll(async () => {
  await tenantQuery(async (sql) => {
    // Committee, quorum 2 of 2.
    await sql`
      insert into meeting.committees (id, tenant_id, name, code, type, constitution_date, quorum_rule, created_by, updated_by)
      values (${COMMITTEE}, ${TENANT}, 'Cancel-Cascade Test Committee', 'CCT', 'standing', '2025-01-01',
        ${sql.json({ minMembers: 2 })}, ${ACTOR}, ${ACTOR})`;
    for (const m of [MEMBER_A, MEMBER_B]) {
      await sql`
        insert into meeting.committee_members (id, tenant_id, committee_id, member_id, role, appointment_date, status, created_by, updated_by)
        values (${randomUUID()}, ${TENANT}, ${COMMITTEE}, ${m}, 'member', '2025-01-01', 'active', ${ACTOR}, ${ACTOR})`;
    }

    // Meeting seeded directly in ADJOURNED — the only reachable pre-cancel state in which an
    // open resolution, room booking, and VC session can already exist (in_progress -> adjourned
    // -> cancelled is a legal path per BASE_TRANSITIONS; cancel is not legal from in_progress
    // directly, so a real caller MUST pass through adjourned to get here with this state).
    await sql`
      insert into meeting.meetings
        (id, tenant_id, type, title, status, committee_id, financial_year, scheduled_at,
         actual_start_at, quorum_established, adjournment_reason, meeting_number, created_by, updated_by)
      values (${MEETING}, ${TENANT}, 'committee', 'Cancel-Cascade Test Meeting', 'adjourned', ${COMMITTEE},
        '2025-26', '2025-06-15T10:00:00Z', '2025-06-15T10:05:00Z', true, 'lunch break',
        ${"CCT/2025-26/" + MEETING.slice(0, 8)}, ${ACTOR}, ${ACTOR})`;

    // Agenda item, still "accepted" — nothing should ever mark it moot.
    await sql`
      insert into meeting.agenda_items
        (id, tenant_id, meeting_id, sequence, title, outcome_type, status, created_by, updated_by)
      values (${AGENDA_ITEM}, ${TENANT}, ${MEETING}, 1, 'Approve annual budget', 'decision', 'accepted', ${ACTOR}, ${ACTOR})`;

    // Room + a CONFIRMED booking for this meeting.
    await sql`
      insert into meeting.rooms (id, tenant_id, name, capacity, created_by, updated_by)
      values (${ROOM}, ${TENANT}, 'Cancel-Cascade Test Room', 20, ${ACTOR}, ${ACTOR})`;
    await sql`
      insert into meeting.room_bookings (id, tenant_id, room_id, meeting_id, start_at, end_at, status, created_by, updated_by)
      values (${ROOM_BOOKING}, ${TENANT}, ${ROOM}, ${MEETING}, '2025-06-15T10:00:00Z', '2025-06-15T11:00:00Z', 'confirmed', ${ACTOR}, ${ACTOR})`;

    // An ACTIVE VC session for this meeting.
    await sql`
      insert into meeting.vc_sessions (id, tenant_id, meeting_id, provider, external_id, status, started_at, created_by, updated_by)
      values (${VC_SESSION}, ${TENANT}, ${MEETING}, 'nic_vc', 'ext-cancel-cascade-1', 'active', '2025-06-15T10:05:00Z', ${ACTOR}, ${ACTOR})`;

    // An OPEN resolution (votes were being taken when the meeting was adjourned).
    await sql`
      insert into meeting.resolutions
        (id, tenant_id, meeting_id, resolution_number, text, vote_type, majority_rule, result, status, created_by, updated_by)
      values (${RESOLUTION}, ${TENANT}, ${MEETING}, ${"PENDING-" + RESOLUTION}, 'Approve emergency repairs', 'roll_call',
        'simple_majority', 'pending', 'voting_open', ${ACTOR}, ${ACTOR})`;
  });
});

afterAll(async () => {
  await tenantQuery(async (sql) => {
    await sql`delete from meeting.votes where tenant_id = ${TENANT}`;
    await sql`delete from meeting.resolutions where tenant_id = ${TENANT}`;
    await sql`delete from meeting.agenda_items where tenant_id = ${TENANT}`;
    await sql`delete from meeting.vc_sessions where tenant_id = ${TENANT}`;
    await sql`delete from meeting.room_bookings where tenant_id = ${TENANT}`;
    await sql`delete from meeting.rooms where tenant_id = ${TENANT}`;
    await sql`delete from meeting.meeting_state_transitions where tenant_id = ${TENANT}`;
    await sql`delete from meeting.meetings where tenant_id = ${TENANT}`;
    await sql`delete from meeting.committee_members where tenant_id = ${TENANT}`;
    await sql`delete from meeting.committees where tenant_id = ${TENANT}`;
    await sql`delete from _outbox.messages where tenant_id = ${TENANT}`;
  });
  await sqlClient.end();
});

describe("meeting cancel -> nothing downstream is cascaded", () => {
  it("sanity: cancelling the meeting does correctly update its own status (adjourned -> cancelled is legal)", async () => {
    await run(msg(COMMANDS.meetingCancel, { meetingId: MEETING, version: 1, reason: "Committee stood down" }));
    expect(await meetingStatus()).toBe("cancelled");
  });

  it.fails("[BUG] the agenda item should be marked moot/withdrawn once its meeting is cancelled", async () => {
    const rows = await tenantQuery((sql) => sql`select status from meeting.agenda_items where id = ${AGENDA_ITEM}`);
    // This currently stays "accepted" — proves the point either way, but frame the assertion
    // as an explicit affirmative check so a future fix (any non-"accepted" moot-like status)
    // makes this test fail loudly rather than silently no-op.
    expect((rows as any[])[0].status).not.toBe("accepted");
  });

  it.fails("[BUG] the open resolution should be voided, not left voting_open, once its meeting is cancelled", async () => {
    const rows = await tenantQuery((sql) => sql`select status from meeting.resolutions where id = ${RESOLUTION}`);
    expect((rows as any[])[0].status).not.toBe("voting_open");
  });

  it.fails("[BUG] the confirmed room booking should be released once its meeting is cancelled", async () => {
    const rows = await tenantQuery((sql) => sql`select status from meeting.room_bookings where id = ${ROOM_BOOKING}`);
    expect((rows as any[])[0].status).not.toBe("confirmed");
  });

  it.fails("[BUG] the active VC session should be ended once its meeting is cancelled", async () => {
    const rows = await tenantQuery((sql) => sql`select status from meeting.vc_sessions where id = ${VC_SESSION}`);
    expect((rows as any[])[0].status).not.toBe("active");
  });

  it("[BUG] participants should be notified that their meeting was cancelled", async () => {
    // Contrast: participant/consumer.ts's invitationsSend path DOES emit notification.send
    // correctly (Req 15.3) — the mechanism works. meeting-core's cancel handler just never
    // calls it: zero notification.send rows were enqueued by the cancel above.
    expect(await outboxCount("notification.send")).toBe(0);
  });

  it("BUG: a member can still successfully cast a vote on the cancelled meeting's still-open resolution", async () => {
    // handleVoteCast (voting/consumer.ts) only checks resolution.status === "voting_open" — it
    // never looks at the parent meeting's status at all. Since cancel never touched the
    // resolution, this exploit fully succeeds: a formal vote is cast, recorded, and will tally
    // into a resolution NUMBER + DSC-hash-anchored official record on conclude, all on behalf of
    // a meeting the system itself has recorded as "cancelled".
    await run(msg(COMMANDS.voteCast, { meetingId: MEETING, resolutionId: RESOLUTION, memberId: MEMBER_A, position: "for", tenantId: TENANT }));

    const voteRows = await tenantQuery(
      (sql) => sql`select position from meeting.votes where resolution_id = ${RESOLUTION} and member_id = ${MEMBER_A} and tenant_id = ${TENANT}`,
    );
    expect((voteRows as any[])[0]?.position).toBe("for");

    const resRows = await tenantQuery((sql) => sql`select status from meeting.resolutions where id = ${RESOLUTION}`);
    expect((resRows as any[])[0].status).toBe("voting_open"); // still open — conclude would succeed too
  });
});
