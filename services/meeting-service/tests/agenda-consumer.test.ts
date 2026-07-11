/**
 * Agenda module — consumer integration tests (task 5.2 coverage companion) against the real DB.
 *
 * Exercises the agenda command handlers end-to-end against Postgres inside `runWithTenant(TENANT, …)`
 * (sets the `app.tenant_id` GUC for RLS, exactly as the worker does via `withTenantConsumer`).
 *
 * Coverage focus (per task 5.2):
 *   • agenda.submit    — INSERT with a canonical contiguous 1..N sequence (P26) + emit
 *                        agenda.item_submitted; idempotent on redelivery (P30, same messageId)
 *   • agenda.submit    — enforces the AGENDA_LOCKED guard (422) and the submission-deadline guard (422)
 *   • agenda.update    — patch fields; a `deferred` status carries the item forward to the next
 *                        committee meeting (Req 3.6) and marks the source deferred
 *   • agenda.withdraw  — status → withdrawn
 *   • agenda.reorder   — validates the 1..N bijection + rewrites sequences transactionally
 *   • agenda.lock/unlock — moves the meeting in/out of agenda_locked + records the state transition
 *
 * Unlike the calendar consumer, the agenda handlers surface domain-rule violations as the service's
 * `HttpError` directly (no NonRetryableError wrapper), so rejections are asserted on the HttpError code.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { runWithTenant } from "@civitasone/db";
import type { CommandEnvelope } from "@civitasone/queue";
import { sqlClient } from "../src/shared/db.js";
import { HttpError } from "../src/shared/context.js";
import { COMMANDS, EVENTS } from "../src/topics.js";
import { registerAgendaConsumers } from "../src/modules/agenda/consumer.js";

const TENANT = "a5a5a5a5-0000-4000-8000-000000000504";
const ACTOR = "90000000-0000-4000-8000-000000000504";
const MEETING = "b5b5b5b5-0000-4000-8000-000000000504";
const NEXT_MEETING = "b6b6b6b6-0000-4000-8000-000000000504";
const LOCKED_MEETING = "b7b7b7b7-0000-4000-8000-000000000504";
const DEADLINE_MEETING = "b8b8b8b8-0000-4000-8000-000000000504";
const COMMITTEE = "c5c5c5c5-0000-4000-8000-000000000504";

// MEETING is scheduled far in the future so the submission deadline is open.
const FUTURE = "2035-01-15T10:00:00.000Z";
// NEXT_MEETING is the later meeting of the same committee (carry-forward target).
const FUTURE_NEXT = "2035-02-15T10:00:00.000Z";
// DEADLINE_MEETING is scheduled ~now so a fresh submission is past its 7-day cut-off.
const SOON = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();

const handlers = new Map<string, (msg: CommandEnvelope<any>) => Promise<void>>();
registerAgendaConsumers((topic, h) => handlers.set(topic, h as any));

function msg<T>(type: string, payload: T, messageId = randomUUID()): CommandEnvelope<T> {
  return { messageId, type, tenantId: TENANT, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0", payload } as CommandEnvelope<T>;
}

function run<T>(m: CommandEnvelope<T>): Promise<void> {
  const handler = handlers.get(m.type);
  if (!handler) throw new Error(`no handler for ${m.type}`);
  return runWithTenant(TENANT, () => handler(m)) as Promise<void>;
}

async function query<T = any>(fn: (sql: typeof sqlClient) => Promise<T>): Promise<T> {
  return runWithTenant(TENANT, () =>
    sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
      return fn(sql as unknown as typeof sqlClient);
    }),
  ) as Promise<T>;
}

async function agendaRows(meetingId: string): Promise<any[]> {
  return query((sql) => sql`
    select id, sequence, status, category, deferred_to, version
    from meeting.agenda_items
    where tenant_id = ${TENANT} and meeting_id = ${meetingId}
    order by sequence asc`);
}

async function outboxCount(topic: string): Promise<number> {
  const rows = await query((sql) => sql`
    select count(*)::int as n from _outbox.messages where tenant_id = ${TENANT} and topic = ${topic}`);
  return rows[0].n as number;
}

async function meetingStatus(meetingId: string): Promise<string> {
  const rows = await query((sql) => sql`select status from meeting.meetings where id = ${meetingId}`);
  return rows[0].status as string;
}

beforeAll(async () => {
  await query(async (sql) => {
    await sql`
      insert into meeting.meetings (id, tenant_id, type, title, status, committee_id, scheduled_at, duration_minutes, created_by, updated_by)
      values
        (${MEETING}, ${TENANT}, 'committee', 'Agenda Consumer', 'scheduled', ${COMMITTEE}, ${FUTURE}, 60, ${ACTOR}, ${ACTOR}),
        (${NEXT_MEETING}, ${TENANT}, 'committee', 'Next Committee Meeting', 'scheduled', ${COMMITTEE}, ${FUTURE_NEXT}, 60, ${ACTOR}, ${ACTOR}),
        (${LOCKED_MEETING}, ${TENANT}, 'committee', 'Locked Agenda', 'agenda_locked', ${COMMITTEE}, ${FUTURE}, 60, ${ACTOR}, ${ACTOR}),
        (${DEADLINE_MEETING}, ${TENANT}, 'committee', 'Deadline Agenda', 'scheduled', ${COMMITTEE}, ${SOON}, 60, ${ACTOR}, ${ACTOR})
      on conflict (id) do nothing`;
    return null;
  });
});

afterAll(async () => {
  await query(async (sql) => {
    await sql`delete from meeting.agenda_items where tenant_id = ${TENANT}`;
    await sql`delete from meeting.meeting_state_transitions where tenant_id = ${TENANT}`;
    await sql`delete from meeting.meetings where tenant_id = ${TENANT}`;
    await sql`delete from _outbox.messages where tenant_id = ${TENANT}`;
    return null;
  });
  await sqlClient.end();
});

describe("agenda.submit", () => {
  it("inserts items with a canonical contiguous 1..N sequence by category (P26) and emits item_submitted", async () => {
    const before = await outboxCount(EVENTS.agendaItemSubmitted);
    // Submit out of category order; ordering must place standing first, then arising, then new_business.
    const newId = randomUUID();
    const standId = randomUUID();
    const ariseId = randomUUID();
    await run(msg(COMMANDS.agendaItemSubmit, { agendaItemId: newId, meetingId: MEETING, tenantId: TENANT, title: "New biz", outcomeType: "discussion", category: "new_business" }));
    await run(msg(COMMANDS.agendaItemSubmit, { agendaItemId: standId, meetingId: MEETING, tenantId: TENANT, title: "Standing", outcomeType: "information", category: "standing" }));
    await run(msg(COMMANDS.agendaItemSubmit, { agendaItemId: ariseId, meetingId: MEETING, tenantId: TENANT, title: "Arising", outcomeType: "decision", category: "arising_from_minutes" }));

    const rows = await agendaRows(MEETING);
    expect(rows.map((r) => r.sequence)).toEqual([1, 2, 3]); // contiguous, gap/dup-free
    expect(rows.map((r) => r.id)).toEqual([standId, ariseId, newId]); // standing → arising → new_business
    expect(await outboxCount(EVENTS.agendaItemSubmitted)).toBe(before + 3);
  });

  it("is idempotent on redelivery of the same messageId (P30)", async () => {
    const id = randomUUID();
    const m = msg(COMMANDS.agendaItemSubmit, { agendaItemId: id, meetingId: MEETING, tenantId: TENANT, title: "Once", outcomeType: "discussion", category: "standing" });
    const before = await outboxCount(EVENTS.agendaItemSubmitted);
    await run(m);
    await run(m); // redelivery — markProcessed skip
    const rows = await agendaRows(MEETING);
    expect(rows.filter((r) => r.id === id)).toHaveLength(1);
    expect(await outboxCount(EVENTS.agendaItemSubmitted)).toBe(before + 1);
  });

  it("no-ops for an unknown meeting (never throws)", async () => {
    await expect(
      run(msg(COMMANDS.agendaItemSubmit, { agendaItemId: randomUUID(), meetingId: randomUUID(), tenantId: TENANT, title: "orphan", outcomeType: "discussion" })),
    ).resolves.toBeUndefined();
  });

  it("rejects submission when the agenda is locked (MEETING_AGENDA_LOCKED, 422)", async () => {
    try {
      await run(msg(COMMANDS.agendaItemSubmit, { agendaItemId: randomUUID(), meetingId: LOCKED_MEETING, tenantId: TENANT, title: "blocked", outcomeType: "discussion" }));
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(HttpError);
      expect((err as HttpError).code).toBe("MEETING_AGENDA_LOCKED");
      expect((err as HttpError).status).toBe(422);
    }
  });

  it("rejects submission past the deadline without chairperson approval (MEETING_PAST_DEADLINE, 422)", async () => {
    try {
      await run(msg(COMMANDS.agendaItemSubmit, { agendaItemId: randomUUID(), meetingId: DEADLINE_MEETING, tenantId: TENANT, title: "late", outcomeType: "discussion" }));
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as HttpError).code).toBe("MEETING_PAST_DEADLINE");
      expect((err as HttpError).status).toBe(422);
    }
  });
});

describe("agenda.update", () => {
  it("patches editable fields with an optimistic-locked version bump", async () => {
    const id = randomUUID();
    await run(msg(COMMANDS.agendaItemSubmit, { agendaItemId: id, meetingId: MEETING, tenantId: TENANT, title: "Editable", outcomeType: "discussion", category: "standing" }));
    await run(msg(COMMANDS.agendaItemUpdate, { meetingId: MEETING, agendaItemId: id, version: 1, patch: { title: "Edited", status: "accepted", durationMinutes: 30 } }));
    const row = (await agendaRows(MEETING)).find((r) => r.id === id)!;
    expect(row.status).toBe("accepted");
    expect(row.version).toBe(2);
  });

  it("carries a deferred item forward to the next committee meeting (Req 3.6) and marks the source deferred", async () => {
    const id = randomUUID();
    await run(msg(COMMANDS.agendaItemSubmit, { agendaItemId: id, meetingId: MEETING, tenantId: TENANT, title: "Deferrable", outcomeType: "decision", category: "new_business" }));
    const submittedBefore = await outboxCount(EVENTS.agendaItemSubmitted);

    await run(msg(COMMANDS.agendaItemUpdate, { meetingId: MEETING, agendaItemId: id, version: 1, patch: { status: "deferred" } }));

    const source = (await agendaRows(MEETING)).find((r) => r.id === id)!;
    expect(source.status).toBe("deferred");
    expect(source.deferred_to).toBeTruthy();

    const carried = (await agendaRows(NEXT_MEETING)).find((r) => r.id === source.deferred_to)!;
    expect(carried).toBeTruthy();
    expect(carried.status).toBe("carried_forward");
    // A new submitted event was emitted for the carried-forward item on the next meeting.
    expect(await outboxCount(EVENTS.agendaItemSubmitted)).toBe(submittedBefore + 1);
  });
});

describe("agenda.withdraw", () => {
  it("flips an item to withdrawn", async () => {
    const id = randomUUID();
    await run(msg(COMMANDS.agendaItemSubmit, { agendaItemId: id, meetingId: MEETING, tenantId: TENANT, title: "ToWithdraw", outcomeType: "information", category: "standing" }));
    await run(msg(COMMANDS.agendaItemWithdraw, { meetingId: MEETING, agendaItemId: id, version: 1, reason: "duplicate" }));
    const row = (await agendaRows(MEETING)).find((r) => r.id === id)!;
    expect(row.status).toBe("withdrawn");
  });
});

describe("agenda.reorder", () => {
  it("rewrites sequences per a valid 1..N bijection (P26) transactionally", async () => {
    // Reorder every non-withdrawn item of MEETING in reverse of the current sequence.
    const current = (await agendaRows(MEETING)).filter((r) => r.status !== "withdrawn");
    const n = current.length;
    const order = current.map((r, i) => ({ agendaItemId: r.id, sequence: n - i }));
    await run(msg(COMMANDS.agendaReorder, { meetingId: MEETING, order }));

    const after = (await agendaRows(MEETING)).filter((r) => r.status !== "withdrawn");
    const seqs = after.map((r) => r.sequence).sort((a, b) => a - b);
    expect(seqs).toEqual(Array.from({ length: n }, (_, i) => i + 1)); // still contiguous 1..N
  });

  it("rejects a payload that does not cover the meeting's items (VALIDATION_FAILED, 400)", async () => {
    try {
      await run(msg(COMMANDS.agendaReorder, { meetingId: MEETING, order: [{ agendaItemId: randomUUID(), sequence: 1 }] }));
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(HttpError);
      expect((err as HttpError).code).toBe("VALIDATION_FAILED");
      expect((err as HttpError).status).toBe(400);
    }
  });

  it("rejects reordering a locked agenda (MEETING_AGENDA_LOCKED, 422)", async () => {
    try {
      await run(msg(COMMANDS.agendaReorder, { meetingId: LOCKED_MEETING, order: [{ agendaItemId: randomUUID(), sequence: 1 }] }));
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as HttpError).code).toBe("MEETING_AGENDA_LOCKED");
    }
  });
});

describe("agenda.lock / unlock", () => {
  it("locks a scheduled meeting, records the transition, and emits agenda.locked", async () => {
    const before = await outboxCount(EVENTS.agendaLocked);
    await run(msg(COMMANDS.agendaLock, { meetingId: MEETING, version: 1, locked: true }));
    expect(await meetingStatus(MEETING)).toBe("agenda_locked");
    expect(await outboxCount(EVENTS.agendaLocked)).toBe(before + 1);

    const transitions = await query((sql) => sql`
      select from_state, to_state from meeting.meeting_state_transitions
      where tenant_id = ${TENANT} and meeting_id = ${MEETING} order by transitioned_at desc limit 1`);
    expect(transitions[0]).toMatchObject({ to_state: "agenda_locked" });
  });

  it("is an idempotent no-op when the meeting is already in the target state", async () => {
    const before = await outboxCount(EVENTS.agendaLocked);
    // MEETING is already agenda_locked from the previous test → re-locking does nothing.
    await run(msg(COMMANDS.agendaLock, { meetingId: MEETING, version: 2, locked: true }));
    expect(await outboxCount(EVENTS.agendaLocked)).toBe(before);
  });

  it("unlocks back to scheduled (chairperson unlock path)", async () => {
    await run(msg(COMMANDS.agendaLock, { meetingId: MEETING, version: 2, locked: false }));
    expect(await meetingStatus(MEETING)).toBe("scheduled");
  });
});
