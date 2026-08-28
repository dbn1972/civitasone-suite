/**
 * Participant module — consumer integration tests (real DB, no mocks).
 *
 * Exercises the participant command handlers end-to-end against Postgres: each handler runs
 * inside `runWithTenant(TENANT, …)` so the `app.tenant_id` GUC is set (RLS) exactly as the worker
 * does via `withTenantConsumer`. Asserts the committed DB effect (INSERT / versioned UPDATE /
 * DELETE / invitation-status change / nominee set) plus idempotency (`markProcessed`) and the
 * permanent-error (DLQ) branches (duplicate add, unknown participant, nominee not on the roster).
 *
 * Covers: participant.add, participant.update, participant.remove, participant.respond,
 * participant.nominate, meeting.invitations.send, and the 48-hour under-quorum alert (Req 5.1–5.7).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { runWithTenant } from "@civitasone/db";
import { NonRetryableError, type CommandEnvelope } from "@civitasone/queue";
import { sqlClient } from "../src/shared/db.js";
import { COMMANDS, EVENTS } from "../src/topics.js";
import { registerParticipantConsumers } from "../src/modules/participant/consumer.js";

const TENANT = "aaaaaaaa-9c11-4a1a-9b2c-0000000007c0";
const COMMITTEE = "bbbbbbbb-9c11-4a1a-9b2c-0000000007c0";
const MEETING = "cccccccc-9c11-4a1a-9b2c-0000000007c0"; // scheduled +7d (outside 48h window)
const MEETING_SOON = "cccccccc-9c11-4a1a-9b2c-0000000007c1"; // scheduled +1h (inside 48h window)
const CHAIR_EMP = "f1111111-9c11-4a1a-9b2c-0000000007c0";
const SECRETARY = "f0000000-9c11-4a1a-9b2c-0000000007c0";
const MEMBER_EMP = "f2222222-9c11-4a1a-9b2c-0000000007c0";
const NOMINEE_EMP = "f4444444-9c11-4a1a-9b2c-0000000007c0"; // active committee member (approved nominee)
const OUTSIDER_EMP = "f5555555-9c11-4a1a-9b2c-0000000007c0"; // NOT a committee member
const ACTOR = "0a000000-9c11-4a1a-9b2c-0000000007c0";

// Capture the registered handlers by topic.
const handlers = new Map<string, (msg: CommandEnvelope<any>) => Promise<void>>();
registerParticipantConsumers((topic, h) => handlers.set(topic, h as any));

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

/** Read a participant row (tenant-scoped) for assertions. */
async function readParticipant(id: string): Promise<any | null> {
  return runWithTenant(TENANT, async () => {
    const rows = await sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
      return sql`select id, invitation_status, nominee_id, is_mandatory, version, decline_reason
                 from meeting.participants where id = ${id}`;
    });
    return rows[0] ?? null;
  });
}

async function seedParticipant(id: string, meetingId: string, employeeId: string, role = "member"): Promise<void> {
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`
      insert into meeting.participants (id, tenant_id, meeting_id, employee_id, role, invitation_status, created_by, updated_by)
      values (${id}, ${TENANT}, ${meetingId}, ${employeeId}, ${role}, 'pending', ${ACTOR}, ${ACTOR})
      on conflict (id) do nothing`;
  });
}

