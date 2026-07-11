/**
 * meeting-core — consumer integration tests (real DB, no mocks).
 *
 * Exercises the meeting-core command handlers end-to-end against Postgres. Each handler runs
 * inside `runWithTenant(TENANT, …)` so the `app.tenant_id` GUC (RLS) is set exactly as the worker
 * does via `withTenantConsumer`. Asserts the committed DB effect (INSERT / versioned UPDATE /
 * state transition), the transactional-outbox events, the state-transition audit log (Req 1.7),
 * consumer idempotency (`markProcessed`, P30), and the permanent-error (DLQ) branches for illegal
 * transitions and unmet quorum.
 *
 * Covers: meeting.create, meeting.update, meeting.transition, meeting.cancel,
 * meeting.series.create/update/generate, meeting.meeting_type.create/update (Req 1.1–1.7, 14.5).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { runWithTenant } from "@civitasone/db";
import { NonRetryableError, type CommandEnvelope } from "@civitasone/queue";
import { sqlClient } from "../src/shared/db.js";
import { COMMANDS, EVENTS } from "../src/topics.js";
import { registerMeetingCoreConsumers } from "../src/modules/meeting-core/consumer.js";

const TENANT = "aaaaaaaa-3c11-4a1a-9b2c-0000000003c0";
const COMMITTEE = "bbbbbbbb-3c11-4a1a-9b2c-0000000003c0";
const CHAIR = "f1111111-3c11-4a1a-9b2c-0000000003c0";
const SECRETARY = "f0000000-3c11-4a1a-9b2c-0000000003c0";
const ACTOR = "0a000000-3c11-4a1a-9b2c-0000000003c0";

// Capture the registered handlers by topic.
const handlers = new Map<string, (msg: CommandEnvelope<any>) => Promise<void>>();
registerMeetingCoreConsumers((topic, h) => handlers.set(topic, h as any));

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

/** Invoke a handler inside the tenant ALS context so db.transaction sets the RLS GUC. */
function run<T>(m: CommandEnvelope<T>): Promise<void> {
  const handler = handlers.get(m.type);
  if (!handler) throw new Error(`no handler for ${m.type}`);
  return runWithTenant(TENANT, () => handler(m)) as Promise<void>;
}

/** Small tenant-scoped query helper. */
function q<T = any>(fn: (sql: typeof sqlClient) => Promise<T>): Promise<T> {
  return runWithTenant(TENANT, () =>
    sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
      return fn(sql as unknown as typeof sqlClient);
    }),
  ) as Promise<T>;
}

const readMeeting = (id: string) =>
  q((sql) => sql`select * from meeting.meetings where id = ${id}`).then((r: any) => r[0] ?? null);
const readSeries = (id: string) =>
  q((sql) => sql`select * from meeting.meeting_series where id = ${id}`).then((r: any) => r[0] ?? null);
const readType = (id: string) =>
  q((sql) => sql`select * from meeting.meeting_types where id = ${id}`).then((r: any) => r[0] ?? null);
const countTransitions = (meetingId: string) =>
  q((sql) => sql`select count(*)::int as n from meeting.meeting_state_transitions where meeting_id = ${meetingId}`).then(
    (r: any) => r[0].n as number,
  );
const countEvents = (topic: string, corr?: string) =>
  q((sql) =>
    corr
      ? sql`select count(*)::int as n from _outbox.messages where tenant_id = ${TENANT} and topic = ${topic} and correlation_id = ${corr}`
      : sql`select count(*)::int as n from _outbox.messages where tenant_id = ${TENANT} and topic = ${topic}`,
  ).then((r: any) => r[0].n as number);

/** Seed a meeting row directly in a chosen state (bypasses the state machine for setup). */
async function seedMeeting(row: {
  id: string;
  status: string;
  scheduledAt?: string;
  quorumEstablished?: boolean;
  actualStartAt?: string | null;
  committeeId?: string | null;
}): Promise<void> {
  await q(
    (sql) => sql`
      insert into meeting.meetings
        (id, tenant_id, type, title, status, committee_id, chairperson_id, secretary_id,
         scheduled_at, actual_start_at, quorum_established, duration_minutes, version, created_by, updated_by)
      values (${row.id}, ${TENANT}, 'committee', 'Test Meeting', ${row.status},
              ${row.committeeId ?? COMMITTEE}, ${CHAIR}, ${SECRETARY},
              ${row.scheduledAt ?? new Date(Date.now() + 7 * 86400000).toISOString()},
              ${row.actualStartAt ?? null}, ${row.quorumEstablished ?? false}, 60, 1, ${ACTOR}, ${ACTOR})
      on conflict (id) do nothing`,
  );
}

