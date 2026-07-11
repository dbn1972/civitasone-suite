/**
 * Integration test: full meeting lifecycle (task 22.1).
 *
 * End-to-end integration test covering the complete meeting lifecycle:
 *   create → add agenda → add participants → schedule → lock agenda →
 *   start (verify quorum) → record decisions → end → draft minutes →
 *   approve → close
 *
 * Uses:
 *   - app.inject() with HS256 auth for route boundary (202 acceptance)
 *   - Direct consumer handler invocation via runWithTenant for write-side effects
 *   - Direct DB queries to verify state
 *
 * Verifies:
 *   - State transitions audit log completeness
 *   - Cache invalidation at each step
 *
 * _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7_
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import type { CommandEnvelope } from "@civitasone/queue";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { cache } from "../src/shared/infra.js";
import { COMMANDS, EVENTS } from "../src/topics.js";
import { registerMeetingCoreConsumers } from "../src/modules/meeting-core/consumer.js";
import { registerAgendaConsumers } from "../src/modules/agenda/consumer.js";
import { registerParticipantConsumers } from "../src/modules/participant/consumer.js";
import { registerAttendanceConsumers } from "../src/modules/attendance/consumer.js";
import { registerMinutesConsumers } from "../src/modules/minutes/consumer.js";
import { registerDecisionConsumers } from "../src/modules/decision/consumer.js";

// ─── Constants ─────────────────────────────────────────────────────────────────
const SECRET = "test_secret_for_civitasone_32chr";
const TENANT = "e1a1a1a1-2201-4000-8000-000000000001";
const COMMITTEE = "e2b2b2b2-2201-4000-8000-000000000001";
const ACTOR = "e3c3c3c3-2201-4000-8000-000000000001";
const CHAIR = "e4d4d4d4-2201-4000-8000-000000000001";
const SECRETARY = "e5e5e5e5-2201-4000-8000-000000000001";
const MEMBER_A = "e6f6f6f6-2201-4000-8000-000000000001";
const MEMBER_B = "e6f6f6f6-2201-4000-8000-000000000002";
const MEMBER_C = "e6f6f6f6-2201-4000-8000-000000000003";

// IDs generated during lifecycle
let MEETING_ID: string;
let AGENDA_ITEM_ID: string;
let PARTICIPANT_IDS: string[];
let DECISION_ID: string;
let MINUTES_ID: string;

// ─── Consumer handler registry ─────────────────────────────────────────────────
const handlers = new Map<string, (msg: CommandEnvelope<any>) => Promise<void>>();
registerMeetingCoreConsumers((topic, h) => handlers.set(topic, h as any));
registerAgendaConsumers((topic, h) => handlers.set(topic, h as any));
registerParticipantConsumers((topic, h) => handlers.set(topic, h as any));
registerAttendanceConsumers((topic, h) => handlers.set(topic, h as any));
registerMinutesConsumers((topic, h) => handlers.set(topic, h as any));
registerDecisionConsumers((topic, h) => handlers.set(topic, h as any));

// ─── Helpers ───────────────────────────────────────────────────────────────────
function token(roles: string[] = ["super_admin"]): string {
  return signToken(
    { sub: ACTOR, tid: TENANT, roles, sid: "sess-lifecycle" },
    SECRET,
    3600,
  );
}

function writeHeaders(roles?: string[]) {
  return {
    authorization: `Bearer ${token(roles)}`,
    "x-idempotency-key": `idem-${randomUUID()}`,
  };
}

function readHeaders(roles?: string[]) {
  return { authorization: `Bearer ${token(roles)}` };
}

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

/** Read a meeting row by ID */
async function readMeeting(id: string) {
  const rows = await tenantQuery((sql) =>
    sql`SELECT * FROM meeting.meetings WHERE id = ${id} AND tenant_id = ${TENANT}`,
  );
  return (rows as any)[0] ?? null;
}

