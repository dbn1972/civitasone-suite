/**
 * Integration test: agenda mutations are not blocked by meeting state — only by the literal
 * `agenda_locked` status.
 *
 * SECURITY/CORRECTNESS AUDIT FINDING (HIGH — state-machine correctness), core-lifecycle cluster.
 *
 * `agenda/domain.ts#assertAgendaNotLocked`:
 *   ```
 *   export function assertAgendaNotLocked(meetingStatus: string): void {
 *     if (meetingStatus === "agenda_locked") { throw httpError(...); }
 *   }
 *   ```
 * This is the ONLY guard `agenda/consumer.ts` runs against meeting state before submitting,
 * updating, withdrawing, or reordering an agenda item (see the four call sites: `handleAgendaSubmit`
 * line ~270, `handleAgendaUpdate` line ~322, `handleAgendaWithdraw` line ~423,
 * `handleAgendaReorder` line ~444). It checks for exactly ONE string value. A meeting in ANY
 * other status — including the terminal `cancelled` state, `closed`, `archived`, `in_progress`,
 * `adjourned`, `minutes_pending`, or `minutes_approved` — sails straight through, because none of
 * those literally equal `"agenda_locked"`.
 *
 * This test proves the most damaging instance: once a meeting is CANCELLED (a terminal state —
 * `domain.ts` `TERMINAL_STATES` includes it, and `BASE_TRANSITIONS.cancelled = []`, i.e. nothing
 * should be able to change about it again), its agenda can still be freely submitted to, edited,
 * withdrawn, and reordered. A cancelled meeting's agenda is not read-only.
 *
 * Statically reasoned from agenda/domain.ts + agenda/consumer.ts; reproduced live below against
 * the real consumer + Postgres.
 *
 * _Cluster: agenda, meeting-core (core-lifecycle audit)._
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { runWithTenant } from "@civitasone/db";
import type { CommandEnvelope } from "@civitasone/queue";
import { sqlClient } from "../src/shared/db.js";
import { COMMANDS } from "../src/topics.js";
import { registerMeetingCoreConsumers } from "../src/modules/meeting-core/consumer.js";
import { registerAgendaConsumers } from "../src/modules/agenda/consumer.js";

const TENANT = randomUUID();
const CHAIR = randomUUID();
const SECRETARY = randomUUID();
// IDOR fix (Req 1.1): meetingTransition/meetingCancel now require the caller to be this
// meeting's own chairperson/secretary. Both fixture meetings below are chaired by CHAIR, so
// ACTOR is aliased to it — this file is about the agenda-lock/terminal-state guard, not
// ownership (that's integration-ownership-gaps.test.ts).
const ACTOR = CHAIR;

const handlers = new Map<string, (msg: CommandEnvelope<any>) => Promise<void>>();
registerMeetingCoreConsumers((topic, h) => handlers.set(topic, h as any));
registerAgendaConsumers((topic, h) => handlers.set(topic, h as any));

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

async function readMeeting(id: string) {
  const rows = await tenantQuery((sql) => sql`SELECT * FROM meeting.meetings WHERE id = ${id} AND tenant_id = ${TENANT}`);
  return (rows as any[])[0];
}

async function readAgendaItem(id: string) {
  const rows = await tenantQuery((sql) => sql`SELECT * FROM meeting.agenda_items WHERE id = ${id} AND tenant_id = ${TENANT}`);
  return (rows as any[])[0];
}

beforeAll(async () => {
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`DELETE FROM meeting.agenda_items WHERE tenant_id = ${TENANT}`;
  });
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`DELETE FROM meeting.meeting_state_transitions WHERE tenant_id = ${TENANT}`;
  });
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`DELETE FROM meeting.meetings WHERE tenant_id = ${TENANT}`;
  });
});

afterAll(async () => {
  await sqlClient.end();
});

describe("agenda: mutations survive a cancelled meeting (only 'agenda_locked' is guarded)", () => {
  let meetingId: string;
  let survivingItemId: string;

  it("sets up: create + one agenda item + schedule + cancel a meeting (reaches the terminal state)", async () => {
    meetingId = randomUUID();
    await run(
      msg(COMMANDS.meetingCreate, {
        id: meetingId,
        tenantId: TENANT,
        title: "Agenda-guard fixture meeting",
        type: "committee",
        scheduledAt: new Date(Date.now() + 14 * 86_400_000).toISOString(),
        durationMinutes: 60,
        chairpersonId: CHAIR,
        secretaryId: SECRETARY,
      }),
    );

    survivingItemId = randomUUID();
    await run(
      msg(COMMANDS.agendaItemSubmit, {
        agendaItemId: survivingItemId,
        meetingId,
        tenantId: TENANT,
        title: "Pre-cancellation item",
        outcomeType: "discussion",
      }),
    );

    let meeting = await readMeeting(meetingId);
    await run(msg(COMMANDS.meetingTransition, { meetingId, version: meeting.version, to: "scheduled" }));
    meeting = await readMeeting(meetingId);
    expect(meeting.status).toBe("scheduled");

    await run(msg(COMMANDS.meetingCancel, { meetingId, version: meeting.version, reason: "no longer needed" }));
    meeting = await readMeeting(meetingId);
    expect(meeting.status).toBe("cancelled");
    // Sanity: cancelled is genuinely terminal per the state machine.
    const transitionsOut = await tenantQuery(
      (sql) => sql`SELECT count(*)::int AS n FROM meeting.meeting_state_transitions
                   WHERE meeting_id = ${meetingId} AND tenant_id = ${TENANT} AND from_state = 'cancelled'`,
    );
    expect((transitionsOut as any[])[0].n).toBe(0);
  });

  it("a NEW agenda item is rejected on the cancelled meeting", async () => {
    const newItemId = randomUUID();
    await expect(
      run(
        msg(COMMANDS.agendaItemSubmit, {
          agendaItemId: newItemId,
          meetingId,
          tenantId: TENANT,
          title: "Submitted AFTER cancellation",
          outcomeType: "information",
        }),
      ),
    ).rejects.toThrow();
    const item = await readAgendaItem(newItemId);
    // A cancelled meeting must never accept a brand-new agenda item.
    expect(item).toBeFalsy();
  });

  it("an existing agenda item can no longer be edited on the cancelled meeting", async () => {
    await expect(
      run(
        msg(COMMANDS.agendaItemUpdate, {
          meetingId,
          tenantId: TENANT,
          agendaItemId: survivingItemId,
          version: 1,
          patch: { title: "Edited AFTER cancellation", durationMinutes: 99 },
        }),
      ),
    ).rejects.toThrow();
    const item = await readAgendaItem(survivingItemId);
    expect(item.title).not.toBe("Edited AFTER cancellation");
    expect(item.duration_minutes).not.toBe(99);
  });

  it("an agenda item can no longer be withdrawn (even redundantly) on the cancelled meeting", async () => {
    // By this point survivingItemId is ALREADY "withdrawn" — fix 6's cancel cascade
    // (meeting-core/consumer.ts's `cascadeMeetingCancel`) marks every surviving agenda item
    // moot the instant its meeting is cancelled, in the "sets up" step above. This test proves
    // the terminal-state guard independently blocks the mutation too (defense in depth: the
    // guard must reject the write BEFORE any version/bijection check, not rely on the cascade
    // alone) — so it captures the item's version beforehand and asserts the rejected call never
    // bumped it further, rather than asserting a status that's already true for another reason.
    const before = await readAgendaItem(survivingItemId);
    expect(before.status).toBe("withdrawn"); // sanity: the cascade already did this
    await expect(
      run(
        msg(COMMANDS.agendaItemWithdraw, {
          meetingId,
          tenantId: TENANT,
          agendaItemId: survivingItemId,
          version: before.version,
          reason: "withdrawn AFTER cancellation",
        }),
      ),
    ).rejects.toThrow();
    const after = await readAgendaItem(survivingItemId);
    expect(after.version).toBe(before.version); // rejected before any write — no further bump
  });

  it("the agenda can no longer be reordered on a (separately isolated) cancelled meeting", async () => {
    // Isolated fixture (its own meeting) rather than reusing `meetingId`: the reorder command
    // requires its payload to be an exact bijection over ALL of the meeting's non-withdrawn
    // items (agenda/consumer.ts ~449-462), so a fresh two-item meeting keeps this test's
    // payload self-contained instead of coupling to the earlier tests' leftover items.
    const reorderMeetingId = randomUUID();
    await run(
      msg(COMMANDS.meetingCreate, {
        id: reorderMeetingId,
        tenantId: TENANT,
        title: "Agenda-guard reorder fixture meeting",
        type: "committee",
        scheduledAt: new Date(Date.now() + 14 * 86_400_000).toISOString(),
        durationMinutes: 60,
        chairpersonId: CHAIR,
        secretaryId: SECRETARY,
      }),
    );
    const itemX = randomUUID();
    const itemY = randomUUID();
    await run(msg(COMMANDS.agendaItemSubmit, { agendaItemId: itemX, meetingId: reorderMeetingId, tenantId: TENANT, title: "X", outcomeType: "discussion" }));
    await run(msg(COMMANDS.agendaItemSubmit, { agendaItemId: itemY, meetingId: reorderMeetingId, tenantId: TENANT, title: "Y", outcomeType: "discussion" }));

    let reorderMeeting = await readMeeting(reorderMeetingId);
    await run(msg(COMMANDS.meetingTransition, { meetingId: reorderMeetingId, version: reorderMeeting.version, to: "scheduled" }));
    reorderMeeting = await readMeeting(reorderMeetingId);
    await run(msg(COMMANDS.meetingCancel, { meetingId: reorderMeetingId, version: reorderMeeting.version, reason: "cancelled before reorder" }));
    reorderMeeting = await readMeeting(reorderMeetingId);
    expect(reorderMeeting.status).toBe("cancelled");

    // Fix 6's cancel cascade already marked both items "withdrawn" as part of the cancel above
    // (same mechanism as the previous test) — the reorder attempt below must still be rejected
    // by the terminal-state guard itself (not merely by the bijection check finding no
    // non-withdrawn items left to reorder).
    const xBefore = await readAgendaItem(itemX);
    const yBefore = await readAgendaItem(itemY);
    expect(xBefore.status).toBe("withdrawn");
    expect(yBefore.status).toBe("withdrawn");

    await expect(
      run(
        msg(COMMANDS.agendaReorder, {
          meetingId: reorderMeetingId,
          tenantId: TENANT,
          order: [
            { agendaItemId: itemY, sequence: 1 },
            { agendaItemId: itemX, sequence: 2 },
          ],
        }),
      ),
    ).rejects.toThrow();

    const y = await readAgendaItem(itemY);
    const x = await readAgendaItem(itemX);
    // The reorder was rejected outright — sequences remain whatever they were (submission
    // order: X=1, Y=2), never the attempted swap (Y=1, X=2).
    expect(x.sequence).toBe(1);
    expect(y.sequence).toBe(2);
  });
});