async function seedAgendaItem(meetingId: string): Promise<void> {
  await q(
    (sql) => sql`
      insert into meeting.agenda_items
        (id, tenant_id, meeting_id, sequence, title, outcome_type, created_by, updated_by)
      values (${randomUUID()}, ${TENANT}, ${meetingId}, 1, 'Item 1', 'decision', ${ACTOR}, ${ACTOR})`,
  );
}

beforeAll(async () => {
  await q(
    (sql) => sql`
      insert into meeting.committees (id, tenant_id, name, code, type, constitution_date, quorum_rule, created_by, updated_by)
      values (${COMMITTEE}, ${TENANT}, 'Finance Committee', 'FC', 'finance', '2020-01-01',
              ${sql.json({ minMembers: 2 })}, ${ACTOR}, ${ACTOR})
      on conflict (id) do nothing`,
  );
  // Active roster so series-generate can carry forward chairperson/secretary.
  await q(
    (sql) => sql`
      insert into meeting.committee_members (id, tenant_id, committee_id, member_id, role, appointment_date, status, created_by, updated_by)
      values (${randomUUID()}, ${TENANT}, ${COMMITTEE}, ${CHAIR}, 'chairperson', '2020-01-01', 'active', ${ACTOR}, ${ACTOR}),
             (${randomUUID()}, ${TENANT}, ${COMMITTEE}, ${SECRETARY}, 'secretary', '2020-01-01', 'active', ${ACTOR}, ${ACTOR})
      on conflict do nothing`,
  );
});

afterAll(async () => {
  await q((sql) => sql`delete from meeting.meeting_state_transitions where tenant_id = ${TENANT}`);
  await q((sql) => sql`delete from meeting.agenda_items where tenant_id = ${TENANT}`);
  await q((sql) => sql`delete from meeting.meetings where tenant_id = ${TENANT}`);
  await q((sql) => sql`delete from meeting.meeting_series where tenant_id = ${TENANT}`);
  await q((sql) => sql`delete from meeting.meeting_types where tenant_id = ${TENANT}`);
  await q((sql) => sql`delete from meeting.committee_members where tenant_id = ${TENANT}`);
  await q((sql) => sql`delete from meeting.committees where tenant_id = ${TENANT}`);
  await q((sql) => sql`delete from _outbox.messages where tenant_id = ${TENANT}`);
  await sqlClient.end();
});

// ─── meeting.create ──────────────────────────────────────────────────────────

describe("meeting.create", () => {
  it("inserts a draft meeting with a committee-scoped meeting number and emits meeting.created (P30 idempotent)", async () => {
    const id = randomUUID();
    const m = msg(COMMANDS.meetingCreate, {
      id,
      tenantId: TENANT,
      title: "Q1 Review",
      type: "committee",
      scheduledAt: new Date(Date.now() + 10 * 86400000).toISOString(),
      durationMinutes: 90,
      committeeId: COMMITTEE,
      chairpersonId: CHAIR,
      secretaryId: SECRETARY,
    });
    await run(m);

    const row = await readMeeting(id);
    expect(row?.status).toBe("draft");
    expect(row?.meeting_number).toMatch(/^FC\/\d{4}-\d{2}\/\d{3}$/);
    expect(row?.financial_year).toMatch(/^\d{4}-\d{2}$/);
    expect(await countEvents(EVENTS.meetingCreated, m.correlationId)).toBe(1);

    // Redelivery with the SAME messageId is a no-op (markProcessed skip).
    await run(m);
    const n = await q((sql) => sql`select count(*)::int as n from meeting.meetings where id = ${id}`).then(
      (r: any) => r[0].n,
    );
    expect(n).toBe(1);
  });

  it("uses the MTG prefix for an ad-hoc meeting with no committee", async () => {
    const id = randomUUID();
    await run(
      msg(COMMANDS.meetingCreate, {
        id,
        tenantId: TENANT,
        title: "Ad-hoc sync",
        type: "ad_hoc",
        scheduledAt: new Date(Date.now() + 3 * 86400000).toISOString(),
        durationMinutes: 30,
        chairpersonId: CHAIR,
        secretaryId: SECRETARY,
      }),
    );
    expect((await readMeeting(id))?.meeting_number).toMatch(/^MTG\/\d{4}-\d{2}\/\d{3}$/);
  });
});

// ─── meeting.update ──────────────────────────────────────────────────────────