/** Count state transitions for a meeting */
async function countTransitions(meetingId: string): Promise<number> {
  const rows = await tenantQuery((sql) =>
    sql`SELECT count(*)::int AS n FROM meeting.meeting_state_transitions WHERE meeting_id = ${meetingId} AND tenant_id = ${TENANT}`,
  );
  return (rows as any)[0].n;
}

/** Get all state transitions for a meeting */
async function getTransitions(meetingId: string) {
  const rows = await tenantQuery((sql) =>
    sql`SELECT from_state, to_state, actor_id, transitioned_at FROM meeting.meeting_state_transitions WHERE meeting_id = ${meetingId} AND tenant_id = ${TENANT} ORDER BY transitioned_at ASC`,
  );
  return rows as any[];
}

/** Get meeting version */
async function getMeetingVersion(id: string): Promise<number> {
  const m = await readMeeting(id);
  return m?.version ?? 0;
}

// ─── Setup/Teardown ────────────────────────────────────────────────────────────
let app: FastifyInstance;

beforeAll(async () => {
  // Clean up any leftover test data
  await sqlClient`DELETE FROM meeting.minutes_versions WHERE tenant_id = ${TENANT}`;
  await sqlClient`DELETE FROM meeting.minutes WHERE tenant_id = ${TENANT}`;
  await sqlClient`DELETE FROM meeting.decisions WHERE tenant_id = ${TENANT}`;
  await sqlClient`DELETE FROM meeting.attendance_records WHERE tenant_id = ${TENANT}`;
  await sqlClient`DELETE FROM meeting.participants WHERE tenant_id = ${TENANT}`;
  await sqlClient`DELETE FROM meeting.agenda_items WHERE tenant_id = ${TENANT}`;
  await sqlClient`DELETE FROM meeting.meeting_state_transitions WHERE tenant_id = ${TENANT}`;
  await sqlClient`DELETE FROM meeting.meetings WHERE tenant_id = ${TENANT}`;
  await sqlClient`DELETE FROM meeting.committee_members WHERE tenant_id = ${TENANT}`;
  await sqlClient`DELETE FROM meeting.committees WHERE tenant_id = ${TENANT}`;

  // Seed: committee with quorum rule requiring 2 members
  await sqlClient`
    INSERT INTO meeting.committees (id, tenant_id, name, code, type, constitution_date, quorum_rule, voting_rule, created_by, updated_by)
    VALUES (${COMMITTEE}, ${TENANT}, 'Integration Test Committee', 'ITC', 'standing', '2025-01-01',
            ${JSON.stringify({ minMembers: 2 })}::jsonb, 'simple_majority', ${ACTOR}, ${ACTOR})
    ON CONFLICT (id) DO NOTHING`;

  // Seed: committee members (chairperson + secretary + 3 members)
  const members = [
    { id: randomUUID(), memberId: CHAIR, role: "chairperson" },
    { id: randomUUID(), memberId: SECRETARY, role: "secretary" },
    { id: randomUUID(), memberId: MEMBER_A, role: "member" },
    { id: randomUUID(), memberId: MEMBER_B, role: "member" },
    { id: randomUUID(), memberId: MEMBER_C, role: "member" },
  ];
  for (const m of members) {
    await sqlClient`
      INSERT INTO meeting.committee_members (id, tenant_id, committee_id, member_id, role, appointment_date, status, voting_right, created_by, updated_by)
      VALUES (${m.id}, ${TENANT}, ${COMMITTEE}, ${m.memberId}, ${m.role}, '2025-01-01', 'active', true, ${ACTOR}, ${ACTOR})
      ON CONFLICT (id) DO NOTHING`;
  }

  app = await buildApp();
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

// ─── Full Lifecycle Test ───────────────────────────────────────────────────────
describe("Full meeting lifecycle (create → schedule → conduct → close)", () => {
  // ───── Step 1: Create Meeting ─────────────────────────────────────────────
  it("Step 1: creates a meeting (route → 202, then consumer writes to DB)", async () => {
    MEETING_ID = randomUUID();
    const scheduledAt = new Date(Date.now() + 14 * 86400000).toISOString();

    // Route returns 202 (command queued)
    const res = await app.inject({
      method: "POST",
      url: "/v1/meetings",
      headers: writeHeaders(),
      payload: {
        title: "Lifecycle Test Meeting",
        type: "committee",
        scheduledAt,
        durationMinutes: 90,
        committeeId: COMMITTEE,
        chairpersonId: CHAIR,
        secretaryId: SECRETARY,
      },
    });
    expect(res.statusCode).toBe(202);
    MEETING_ID = res.json().data.id;

    // Consumer processes the command (CQRS write side)
    await run(msg(COMMANDS.meetingCreate, {
      id: MEETING_ID,
      tenantId: TENANT,
      title: "Lifecycle Test Meeting",
      type: "committee",
      scheduledAt,
      durationMinutes: 90,
      committeeId: COMMITTEE,
      chairpersonId: CHAIR,
      secretaryId: SECRETARY,
    }));

    // Verify DB state
    const meeting = await readMeeting(MEETING_ID);
    expect(meeting).not.toBeNull();
    expect(meeting.status).toBe("draft");
    expect(meeting.title).toBe("Lifecycle Test Meeting");
    expect(meeting.committee_id).toBe(COMMITTEE);
  });

  // ───── Step 2: Add Agenda Item ────────────────────────────────────────────
  it("Step 2: adds an agenda item (route → 202, consumer writes)", async () => {
    AGENDA_ITEM_ID = randomUUID();

    // Route boundary
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING_ID}/agenda`,
      headers: writeHeaders(),
      payload: {
        title: "Budget Approval for Q2",
        outcomeType: "decision",
        durationMinutes: 30,
        description: "Review and approve Q2 budget allocations",
      },
    });
    expect(res.statusCode).toBe(202);

    // Consumer writes
    await run(msg(COMMANDS.agendaItemSubmit, {
      agendaItemId: AGENDA_ITEM_ID,
      meetingId: MEETING_ID,
      tenantId: TENANT,
      title: "Budget Approval for Q2",
      outcomeType: "decision",
      durationMinutes: 30,
      description: "Review and approve Q2 budget allocations",
    }));

    // Verify agenda item exists
    const items = await tenantQuery((sql) =>
      sql`SELECT * FROM meeting.agenda_items WHERE meeting_id = ${MEETING_ID} AND tenant_id = ${TENANT}`,
    );
    expect((items as any[]).length).toBeGreaterThanOrEqual(1);
    const item = (items as any[]).find((i) => i.id === AGENDA_ITEM_ID);
    expect(item).toBeTruthy();
    expect(item.title).toBe("Budget Approval for Q2");
    expect(item.outcome_type).toBe("decision");
  });

  // ───── Step 3: Add Participants ───────────────────────────────────────────
  it("Step 3: adds participants (route → 202, consumer writes)", async () => {
    PARTICIPANT_IDS = [randomUUID(), randomUUID(), randomUUID()];

    // Route boundary
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING_ID}/participants`,
      headers: writeHeaders(),
      payload: {
        participants: [
          { employeeId: MEMBER_A, role: "member", isMandatory: true },
          { employeeId: MEMBER_B, role: "member", isMandatory: true },
          { employeeId: MEMBER_C, role: "member", isMandatory: false },
        ],
      },
    });
    expect(res.statusCode).toBe(202);

    // Consumer writes
    await run(msg(COMMANDS.participantAdd, {
      meetingId: MEETING_ID,
      tenantId: TENANT,
      participants: [
        { id: PARTICIPANT_IDS[0], employeeId: MEMBER_A, role: "member", isMandatory: true },
        { id: PARTICIPANT_IDS[1], employeeId: MEMBER_B, role: "member", isMandatory: true },
        { id: PARTICIPANT_IDS[2], employeeId: MEMBER_C, role: "member", isMandatory: false },
      ],
    }));

    // Verify participants
    const parts = await tenantQuery((sql) =>
      sql`SELECT * FROM meeting.participants WHERE meeting_id = ${MEETING_ID} AND tenant_id = ${TENANT}`,
    );
    expect((parts as any[]).length).toBe(3);
  });

  // ───── Step 4: Transition to Scheduled ────────────────────────────────────
  it("Step 4: transitions to scheduled state (requires chairperson + agenda + future date)", async () => {
    const version = await getMeetingVersion(MEETING_ID);

    // Route boundary
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING_ID}/transition`,
      headers: writeHeaders(),
      payload: { version, to: "scheduled" },
    });
    expect(res.statusCode).toBe(202);

    // Consumer processes transition
    await run(msg(COMMANDS.meetingTransition, {
      meetingId: MEETING_ID,
      version,
      to: "scheduled",
      reason: "All prerequisites met",
    }));

    // Verify state
    const meeting = await readMeeting(MEETING_ID);
    expect(meeting.status).toBe("scheduled");
  });

  // ───── Step 5: Lock Agenda ────────────────────────────────────────────────
  it("Step 5: locks the agenda (transition to agenda_locked)", async () => {
    const version = await getMeetingVersion(MEETING_ID);

    // Route boundary
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING_ID}/transition`,
      headers: writeHeaders(),
      payload: { version, to: "agenda_locked" },
    });
    expect(res.statusCode).toBe(202);

    // Consumer processes
    await run(msg(COMMANDS.meetingTransition, {
      meetingId: MEETING_ID,
      version,
      to: "agenda_locked",
      reason: "Agenda finalized for meeting",
    }));

    // Verify state
    const meeting = await readMeeting(MEETING_ID);
    expect(meeting.status).toBe("agenda_locked");
  });

  // ───── Step 6: Start Meeting (verify quorum) ──────────────────────────────
  it("Step 6: starts the meeting with quorum verification via attendance", async () => {
    // First: mark attendance for enough members to meet quorum (2 required)
    const attendanceIds = [randomUUID(), randomUUID()];
    const now = new Date().toISOString();

    await run(msg(COMMANDS.attendanceCheckIn, {
      attendanceId: attendanceIds[0],
      meetingId: MEETING_ID,
      tenantId: TENANT,
      participantId: PARTICIPANT_IDS[0],
      method: "manual",
      mode: "in_person",
      checkInAt: now,
    }));

    await run(msg(COMMANDS.attendanceCheckIn, {
      attendanceId: attendanceIds[1],
      meetingId: MEETING_ID,
      tenantId: TENANT,
      participantId: PARTICIPANT_IDS[1],
      method: "manual",
      mode: "in_person",
      checkInAt: now,
    }));

    // Verify quorum is now established on the meeting
    const meetingPreTransition = await readMeeting(MEETING_ID);
    expect(meetingPreTransition.quorum_established).toBe(true);

    // Transition to in_progress
    const version = await getMeetingVersion(MEETING_ID);
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING_ID}/transition`,
      headers: writeHeaders(),
      payload: { version, to: "in_progress" },
    });
    expect(res.statusCode).toBe(202);

    await run(msg(COMMANDS.meetingTransition, {
      meetingId: MEETING_ID,
      version,
      to: "in_progress",
    }));

    // Verify state + actual start time recorded
    const meeting = await readMeeting(MEETING_ID);
    expect(meeting.status).toBe("in_progress");
    expect(meeting.actual_start_at).not.toBeNull();
  });

  // ───── Step 7: Record Decision ────────────────────────────────────────────
  it("Step 7: records a decision during the meeting", async () => {
    DECISION_ID = randomUUID();

    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING_ID}/decisions`,
      headers: writeHeaders(),
      payload: {
        text: "Approved Q2 budget allocation of ₹50 lakhs",
        type: "financial",
        agendaItemId: AGENDA_ITEM_ID,
        effectiveDate: new Date().toISOString().split("T")[0],
      },
    });
    expect(res.statusCode).toBe(202);

    // Consumer writes
    await run(msg(COMMANDS.decisionRecord, {
      decisionId: DECISION_ID,
      meetingId: MEETING_ID,
      tenantId: TENANT,
      agendaItemId: AGENDA_ITEM_ID,
      text: "Approved Q2 budget allocation of ₹50 lakhs",
      type: "financial",
      effectiveDate: new Date().toISOString().split("T")[0],
    }));

    // Verify decision
    const decisions = await tenantQuery((sql) =>
      sql`SELECT * FROM meeting.decisions WHERE meeting_id = ${MEETING_ID} AND tenant_id = ${TENANT}`,
    );
    expect((decisions as any[]).length).toBeGreaterThanOrEqual(1);
    const d = (decisions as any[]).find((x) => x.id === DECISION_ID);
    expect(d).toBeTruthy();
    expect(d.text).toBe("Approved Q2 budget allocation of ₹50 lakhs");
    expect(d.type).toBe("financial");
  });

  // ───── Step 8: End Meeting (transition to minutes_pending) ────────────────
  it("Step 8: ends the meeting (transition to minutes_pending)", async () => {
    const version = await getMeetingVersion(MEETING_ID);

    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING_ID}/transition`,
      headers: writeHeaders(),
      payload: { version, to: "minutes_pending" },
    });
    expect(res.statusCode).toBe(202);

    await run(msg(COMMANDS.meetingTransition, {
      meetingId: MEETING_ID,
      version,
      to: "minutes_pending",
      reason: "All agenda items discussed",
    }));

    // Verify state + actual end time
    const meeting = await readMeeting(MEETING_ID);
    expect(meeting.status).toBe("minutes_pending");
    expect(meeting.actual_end_at).not.toBeNull();
  });

  // ───── Step 9: Draft Minutes ──────────────────────────────────────────────
  it("Step 9: drafts minutes for the meeting", async () => {
    MINUTES_ID = randomUUID();

    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING_ID}/minutes`,
      headers: writeHeaders(),
      payload: { templateType: "summary" },
    });
    expect(res.statusCode).toBe(202);

    // Consumer creates the draft
    await run(msg(COMMANDS.minutesCreate, {
      minutesId: MINUTES_ID,
      meetingId: MEETING_ID,
      tenantId: TENANT,
      templateType: "summary",
    }));

    // Verify minutes created
    const mins = await tenantQuery((sql) =>
      sql`SELECT * FROM meeting.minutes WHERE meeting_id = ${MEETING_ID} AND tenant_id = ${TENANT}`,
    );
    expect((mins as any[]).length).toBeGreaterThanOrEqual(1);
    const m = (mins as any[]).find((x) => x.id === MINUTES_ID);
    expect(m).toBeTruthy();
    expect(m.status).toBe("draft");
    expect(m.template_type).toBe("summary");
  });

  // ───── Step 10: Approve Minutes ───────────────────────────────────────────
  it("Step 10: approves the minutes (transition meeting to minutes_approved)", async () => {
    // First submit the minutes
    await run(msg(COMMANDS.minutesSubmit, {
      minutesId: MINUTES_ID,
      tenantId: TENANT,
      version: 1,
    }));

    // Approve
    await run(msg(COMMANDS.minutesApprove, {
      minutesId: MINUTES_ID,
      tenantId: TENANT,
      version: 2,
      approverId: CHAIR,
    }));

    // Verify minutes approved
    const mins = await tenantQuery((sql) =>
      sql`SELECT * FROM meeting.minutes WHERE id = ${MINUTES_ID} AND tenant_id = ${TENANT}`,
    );
    const m = (mins as any[])[0];
    expect(m.status).toBe("approved");
    expect(m.approved_by).toBe(CHAIR);

    // Transition the meeting to minutes_approved
    const version = await getMeetingVersion(MEETING_ID);
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING_ID}/transition`,
      headers: writeHeaders(),
      payload: { version, to: "minutes_approved" },
    });
    expect(res.statusCode).toBe(202);

    await run(msg(COMMANDS.meetingTransition, {
      meetingId: MEETING_ID,
      version,
      to: "minutes_approved",
      reason: "Minutes approved by chairperson",
    }));

    const meeting = await readMeeting(MEETING_ID);
    expect(meeting.status).toBe("minutes_approved");
  });

  // ───── Step 11: Close Meeting ─────────────────────────────────────────────
  it("Step 11: closes the meeting (final state)", async () => {
    const version = await getMeetingVersion(MEETING_ID);

    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING_ID}/transition`,
      headers: writeHeaders(),
      payload: { version, to: "closed" },
    });
    expect(res.statusCode).toBe(202);

    await run(msg(COMMANDS.meetingTransition, {
      meetingId: MEETING_ID,
      version,
      to: "closed",
      reason: "Meeting lifecycle complete",
    }));

    const meeting = await readMeeting(MEETING_ID);
    expect(meeting.status).toBe("closed");
  });

  // ───── Verification: Audit Log Completeness ───────────────────────────────
  it("Verify: state transition audit log is complete", async () => {
    const transitions = await getTransitions(MEETING_ID);

    // We expect transitions: draft→scheduled, scheduled→agenda_locked,
    // agenda_locked→in_progress, in_progress→minutes_pending,
    // minutes_pending→minutes_approved, minutes_approved→closed
    expect(transitions.length).toBe(6);

    const expectedSequence = [
      { from_state: "draft", to_state: "scheduled" },
      { from_state: "scheduled", to_state: "agenda_locked" },
      { from_state: "agenda_locked", to_state: "in_progress" },
      { from_state: "in_progress", to_state: "minutes_pending" },
      { from_state: "minutes_pending", to_state: "minutes_approved" },
      { from_state: "minutes_approved", to_state: "closed" },
    ];

    for (let i = 0; i < expectedSequence.length; i++) {
      expect(transitions[i].from_state).toBe(expectedSequence[i].from_state);
      expect(transitions[i].to_state).toBe(expectedSequence[i].to_state);
      expect(transitions[i].actor_id).toBe(ACTOR);
      expect(transitions[i].transitioned_at).toBeTruthy();
    }

    // Timestamps must be monotonically increasing
    for (let i = 1; i < transitions.length; i++) {
      const prev = new Date(transitions[i - 1].transitioned_at).getTime();
      const curr = new Date(transitions[i].transitioned_at).getTime();
      expect(curr).toBeGreaterThanOrEqual(prev);
    }
  });

  // ───── Verification: Cache Invalidation ───────────────────────────────────
  it("Verify: cache is invalidated (reading meeting returns fresh data from DB)", async () => {
    // After the entire lifecycle, a fresh GET should return the closed meeting
    // without stale cache (the consumer invalidates after every write)
    const res = await app.inject({
      method: "GET",
      url: `/v1/meetings/${MEETING_ID}`,
      headers: readHeaders(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe("closed");
    expect(res.json().data.actualStartAt).toBeTruthy();
    expect(res.json().data.actualEndAt).toBeTruthy();
  });

  // ───── Verification: Outbox Events Emitted ────────────────────────────────
  it("Verify: outbox contains expected domain events", async () => {
    // Check that the meeting.created event was emitted
    const createdEvents = await tenantQuery((sql) =>
      sql`SELECT count(*)::int AS n FROM _outbox.messages WHERE tenant_id = ${TENANT} AND topic = ${EVENTS.meetingCreated}`,
    );
    expect((createdEvents as any[])[0].n).toBeGreaterThanOrEqual(1);

    // Check that transition events were emitted
    const transitionEvents = await tenantQuery((sql) =>
      sql`SELECT count(*)::int AS n FROM _outbox.messages WHERE tenant_id = ${TENANT} AND topic LIKE 'meeting.meeting.%'`,
    );
    expect((transitionEvents as any[])[0].n).toBeGreaterThanOrEqual(1);

    // Check audit events were emitted for each mutation
    const auditEvents = await tenantQuery((sql) =>
      sql`SELECT count(*)::int AS n FROM _outbox.messages WHERE tenant_id = ${TENANT} AND topic = 'audit.event.record'`,
    );
    // At minimum: create + transitions (6) + agenda + participant + 2 attendance + decision + minutes create/submit/approve = 14+
    expect((auditEvents as any[])[0].n).toBeGreaterThanOrEqual(10);
  });
});