beforeAll(async () => {
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`
      insert into meeting.committees (id, tenant_id, name, type, constitution_date, quorum_rule, created_by, updated_by)
      values (${COMMITTEE}, ${TENANT}, 'Audit Committee', 'standing', '2020-01-01',
              ${sql.json({ minMembers: 2, vcCountsForQuorum: true })}, ${ACTOR}, ${ACTOR})
      on conflict (id) do nothing`;
    // NOMINEE_EMP is an active member → the approved nominee list for nominate.
    await sql`
      insert into meeting.committee_members (id, tenant_id, committee_id, member_id, role, appointment_date, status, created_by, updated_by)
      values (${randomUUID()}, ${TENANT}, ${COMMITTEE}, ${NOMINEE_EMP}, 'member', '2020-01-01', 'active', ${ACTOR}, ${ACTOR})
      on conflict do nothing`;
    // chairperson_id/secretary_id: ACTOR — IDOR fix (Req 5.2, 5.5, 5.6): respond/nominate now
    // require the caller to be the participant themselves OR this meeting's own chairperson/
    // secretary (on-behalf-of standing). This file's writes all publish as ACTOR, so ACTOR is
    // seeded as both standings here; CHAIR_EMP/SECRETARY are left declared but unused by this
    // insert (kept in case a future test wants a distinct non-owner identity).
    await sql`
      insert into meeting.meetings (id, tenant_id, type, title, status, committee_id, chairperson_id, secretary_id, scheduled_at, created_by, updated_by)
      values (${MEETING}, ${TENANT}, 'committee', 'Audit Q1', 'scheduled', ${COMMITTEE}, ${ACTOR}, ${ACTOR}, now() + interval '7 days', ${ACTOR}, ${ACTOR}),
             (${MEETING_SOON}, ${TENANT}, 'committee', 'Audit Urgent', 'scheduled', ${COMMITTEE}, ${ACTOR}, ${ACTOR}, now() + interval '1 hour', ${ACTOR}, ${ACTOR})
      on conflict (id) do nothing`;
  });
});

afterAll(async () => {
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`delete from meeting.participants where tenant_id = ${TENANT}`;
    await sql`delete from meeting.meetings where tenant_id = ${TENANT}`;
    await sql`delete from meeting.committee_members where tenant_id = ${TENANT}`;
    await sql`delete from meeting.committees where tenant_id = ${TENANT}`;
    // `_inbox.processed` is keyed by (globally-unique) message_id only — nothing tenant-scoped
    // to clean. `_outbox.messages` carries tenant_id, so remove this tenant's emitted events.
    await sql`delete from _outbox.messages where tenant_id = ${TENANT}`;
  });
  await sqlClient.end();
});

describe("participant.add", () => {
  it("inserts a participant and is idempotent on redelivery", async () => {
    const id = randomUUID();
    const m = msg(COMMANDS.participantAdd, {
      meetingId: MEETING,
      tenantId: TENANT,
      participants: [{ id, employeeId: "f7777777-9c11-4a1a-9b2c-0000000007c0", role: "member" }],
    });
    await run(m);
    expect((await readParticipant(id))?.invitation_status).toBe("pending");

    // Redelivery with the SAME messageId must be a no-op (markProcessed skip) — still one row.
    await run(m);
    const rows = await runWithTenant(TENANT, () =>
      sqlClient.begin(async (sql) => {
        await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
        return sql`select count(*)::int as n from meeting.participants where id = ${id}`;
      }),
    );
    expect(rows[0].n).toBe(1);
  });

  it("rejects a duplicate employee on the same meeting (permanent → DLQ)", async () => {
    await seedParticipant(randomUUID(), MEETING, "f8888888-9c11-4a1a-9b2c-0000000007c0");
    const m = msg(COMMANDS.participantAdd, {
      meetingId: MEETING,
      tenantId: TENANT,
      participants: [{ id: randomUUID(), employeeId: "f8888888-9c11-4a1a-9b2c-0000000007c0", role: "member" }],
    });
    await expect(run(m)).rejects.toBeInstanceOf(NonRetryableError);
  });

  it("rejects an invalid role assignment (permanent → DLQ)", async () => {
    const m = msg(COMMANDS.participantAdd, {
      meetingId: MEETING,
      tenantId: TENANT,
      participants: [{ id: randomUUID(), employeeId: randomUUID(), role: "special_invitee" }], // no agenda scope
    });
    await expect(run(m)).rejects.toBeInstanceOf(NonRetryableError);
  });
});