describe("meeting.update", () => {
  it("applies an optimistic-locked field patch and bumps the version", async () => {
    const id = randomUUID();
    await seedMeeting({ id, status: "draft" });
    await run(msg(COMMANDS.meetingUpdate, { meetingId: id, version: 1, patch: { title: "Renamed", venue: "Room 5" } }));
    const row = await readMeeting(id);
    expect(row?.title).toBe("Renamed");
    expect(row?.venue).toBe("Room 5");
    expect(row?.version).toBe(2);
  });

  it("is a no-op for an unknown meeting (nothing to update)", async () => {
    await expect(
      run(msg(COMMANDS.meetingUpdate, { meetingId: randomUUID(), version: 1, patch: { title: "x" } })),
    ).resolves.toBeUndefined();
  });
});

// ─── meeting.transition ────────────────────────────────────────────────────────

describe("meeting.transition", () => {
  it("draft→scheduled records the transition, assigns nothing extra, and emits meeting.scheduled (Req 1.3, 1.7)", async () => {
    const id = randomUUID();
    await seedMeeting({ id, status: "draft", scheduledAt: new Date(Date.now() + 14 * 86400000).toISOString() });
    await seedAgendaItem(id);
    const m = msg(COMMANDS.meetingTransition, { meetingId: id, version: 1, to: "scheduled" });
    await run(m);

    const row = await readMeeting(id);
    expect(row?.status).toBe("scheduled");
    expect(await countTransitions(id)).toBe(1);
    expect(await countEvents(EVENTS.meetingScheduled, m.correlationId)).toBe(1);
  });

  it("rejects draft→scheduled without agenda items as a permanent (DLQ) error (Req 1.3)", async () => {
    const id = randomUUID();
    await seedMeeting({ id, status: "draft", scheduledAt: new Date(Date.now() + 14 * 86400000).toISOString() });
    await expect(run(msg(COMMANDS.meetingTransition, { meetingId: id, version: 1, to: "scheduled" }))).rejects.toBeInstanceOf(
      NonRetryableError,
    );
  });

  it("agenda_locked→in_progress records actual_start_at and emits meeting.started (Req 1.4)", async () => {
    const id = randomUUID();
    await seedMeeting({ id, status: "agenda_locked", quorumEstablished: true });
    const m = msg(COMMANDS.meetingTransition, { meetingId: id, version: 1, to: "in_progress" });
    await run(m);

    const row = await readMeeting(id);
    expect(row?.status).toBe("in_progress");
    expect(row?.actual_start_at).not.toBeNull();
    expect(await countEvents(EVENTS.meetingStarted, m.correlationId)).toBe(1);
  });

  it("rejects →in_progress without established quorum as a permanent (DLQ) error (Req 1.4)", async () => {
    const id = randomUUID();
    await seedMeeting({ id, status: "agenda_locked", quorumEstablished: false });
    await expect(run(msg(COMMANDS.meetingTransition, { meetingId: id, version: 1, to: "in_progress" }))).rejects.toBeInstanceOf(
      NonRetryableError,
    );
  });

  it("in_progress→adjourned records the adjournment reason (Req 1.5)", async () => {
    const id = randomUUID();
    await seedMeeting({ id, status: "in_progress", quorumEstablished: true, actualStartAt: new Date().toISOString() });
    await run(
      msg(COMMANDS.meetingTransition, {
        meetingId: id,
        version: 1,
        to: "adjourned",
        reason: "quorum lost",
        nextMeetingDate: new Date(Date.now() + 30 * 86400000).toISOString(),
      }),
    );
    const row = await readMeeting(id);
    expect(row?.status).toBe("adjourned");
    expect(row?.adjournment_reason).toBe("quorum lost");
    expect(row?.next_meeting_date).not.toBeNull();
  });

  it("rejects a structurally illegal transition (draft→in_progress) as a permanent error (Req 1.6)", async () => {
    const id = randomUUID();
    await seedMeeting({ id, status: "draft" });
    await expect(
      run(msg(COMMANDS.meetingTransition, { meetingId: id, version: 1, to: "in_progress" })),
    ).rejects.toBeInstanceOf(NonRetryableError);
  });

  it("rejects a transition to an unknown state as a permanent error", async () => {
    const id = randomUUID();
    await seedMeeting({ id, status: "draft" });
    await expect(
      run(msg(COMMANDS.meetingTransition, { meetingId: id, version: 1, to: "teleported" })),
    ).rejects.toBeInstanceOf(NonRetryableError);
  });

  it("is a no-op for an unknown meeting", async () => {
    await expect(
      run(msg(COMMANDS.meetingTransition, { meetingId: randomUUID(), version: 1, to: "scheduled" })),
    ).resolves.toBeUndefined();
  });
});

// ─── meeting.cancel ──────────────────────────────────────────────────────────

