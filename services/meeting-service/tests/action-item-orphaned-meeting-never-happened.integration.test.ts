/**
 * CROSS-MODULE INTEGRATION FINDING (MEDIUM/HIGH) — action items can be assigned
 * against a meeting that was cancelled before it ever started (no
 * `actual_start_at` at all — the textbook "meeting that never happened"), and
 * separately against a meeting cancelled well after it started. Neither path is
 * blocked.
 *
 * Root cause: `action-item/consumer.ts`'s `handleAssign` (consumer.ts:287
 * onward) calls `loadMeeting(tx, p.meetingId, msg.tenantId)` and only checks
 * that the meeting EXISTS (`if (!meeting) throw new NonRetryableError(...)`)
 * plus one temporal rule, `assertDeadlineAfterMeetingStart(deadline,
 * meeting.actualStartAt)` (action-item/domain.ts:282-289, P19/Req 9.1). It
 * never checks `meeting.status` at all — cancelled, draft, scheduled, closed,
 * anything goes.
 *
 * That temporal guard doesn't fill the gap either:
 * `isDeadlineAfterMeetingStart` (domain.ts:271-274) is explicitly documented as
 * vacuously true when there's no start to compare against —
 * `if (!actualStartAt) return true;`. So a meeting that is cancelled straight
 * out of `draft` (never reaches `in_progress`, `actual_start_at` stays NULL
 * forever) passes this check unconditionally, for ANY deadline.
 *
 * Proven live below: a meeting is created in `draft`, cancelled immediately
 * (legal: `draft -> cancelled` per meeting-core/domain.ts BASE_TRANSITIONS),
 * and never once starts. An action item is then successfully assigned against
 * it — persisted, escalation-scheduled, with a real assignee and deadline — for
 * a meeting that, by the system's own state machine, never happened. A second
 * case shows the same hole for a meeting cancelled AFTER it started and was
 * adjourned (`actual_start_at` is set, so the P19 guard is live and satisfied,
 * but `meeting.status` is just as unchecked).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { runWithTenant } from "@civitasone/db";
import type { CommandEnvelope } from "@civitasone/queue";
import { sqlClient } from "../src/shared/db.js";
import { COMMANDS } from "../src/topics.js";
import { registerMeetingCoreConsumers } from "../src/modules/meeting-core/consumer.js";
import { registerActionItemConsumers } from "../src/modules/action-item/consumer.js";

const TENANT = randomUUID();
const ACTOR = randomUUID();
const ASSIGNEE = randomUUID();

// Meeting that never starts: draft -> cancelled.
const MEETING_NEVER_STARTED = randomUUID();
const ACTION_ITEM_1 = randomUUID();

// Meeting that started, was adjourned, then cancelled.
const MEETING_STARTED_THEN_CANCELLED = randomUUID();
const ACTION_ITEM_2 = randomUUID();

const handlers = new Map<string, (msg: CommandEnvelope<any>) => Promise<void>>();
registerMeetingCoreConsumers((topic: string, h: any) => handlers.set(topic, h));
registerActionItemConsumers((topic: string, h: any) => handlers.set(topic, h));

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
    // chairperson_id: ACTOR — IDOR fix (Req 1.1): handleMeetingCancel now requires the caller to
    // be this meeting's own chairperson/secretary; this file's writes all publish as ACTOR, so
    // ACTOR is seeded as the chair directly on both fixture meetings below.
    await sql`
      insert into meeting.meetings
        (id, tenant_id, type, title, status, financial_year, scheduled_at, meeting_number, chairperson_id, created_by, updated_by)
      values (${MEETING_NEVER_STARTED}, ${TENANT}, 'committee', 'Never-Started Test Meeting', 'draft',
        '2025-26', ${new Date(Date.now() + 7 * 86400000).toISOString()}, ${"NS/2025-26/" + MEETING_NEVER_STARTED.slice(0, 8)}, ${ACTOR}, ${ACTOR}, ${ACTOR})`;

    await sql`
      insert into meeting.meetings
        (id, tenant_id, type, title, status, financial_year, scheduled_at, actual_start_at,
         quorum_established, adjournment_reason, meeting_number, chairperson_id, created_by, updated_by)
      values (${MEETING_STARTED_THEN_CANCELLED}, ${TENANT}, 'committee', 'Started-Then-Cancelled Test Meeting', 'adjourned',
        '2025-26', '2025-06-15T10:00:00Z', '2025-06-15T10:05:00Z', true, 'called off',
        ${"SC/2025-26/" + MEETING_STARTED_THEN_CANCELLED.slice(0, 8)}, ${ACTOR}, ${ACTOR}, ${ACTOR})`;
  });
});

afterAll(async () => {
  await tenantQuery(async (sql) => {
    await sql`delete from meeting.action_items where tenant_id = ${TENANT}`;
    await sql`delete from meeting.meeting_state_transitions where tenant_id = ${TENANT}`;
    await sql`delete from meeting.meetings where tenant_id = ${TENANT}`;
    await sql`delete from _outbox.messages where tenant_id = ${TENANT}`;
  });
  await sqlClient.end();
});

describe("action items can be assigned to meetings that never happened or were called off", () => {
  it("sanity: the never-started meeting is cancelled straight from draft (legal transition, actual_start_at stays null)", async () => {
    await run(msg(COMMANDS.meetingCancel, { meetingId: MEETING_NEVER_STARTED, version: 1, reason: "Committee dissolved before first sitting" }));
    const rows = await tenantQuery((sql) => sql`select status, actual_start_at from meeting.meetings where id = ${MEETING_NEVER_STARTED}`);
    expect((rows as any[])[0].status).toBe("cancelled");
    expect((rows as any[])[0].actual_start_at).toBeNull();
  });

  it("BUG: an action item is still successfully assigned against the never-started, cancelled meeting", async () => {
    const deadline = new Date(Date.now() + 3 * 86400000).toISOString();
    await run(msg(COMMANDS.actionItemAssign, {
      actionItemId: ACTION_ITEM_1, meetingId: MEETING_NEVER_STARTED, tenantId: TENANT,
      description: "Follow up on a decision from a meeting that never occurred",
      assigneeId: ASSIGNEE, deadline, priority: "medium",
    }));

    const rows = await tenantQuery((sql) => sql`select status, assignee_id, meeting_id from meeting.action_items where id = ${ACTION_ITEM_1}`);
    expect((rows as any[])[0]).toBeTruthy();
    expect((rows as any[])[0].status).toBe("assigned");
    expect((rows as any[])[0].meeting_id).toBe(MEETING_NEVER_STARTED);
  });

  it("BUG: an action item is also assignable against a meeting cancelled after it started and was adjourned", async () => {
    await run(msg(COMMANDS.meetingCancel, { meetingId: MEETING_STARTED_THEN_CANCELLED, version: 1, reason: "Committee dissolved mid-adjournment" }));
    const meetingRows = await tenantQuery((sql) => sql`select status from meeting.meetings where id = ${MEETING_STARTED_THEN_CANCELLED}`);
    expect((meetingRows as any[])[0].status).toBe("cancelled");

    const deadline = new Date(Date.now() + 3 * 86400000).toISOString();
    await run(msg(COMMANDS.actionItemAssign, {
      actionItemId: ACTION_ITEM_2, meetingId: MEETING_STARTED_THEN_CANCELLED, tenantId: TENANT,
      description: "Follow up on a decision from a meeting called off after it started",
      assigneeId: ASSIGNEE, deadline, priority: "high",
    }));

    const rows = await tenantQuery((sql) => sql`select status from meeting.action_items where id = ${ACTION_ITEM_2}`);
    expect((rows as any[])[0]?.status).toBe("assigned");
  });
});