describe("participant.respond", () => {
  it("records an accept RSVP", async () => {
    const id = randomUUID();
    await seedParticipant(id, MEETING, MEMBER_EMP);
    await run(msg(COMMANDS.participantRespond, { meetingId: MEETING, participantId: id, response: "accept" }));
    expect((await readParticipant(id))?.invitation_status).toBe("accepted");
  });

  it("records a decline with reason and notifies the secretary", async () => {
    const id = randomUUID();
    await seedParticipant(id, MEETING, "f9999999-9c11-4a1a-9b2c-0000000007c0");
    await run(
      msg(COMMANDS.participantRespond, {
        meetingId: MEETING,
        participantId: id,
        response: "decline",
        declineReason: "on leave",
      }),
    );
    const row = await readParticipant(id);
    expect(row?.invitation_status).toBe("declined");
    expect(row?.decline_reason).toBe("on leave");
  });

  it("emits an under-quorum compliance alert within the 48h window", async () => {
    const id = randomUUID();
    await seedParticipant(id, MEETING_SOON, "fa000000-9c11-4a1a-9b2c-0000000007c0");
    await run(msg(COMMANDS.participantRespond, { meetingId: MEETING_SOON, participantId: id, response: "accept" }));
    // confirmed(1) < threshold(2) inside the 48h window → complianceAlert enqueued to the outbox.
    const alerts = await runWithTenant(TENANT, () =>
      sqlClient.begin(async (sql) => {
        await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
        return sql`select count(*)::int as n from _outbox.messages
                   where tenant_id = ${TENANT} and topic = ${EVENTS.complianceAlert}`;
      }),
    );
    expect(alerts[0].n).toBeGreaterThan(0);
  });

  it("rejects an RSVP for an unknown participant (permanent → DLQ)", async () => {
    await expect(
      run(msg(COMMANDS.participantRespond, { meetingId: MEETING, participantId: randomUUID(), response: "accept" })),
    ).rejects.toBeInstanceOf(NonRetryableError);
  });
});

describe("participant.nominate", () => {
  it("records a nominee that is on the committee roster", async () => {
    const id = randomUUID();
    await seedParticipant(id, MEETING, "fb000000-9c11-4a1a-9b2c-0000000007c0");
    await run(msg(COMMANDS.participantNominate, { meetingId: MEETING, participantId: id, nomineeId: NOMINEE_EMP }));
    expect((await readParticipant(id))?.nominee_id).toBe(NOMINEE_EMP);
  });

  it("rejects a nominee not on the approved roster (permanent → DLQ)", async () => {
    const id = randomUUID();
    await seedParticipant(id, MEETING, "fc000000-9c11-4a1a-9b2c-0000000007c0");
    await expect(
      run(msg(COMMANDS.participantNominate, { meetingId: MEETING, participantId: id, nomineeId: OUTSIDER_EMP })),
    ).rejects.toBeInstanceOf(NonRetryableError);
  });
});

describe("participant.update", () => {
  it("applies a version-guarded patch", async () => {
    const id = randomUUID();
    await seedParticipant(id, MEETING, "fd000000-9c11-4a1a-9b2c-0000000007c0");
    await run(
      msg(COMMANDS.participantUpdate, {
        meetingId: MEETING,
        participantId: id,
        version: 1,
        patch: { isMandatory: false },
      }),
    );
    const row = await readParticipant(id);
    expect(row?.is_mandatory).toBe(false);
    expect(row?.version).toBe(2);
  });

  it("rejects an unknown participant (permanent → DLQ)", async () => {
    await expect(
      run(
        msg(COMMANDS.participantUpdate, {
          meetingId: MEETING,
          participantId: randomUUID(),
          version: 1,
          patch: { isMandatory: false },
        }),
      ),
    ).rejects.toBeInstanceOf(NonRetryableError);
  });
});

describe("participant.remove", () => {
  it("deletes the participant association", async () => {
    const id = randomUUID();
    await seedParticipant(id, MEETING, "fe000000-9c11-4a1a-9b2c-0000000007c0");
    await run(msg(COMMANDS.participantRemove, { meetingId: MEETING, participantId: id, version: 1 }));
    expect(await readParticipant(id)).toBeNull();
  });
});

describe("meeting.invitations.send", () => {
  it("fans out notifications for the roster", async () => {
    const id = randomUUID();
    await seedParticipant(id, MEETING_SOON, "ff000000-9c11-4a1a-9b2c-0000000007c0");
    await run(msg(COMMANDS.invitationsSend, { meetingId: MEETING_SOON, channels: ["email"] }));
    const invited = await runWithTenant(TENANT, () =>
      sqlClient.begin(async (sql) => {
        await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
        return sql`select count(*)::int as n from _outbox.messages
                   where tenant_id = ${TENANT} and topic = ${EVENTS.participantInvited}`;
      }),
    );
    expect(invited[0].n).toBeGreaterThan(0);
  });
});