describe("meeting.cancel", () => {
  it("moves a meeting to the terminal cancelled state and emits meeting.cancelled (Req 1.6)", async () => {
    const id = randomUUID();
    await seedMeeting({ id, status: "scheduled" });
    const m = msg(COMMANDS.meetingCancel, { meetingId: id, version: 1, reason: "postponed indefinitely" });
    await run(m);

    const row = await readMeeting(id);
    expect(row?.status).toBe("cancelled");
    expect(await countTransitions(id)).toBe(1);
    expect(await countEvents(EVENTS.meetingCancelled, m.correlationId)).toBe(1);
  });
});

// ─── meeting.series.* ──────────────────────────────────────────────────────────

describe("meeting.series", () => {
  it("create inserts a recurring series and emits series.created", async () => {
    const id = randomUUID();
    const m = msg(COMMANDS.meetingSeriesCreate, {
      id,
      tenantId: TENANT,
      committeeId: COMMITTEE,
      pattern: "monthly",
      startDate: "2026-01-05",
      timeOfDay: "10:00",
      durationMinutes: 45,
    });
    await run(m);
    const row = await readSeries(id);
    expect(row?.pattern).toBe("monthly");
    expect(row?.is_active).toBe(true);
    expect(await countEvents(EVENTS.meetingSeriesCreated, m.correlationId)).toBe(1);
  });

  it("update applies an optimistic-locked patch", async () => {
    const id = randomUUID();
    await run(
      msg(COMMANDS.meetingSeriesCreate, {
        id,
        tenantId: TENANT,
        committeeId: COMMITTEE,
        pattern: "weekly",
        startDate: "2026-02-01",
      }),
    );
    await run(msg(COMMANDS.meetingSeriesUpdate, { seriesId: id, version: 1, patch: { isActive: false, durationMinutes: 30 } }));
    const row = await readSeries(id);
    expect(row?.is_active).toBe(false);
    expect(row?.duration_minutes).toBe(30);
    expect(row?.version).toBe(2);
  });

  it("generate materializes draft instances with committee carry-forward (Req 14.5) and is idempotent (P30)", async () => {
    const seriesId = randomUUID();
    await run(
      msg(COMMANDS.meetingSeriesCreate, {
        id: seriesId,
        tenantId: TENANT,
        committeeId: COMMITTEE,
        pattern: "monthly",
        startDate: "2026-03-01",
        timeOfDay: "09:30",
      }),
    );
    const gen = msg(COMMANDS.meetingSeriesGenerate, { seriesId, upToDate: "2026-05-15" });
    await run(gen);

    const instances = await q(
      (sql) => sql`select id, status, chairperson_id, secretary_id, scheduled_at from meeting.meetings where series_id = ${seriesId} order by scheduled_at`,
    );
    // Mar, Apr, May → 3 instances.
    expect(instances.length).toBe(3);
    expect(instances.every((r: any) => r.status === "draft")).toBe(true);
    expect(instances.every((r: any) => r.chairperson_id === CHAIR && r.secretary_id === SECRETARY)).toBe(true);
    expect(await countEvents(EVENTS.meetingSeriesGenerated, gen.correlationId)).toBe(1);

    // Redelivery of the SAME generate message must not create more instances (markProcessed skip).
    await run(gen);
    const after = await q(
      (sql) => sql`select count(*)::int as n from meeting.meetings where series_id = ${seriesId}`,
    ).then((r: any) => r[0].n);
    expect(after).toBe(3);
  });
});

// ─── meeting.meeting_type.* ─────────────────────────────────────────────────────

describe("meeting.meeting_type", () => {
  it("create inserts a meeting-type template and emits meeting_type.created", async () => {
    const id = randomUUID();
    const m = msg(COMMANDS.meetingTypeCreate, {
      id,
      tenantId: TENANT,
      code: "BRD",
      name: "Board Meeting",
      isStatutory: true,
      frequency: "quarterly",
    });
    await run(m);
    const row = await readType(id);
    expect(row?.code).toBe("BRD");
    expect(row?.is_statutory).toBe(true);
    expect(await countEvents(EVENTS.meetingTypeCreated, m.correlationId)).toBe(1);
  });

  it("update applies an optimistic-locked patch", async () => {
    const id = randomUUID();
    await run(msg(COMMANDS.meetingTypeCreate, { id, tenantId: TENANT, code: "AGM", name: "Annual General Meeting" }));
    await run(msg(COMMANDS.meetingTypeUpdate, { meetingTypeId: id, version: 1, patch: { name: "AGM (revised)" } }));
    const row = await readType(id);
    expect(row?.name).toBe("AGM (revised)");
    expect(row?.version).toBe(2);
  });
});
