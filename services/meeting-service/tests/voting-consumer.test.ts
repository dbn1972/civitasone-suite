/**
 * Voting module — consumer integration tests (real DB, no mocks).
 *
 * Exercises the voting command handlers end-to-end against Postgres. Each handler runs inside
 * `runWithTenant(TENANT, …)` so the `app.tenant_id` GUC is set (RLS) exactly as the worker does
 * via `withTenantConsumer`. Asserts the committed DB effect plus the transactional-outbox events,
 * and covers:
 *
 *   - vote.initiate → re-verify quorum at vote time (Req 11.2) then open a resolution
 *     (`voting_open`); a lost quorum is a permanent rejection (→ DLQ).
 *   - vote.cast → record a ballot, increment the running tally; a duplicate ballot (P17) and a
 *     cast on a closed resolution are permanent rejections (→ DLQ).
 *   - vote.conclude → tally + compute result per the majority rule (Req 11.4, P16), assign the
 *     sequential resolution number (P25), emit vote.concluded + resolution.passed/rejected.
 *   - vote.circulation_respond → record an async response and, on deadline/all-responded, compute
 *     the outcome — `invalid` below the response threshold (P18), else the majority outcome.
 *   - P30 idempotency: re-delivering the same messageId is a no-op (markProcessed skip).
 *   - circulationReminderTimes: 50%/80%-of-window reminder instants (Req 12.6).
 *
 * _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 12.3, 12.6_
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { runWithTenant } from "@civitasone/db";
import { NonRetryableError, type CommandEnvelope } from "@civitasone/queue";
import { sqlClient } from "../src/shared/db.js";
import { COMMANDS, EVENTS } from "../src/topics.js";
import { registerVotingConsumers, circulationReminderTimes } from "../src/modules/voting/consumer.js";

const TENANT = "a0b8b3e6-701e-4000-8000-0000000000f0";
const COMMITTEE = "b0b8b3e6-701e-4000-8000-0000000000f0";
const MEETING_OK = "c0b8b3e6-701e-4000-8000-0000000000f0"; // quorum met (3 present)
const MEETING_NOQUORUM = "c0b8b3e6-701e-4000-8000-0000000000f1"; // no attendance → quorum lost
const MEMBER_A = "d0b8b3e6-701e-4000-8000-0000000000f1";
const MEMBER_B = "d0b8b3e6-701e-4000-8000-0000000000f2";
const MEMBER_C = "d0b8b3e6-701e-4000-8000-0000000000f3";
const ACTOR = "e0b8b3e6-701e-4000-8000-0000000000f0";

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
async function voteCount(resolutionId: string): Promise<number> {
  const rows = await tenantQuery(
    (sql) => sql`select count(*)::int as n from meeting.votes where resolution_id = ${resolutionId} and tenant_id = ${TENANT}`,
  );
  return rows[0].n as number;
}
async function outboxCount(topic: string): Promise<number> {
  const rows = await tenantQuery(
    (sql) => sql`select count(*)::int as n from _outbox.messages where tenant_id = ${TENANT} and topic = ${topic}`,
  );
  return rows[0].n as number;
}

/** Insert an in-meeting resolution already open for voting. */
async function seedOpenResolution(resolutionId: string, meetingId: string, majorityRule = "simple_majority"): Promise<void> {
  await tenantQuery(
    (sql) => sql`
      insert into meeting.resolutions
        (id, tenant_id, meeting_id, resolution_number, text, vote_type, majority_rule, result, status, is_circulation, created_by, updated_by)
      values (${resolutionId}, ${TENANT}, ${meetingId}, ${"PENDING-" + resolutionId}, 'Open motion', 'roll_call',
              ${majorityRule}, 'pending', 'voting_open', false, ${ACTOR}, ${ACTOR})`,
  );
}

beforeAll(async () => {
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
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
      values (${COMMITTEE}, ${TENANT}, 'Governance Board', 'GB', 'board', '2025-01-01',
              ${sql.json({ minMembers: 2, vcCountsForQuorum: true })}, ${ACTOR}, ${ACTOR})`;
    for (const m of [MEMBER_A, MEMBER_B, MEMBER_C]) {
      await sql`
        insert into meeting.committee_members (id, tenant_id, committee_id, member_id, role, appointment_date, status, created_by, updated_by)
        values (${randomUUID()}, ${TENANT}, ${COMMITTEE}, ${m}, 'member', '2025-01-01', 'active', ${ACTOR}, ${ACTOR})`;
    }
    await sql`
      insert into meeting.meetings (id, tenant_id, type, title, status, committee_id, financial_year, scheduled_at, quorum_established, created_by, updated_by)
      values (${MEETING_OK}, ${TENANT}, 'committee', 'Quorate meeting', 'in_progress', ${COMMITTEE}, '2025-26', '2025-06-01T09:00:00Z', true, ${ACTOR}, ${ACTOR}),
             (${MEETING_NOQUORUM}, ${TENANT}, 'committee', 'Inquorate meeting', 'in_progress', ${COMMITTEE}, '2025-26', '2025-06-01T09:00:00Z', false, ${ACTOR}, ${ACTOR})`;
    // Three present attendees on MEETING_OK → quorum (minMembers 2) satisfied at vote time.
    // attendance_records.participant_id FKs to participants, so seed a participant per member first.
    for (const m of [MEMBER_A, MEMBER_B, MEMBER_C]) {
      const participantId = randomUUID();
      await sql`
        insert into meeting.participants (id, tenant_id, meeting_id, employee_id, role, invitation_status, created_by, updated_by)
        values (${participantId}, ${TENANT}, ${MEETING_OK}, ${m}, 'member', 'accepted', ${ACTOR}, ${ACTOR})`;
      await sql`
        insert into meeting.attendance_records (id, tenant_id, meeting_id, participant_id, method, check_in_at, mode, status, created_by, updated_by)
        values (${randomUUID()}, ${TENANT}, ${MEETING_OK}, ${participantId}, 'manual', now(), 'in_person', 'present', ${ACTOR}, ${ACTOR})`;
    }
  });
});

afterAll(async () => {
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
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

describe("vote.initiate", () => {
  it("opens a resolution for voting when quorum holds and notifies members; idempotent (P30)", async () => {
    const rid = randomUUID();
    const initiatedBefore = await outboxCount(EVENTS.voteInitiated);
    const m = msg(COMMANDS.voteInitiate, {
      resolutionId: rid,
      meetingId: MEETING_OK,
      tenantId: TENANT,
      resolutionText: "Approve the annual report",
      voteType: "roll_call",
      majorityRule: "simple_majority",
    });
    await run(m);

    const row = await readResolution(rid);
    expect(row?.status).toBe("voting_open");
    expect(row?.result).toBe("pending");
    expect(await outboxCount(EVENTS.voteInitiated)).toBe(initiatedBefore + 1);

    // Redelivery with the SAME messageId → no duplicate resolution row.
    await run(m);
    const cnt = await tenantQuery((sql) => sql`select count(*)::int as n from meeting.resolutions where id = ${rid}`);
    expect(cnt[0].n).toBe(1);
  });

  it("rejects vote initiation when quorum is not met at vote time (permanent → DLQ, Req 11.2)", async () => {
    await expect(
      run(
        msg(COMMANDS.voteInitiate, {
          resolutionId: randomUUID(),
          meetingId: MEETING_NOQUORUM,
          tenantId: TENANT,
          resolutionText: "Motion without quorum",
          voteType: "roll_call",
          majorityRule: "simple_majority",
        }),
      ),
    ).rejects.toBeInstanceOf(NonRetryableError);
  });

  it("rejects vote initiation for an unknown meeting (permanent → DLQ)", async () => {
    await expect(
      run(
        msg(COMMANDS.voteInitiate, {
          resolutionId: randomUUID(),
          meetingId: randomUUID(),
          tenantId: TENANT,
          resolutionText: "Ghost meeting",
          voteType: "roll_call",
          majorityRule: "simple_majority",
        }),
      ),
    ).rejects.toBeInstanceOf(NonRetryableError);
  });
});

describe("vote.cast", () => {
  it("records a ballot and increments the running tally", async () => {
    const rid = randomUUID();
    await seedOpenResolution(rid, MEETING_OK);
    await run(msg(COMMANDS.voteCast, { meetingId: MEETING_OK, resolutionId: rid, memberId: MEMBER_A, position: "for", tenantId: TENANT }));
    const row = await readResolution(rid);
    expect(row?.votes_for).toBe(1);
    expect(await voteCount(rid)).toBe(1);
  });

  it("rejects a duplicate ballot from the same member (P17, permanent → DLQ)", async () => {
    const rid = randomUUID();
    await seedOpenResolution(rid, MEETING_OK);
    await run(msg(COMMANDS.voteCast, { meetingId: MEETING_OK, resolutionId: rid, memberId: MEMBER_B, position: "for", tenantId: TENANT }));
    await expect(
      run(msg(COMMANDS.voteCast, { meetingId: MEETING_OK, resolutionId: rid, memberId: MEMBER_B, position: "against", tenantId: TENANT })),
    ).rejects.toBeInstanceOf(NonRetryableError);
    expect(await voteCount(rid)).toBe(1);
  });

  it("rejects a ballot on a resolution that is not open for voting (permanent → DLQ)", async () => {
    const rid = randomUUID();
    await tenantQuery(
      (sql) => sql`
        insert into meeting.resolutions
          (id, tenant_id, meeting_id, resolution_number, text, vote_type, majority_rule, result, status, is_circulation, created_by, updated_by)
        values (${rid}, ${TENANT}, ${MEETING_OK}, ${"GB/RES/2025-26/900"}, 'Closed', 'roll_call', 'simple_majority', 'passed', 'effective', false, ${ACTOR}, ${ACTOR})`,
    );
    await expect(
      run(msg(COMMANDS.voteCast, { meetingId: MEETING_OK, resolutionId: rid, memberId: MEMBER_A, position: "for", tenantId: TENANT })),
    ).rejects.toBeInstanceOf(NonRetryableError);
  });

  it("rejects a ballot on an unknown resolution (permanent → DLQ)", async () => {
    await expect(
      run(msg(COMMANDS.voteCast, { meetingId: MEETING_OK, resolutionId: randomUUID(), memberId: MEMBER_A, position: "for", tenantId: TENANT })),
    ).rejects.toBeInstanceOf(NonRetryableError);
  });
});

describe("vote.conclude", () => {
  it("tallies ballots, computes the result, assigns the sequential number, and emits events (Req 11.4, P25)", async () => {
    const rid = randomUUID();
    await seedOpenResolution(rid, MEETING_OK);
    await run(msg(COMMANDS.voteCast, { meetingId: MEETING_OK, resolutionId: rid, memberId: MEMBER_A, position: "for", tenantId: TENANT }));
    await run(msg(COMMANDS.voteCast, { meetingId: MEETING_OK, resolutionId: rid, memberId: MEMBER_B, position: "for", tenantId: TENANT }));
    await run(msg(COMMANDS.voteCast, { meetingId: MEETING_OK, resolutionId: rid, memberId: MEMBER_C, position: "against", tenantId: TENANT }));

    const concludedBefore = await outboxCount(EVENTS.voteConcluded);
    const passedBefore = await outboxCount(EVENTS.resolutionPassed);
    await run(msg(COMMANDS.voteConclude, { meetingId: MEETING_OK, resolutionId: rid, tenantId: TENANT }));

    const row = await readResolution(rid);
    expect(row?.status).toBe("effective");
    expect(row?.result).toBe("passed"); // 2 for / 1 against, simple majority
    expect(row?.votes_for).toBe(2);
    expect(row?.votes_against).toBe(1);
    // Number scoped to committee GB + the conclusion-date financial year (sequential per scope).
    expect(row?.resolution_number).toMatch(/^GB\/RES\/\d{4}-\d{2}\/\d+$/);
    expect(row?.hash_current).toMatch(/^[0-9a-f]{64}$/); // integrity anchor set for a passed resolution
    expect(await outboxCount(EVENTS.voteConcluded)).toBe(concludedBefore + 1);
    expect(await outboxCount(EVENTS.resolutionPassed)).toBe(passedBefore + 1);
  });

  it("concludes a failing vote as rejected", async () => {
    const rid = randomUUID();
    await seedOpenResolution(rid, MEETING_OK);
    await run(msg(COMMANDS.voteCast, { meetingId: MEETING_OK, resolutionId: rid, memberId: MEMBER_A, position: "against", tenantId: TENANT }));
    await run(msg(COMMANDS.voteCast, { meetingId: MEETING_OK, resolutionId: rid, memberId: MEMBER_B, position: "against", tenantId: TENANT }));
    const rejectedBefore = await outboxCount(EVENTS.resolutionRejected);
    await run(msg(COMMANDS.voteConclude, { meetingId: MEETING_OK, resolutionId: rid, tenantId: TENANT }));
    const row = await readResolution(rid);
    expect(row?.status).toBe("rejected");
    expect(row?.result).toBe("rejected");
    expect(row?.hash_current).toBeNull();
    expect(await outboxCount(EVENTS.resolutionRejected)).toBe(rejectedBefore + 1);
  });

  it("concluding an already-concluded resolution is an idempotent no-op", async () => {
    const rid = randomUUID();
    await seedOpenResolution(rid, MEETING_OK);
    await run(msg(COMMANDS.voteCast, { meetingId: MEETING_OK, resolutionId: rid, memberId: MEMBER_A, position: "for", tenantId: TENANT }));
    await run(msg(COMMANDS.voteConclude, { meetingId: MEETING_OK, resolutionId: rid, tenantId: TENANT }));
    const first = await readResolution(rid);
    await run(msg(COMMANDS.voteConclude, { meetingId: MEETING_OK, resolutionId: rid, tenantId: TENANT }));
    const second = await readResolution(rid);
    expect(second?.resolution_number).toBe(first?.resolution_number);
    expect(second?.version).toBe(first?.version);
  });

  it("rejects conclude for an unknown resolution (permanent → DLQ)", async () => {
    await expect(
      run(msg(COMMANDS.voteConclude, { meetingId: MEETING_OK, resolutionId: randomUUID(), tenantId: TENANT })),
    ).rejects.toBeInstanceOf(NonRetryableError);
  });
});

describe("vote.circulation_respond", () => {
  /** Seed a circulation resolution with a chosen deadline. */
  async function seedCirculation(resolutionId: string, deadline: Date): Promise<void> {
    await tenantQuery(
      (sql) => sql`
        insert into meeting.resolutions
          (id, tenant_id, meeting_id, resolution_number, text, vote_type, majority_rule, result, status, is_circulation, circulation_deadline, created_by, updated_by)
        values (${resolutionId}, ${TENANT}, ${MEETING_OK}, ${"GB/RES/2025-26/500-" + resolutionId.slice(0, 4)}, 'Circulation motion',
                'circulation_resolution', 'simple_majority', 'invalid', 'circulating', true, ${deadline.toISOString()}, ${ACTOR}, ${ACTOR})`,
    );
  }

  it("records a response and concludes as passed once all members respond (Req 12.4)", async () => {
    const rid = randomUUID();
    await seedCirculation(rid, new Date(Date.now() + 172800000)); // future deadline
    // Two members already approved.
    for (const m of [MEMBER_A, MEMBER_B]) {
      await tenantQuery(
        (sql) => sql`
          insert into meeting.votes (id, tenant_id, resolution_id, member_id, position, is_circulation)
          values (${randomUUID()}, ${TENANT}, ${rid}, ${m}, 'approve', true)`,
      );
    }
    const completedBefore = await outboxCount(EVENTS.circulationResolutionCompleted);
    // Third (final) member responds → all 3 of 3 responded → conclude.
    await run(msg(COMMANDS.voteCirculationRespond, { resolutionId: rid, memberId: MEMBER_C, position: "approve", tenantId: TENANT }));
    const row = await readResolution(rid);
    expect(row?.result).toBe("passed");
    expect(row?.status).toBe("effective");
    expect(row?.response_rate).toBe(100);
    expect(await outboxCount(EVENTS.circulationResolutionCompleted)).toBe(completedBefore + 1);
  });

  it("concludes as invalid when the response rate is below the minimum (P18, Req 12.5)", async () => {
    const rid = randomUUID();
    await seedCirculation(rid, new Date(Date.now() - 1000)); // deadline already passed → first response concludes
    const alertBefore = await outboxCount(EVENTS.complianceAlert);
    // Only one of three members responds → response rate 33% < required two-thirds → invalid.
    await run(msg(COMMANDS.voteCirculationRespond, { resolutionId: rid, memberId: MEMBER_A, position: "approve", tenantId: TENANT }));
    const row = await readResolution(rid);
    expect(row?.result).toBe("invalid");
    expect(row?.status).toBe("invalid");
    // An invalid circulation alerts the secretary (Req 12.5).
    expect(await outboxCount(EVENTS.complianceAlert)).toBe(alertBefore + 1);
  });

  it("rejects a duplicate circulation response from the same member (P17, permanent → DLQ)", async () => {
    const rid = randomUUID();
    await seedCirculation(rid, new Date(Date.now() + 172800000));
    await run(msg(COMMANDS.voteCirculationRespond, { resolutionId: rid, memberId: MEMBER_A, position: "approve", tenantId: TENANT }));
    await expect(
      run(msg(COMMANDS.voteCirculationRespond, { resolutionId: rid, memberId: MEMBER_A, position: "reject", tenantId: TENANT })),
    ).rejects.toBeInstanceOf(NonRetryableError);
  });

  it("rejects a circulation response against a non-circulation resolution (permanent → DLQ)", async () => {
    const rid = randomUUID();
    await seedOpenResolution(rid, MEETING_OK);
    await expect(
      run(msg(COMMANDS.voteCirculationRespond, { resolutionId: rid, memberId: MEMBER_A, position: "approve", tenantId: TENANT })),
    ).rejects.toBeInstanceOf(NonRetryableError);
  });

  it("rejects a circulation response for an unknown resolution (permanent → DLQ)", async () => {
    await expect(
      run(msg(COMMANDS.voteCirculationRespond, { resolutionId: randomUUID(), memberId: MEMBER_A, position: "approve", tenantId: TENANT })),
    ).rejects.toBeInstanceOf(NonRetryableError);
  });
});

describe("circulationReminderTimes (Req 12.6)", () => {
  it("computes the 50% and 80% instants of the voting window", () => {
    const start = new Date("2025-06-01T00:00:00Z");
    const deadline = new Date("2025-06-11T00:00:00Z"); // 10-day window
    const { at50Pct, at80Pct } = circulationReminderTimes(start, deadline);
    expect(at50Pct.toISOString()).toBe("2025-06-06T00:00:00.000Z"); // +5 days
    expect(at80Pct.toISOString()).toBe("2025-06-09T00:00:00.000Z"); // +8 days
  });

  it("clamps a non-positive window to the start instant", () => {
    const start = new Date("2025-06-01T00:00:00Z");
    const { at50Pct, at80Pct } = circulationReminderTimes(start, new Date("2025-05-01T00:00:00Z"));
    expect(at50Pct.getTime()).toBe(start.getTime());
    expect(at80Pct.getTime()).toBe(start.getTime());
  });
});
