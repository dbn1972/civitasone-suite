/**
 * Minutes module — consumer integration tests (task 9.4 coverage · real DB, no mocks).
 *
 * Exercises the minutes command handlers end-to-end against Postgres, mirroring
 * tests/participant-consumer.test.ts: each handler runs inside `runWithTenant(TENANT, …)` so the
 * `app.tenant_id` GUC is set (RLS) exactly as the worker does via `withTenantConsumer`. Asserts
 * the committed DB effect plus the transactional-outbox events, and the cross-cutting invariants:
 *
 *   • create    → renders the draft from meeting metadata + attendance/agenda/resolutions (Req 7.1, 7.2)
 *   • update    → snapshots the prior content into minutes_versions + bumps current_version (Req 7.8)
 *   • submit    → draft → submitted + minutes.submitted event routed to workflow (Req 7.3)
 *   • approve   → hash-chain append across a committee's approved minutes (P23), DSC seal (Req 8.5)
 *   • reject    → submitted → draft + version increment + minutes.rejected event (Req 7.6)
 *   • sign      → PKCS#7 signature; SHA256(content) == hash_current for the sealed doc (P24, Req 8.1)
 *   • circulate → notification fan-out + minutes.circulated event (Req 8.3)
 *   • MINUTES_LOCKED guard — editing approved minutes is a permanent (DLQ) error (Req 7.5)
 *   • workflow-pending guard — an out-of-order transition is a permanent (DLQ) error (Req 7.5, 7.6)
 *   • idempotency (P30) — processing the same messageId twice = the same DB state as once
 *
 * **Validates: Requirements 7.1–7.8, 8.1, 8.3, 8.5, 16.2** (P23, P24, P30).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { runWithTenant } from "@civitasone/db";
import { NonRetryableError, type CommandEnvelope } from "@civitasone/queue";
import { sqlClient } from "../src/shared/db.js";
import { COMMANDS, EVENTS } from "../src/topics.js";
import { computeHash } from "../src/modules/minutes/domain.js";
import { registerMinutesConsumers } from "../src/modules/minutes/consumer.js";

const TENANT = "a5a5a5a5-0000-4000-8000-0000000009d4";
const ACTOR = "05050505-0000-4000-8000-0000000009d4";
const COMMITTEE = "b5b5b5b5-0000-4000-8000-0000000009d4";
// A SECOND committee, so a fresh committee's first approved minutes is a genesis (hash_previous null).
const COMMITTEE_2 = "b6b6b6b6-0000-4000-8000-0000000009d4";
const CHAIR = "11111111-0000-4000-8000-0000000009d4";
const SECRETARY = "22222222-0000-4000-8000-0000000009d4";
const APPROVER = "33333333-0000-4000-8000-0000000009d4";

const handlers = new Map<string, (msg: CommandEnvelope<any>) => Promise<void>>();
registerMinutesConsumers((topic, h) => handlers.set(topic, h as any));

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

/**
 * Seed a fresh meeting (its own id) so each `create` respects the one-minutes-per-meeting guard.
 * Optionally attaches full render data (agenda + resolution + attendance) or a bare participant roster.
 */
async function seedMeeting(opts: {
  committeeId?: string;
  rich?: boolean;
  roster?: boolean;
} = {}): Promise<string> {
  const id = randomUUID();
  const committeeId = opts.committeeId ?? COMMITTEE;
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`
      insert into meeting.meetings
        (id, tenant_id, type, title, status, committee_id, chairperson_id, secretary_id, venue,
         scheduled_at, actual_start_at, actual_end_at, meeting_number, duration_minutes, created_by, updated_by)
      values (${id}, ${TENANT}, 'committee', ${"Meeting " + id.slice(0, 8)}, 'minutes_pending', ${committeeId},
              ${CHAIR}, ${SECRETARY}, 'Board Room',
              now() - interval '3 hours', now() - interval '2 hours', now() - interval '1 hour',
              ${"MTG/2025-26/" + id.slice(0, 4)}, 60, ${ACTOR}, ${ACTOR})`;

    if (opts.rich) {
      await sql`
        insert into meeting.agenda_items (id, tenant_id, meeting_id, sequence, title, outcome_type, status, created_by, updated_by)
        values (${randomUUID()}, ${TENANT}, ${id}, 2, 'Budget approval', 'decision', 'accepted', ${ACTOR}, ${ACTOR}),
               (${randomUUID()}, ${TENANT}, ${id}, 1, 'Confirm prior minutes', 'noting', 'accepted', ${ACTOR}, ${ACTOR}),
               (${randomUUID()}, ${TENANT}, ${id}, 3, 'Withdrawn item', 'noting', 'withdrawn', ${ACTOR}, ${ACTOR})`;
      await sql`
        insert into meeting.resolutions
          (id, tenant_id, meeting_id, resolution_number, text, vote_type, votes_for, votes_against, votes_abstain, majority_rule, result, created_by, updated_by)
        values (${randomUUID()}, ${TENANT}, ${id}, 'RES/2025-26/1', 'Approve the annual budget', 'show_of_hands', 5, 0, 1, 'simple_majority', 'passed', ${ACTOR}, ${ACTOR})`;
      const pid = randomUUID();
      await sql`
        insert into meeting.participants (id, tenant_id, meeting_id, employee_id, role, invitation_status, created_by, updated_by)
        values (${pid}, ${TENANT}, ${id}, ${CHAIR}, 'chairperson', 'accepted', ${ACTOR}, ${ACTOR})`;
      await sql`
        insert into meeting.attendance_records (id, tenant_id, meeting_id, participant_id, method, check_in_at, mode, status, created_by, updated_by)
        values (${randomUUID()}, ${TENANT}, ${id}, ${pid}, 'qr', now() - interval '2 hours', 'in_person', 'present', ${ACTOR}, ${ACTOR})`;
    } else if (opts.roster) {
      await sql`
        insert into meeting.participants (id, tenant_id, meeting_id, employee_id, role, invitation_status, created_by, updated_by)
        values (${randomUUID()}, ${TENANT}, ${id}, ${SECRETARY}, 'member', 'pending', ${ACTOR}, ${ACTOR})`;
    }
  });
  return id;
}

/** Read the live minutes row (tenant-scoped) for assertions. */
async function readMinutes(id: string): Promise<any | null> {
  return runWithTenant(TENANT, async () => {
    const rows = await sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
      return sql`select id, meeting_id, status, template_type, content, current_version, version,
                        approved_by, approved_at, hash_previous, hash_current,
                        dsc_signature, dsc_signer_name, dsc_signed_at, submission_deadline
                 from meeting.minutes where id = ${id}`;
    });
    return rows[0] ?? null;
  });
}

async function readMinutesByMeeting(meetingId: string): Promise<any | null> {
  return runWithTenant(TENANT, async () => {
    const rows = await sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
      return sql`select id, status from meeting.minutes where meeting_id = ${meetingId}`;
    });
    return rows[0] ?? null;
  });
}

async function versionCount(minutesId: string): Promise<number> {
  const rows = await runWithTenant(TENANT, () =>
    sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
      return sql`select count(*)::int as n from meeting.minutes_versions where minutes_id = ${minutesId}`;
    }),
  );
  return rows[0].n as number;
}

async function outboxCount(topic: string): Promise<number> {
  const rows = await runWithTenant(TENANT, () =>
    sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
      return sql`select count(*)::int as n from _outbox.messages where tenant_id = ${TENANT} and topic = ${topic}`;
    }),
  );
  return rows[0].n as number;
}

/** Drive create → submit → approve for a meeting, reading the live version at each step. */
async function createSubmitApprove(minutesId: string, meetingId: string, templateType = "summary"): Promise<void> {
  await run(msg(COMMANDS.minutesCreate, { minutesId, meetingId, tenantId: TENANT, templateType }));
  let row = await readMinutes(minutesId);
  await run(msg(COMMANDS.minutesSubmit, { minutesId, tenantId: TENANT, version: row.version }));
  row = await readMinutes(minutesId);
  await run(
    msg(COMMANDS.minutesApprove, { minutesId, tenantId: TENANT, version: row.version, approverId: APPROVER }),
  );
}

beforeAll(async () => {
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    for (const [cid, name] of [
      [COMMITTEE, "Finance Committee"],
      [COMMITTEE_2, "Audit Committee"],
    ] as const) {
      await sql`
        insert into meeting.committees (id, tenant_id, name, type, constitution_date, quorum_rule, created_by, updated_by)
        values (${cid}, ${TENANT}, ${name}, 'standing', '2020-01-01',
                ${sql.json({ minMembers: 2, vcCountsForQuorum: true })}, ${ACTOR}, ${ACTOR})
        on conflict (id) do nothing`;
    }
  });
});

afterAll(async () => {
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`delete from meeting.minutes_versions where tenant_id = ${TENANT}`;
    await sql`delete from meeting.minutes where tenant_id = ${TENANT}`;
    await sql`delete from meeting.attendance_records where tenant_id = ${TENANT}`;
    await sql`delete from meeting.participants where tenant_id = ${TENANT}`;
    await sql`delete from meeting.resolutions where tenant_id = ${TENANT}`;
    await sql`delete from meeting.agenda_items where tenant_id = ${TENANT}`;
    await sql`delete from meeting.meetings where tenant_id = ${TENANT}`;
    await sql`delete from meeting.committees where tenant_id = ${TENANT}`;
    await sql`delete from _outbox.messages where tenant_id = ${TENANT}`;
  });
  await sqlClient.end();
});

describe("minutes.create (Req 7.1, 7.2)", () => {
  it("renders a draft from rich meeting data (attendance + agenda + resolutions) and is idempotent (P30)", async () => {
    const meetingId = await seedMeeting({ rich: true });
    const id = randomUUID();
    const m = msg(COMMANDS.minutesCreate, { minutesId: id, meetingId, tenantId: TENANT, templateType: "verbatim" });
    await run(m);

    const row = await readMinutes(id);
    expect(row).toBeTruthy();
    expect(row.status).toBe("draft");
    expect(row.template_type).toBe("verbatim");
    expect(row.current_version).toBe(1);
    expect(row.submission_deadline).not.toBeNull();
    // Rendered content includes the committee, a resolution, and the ordered agenda (seq 1 before 2),
    // while the withdrawn agenda item is excluded.
    expect(row.content).toContain("Committee: Finance Committee");
    expect(row.content).toContain("RES/2025-26/1");
    expect(row.content.indexOf("Confirm prior minutes")).toBeLessThan(row.content.indexOf("Budget approval"));
    expect(row.content).not.toContain("Withdrawn item");

    // Redelivery with the SAME messageId is a no-op (markProcessed skip) — still exactly one row.
    const auditBefore = await outboxCount("audit.event.record");
    await run(m);
    expect(await outboxCount("audit.event.record")).toBe(auditBefore); // no new audit → skipped
  });

  it("falls back to the invited roster as placeholder attendance when no attendance exists", async () => {
    const meetingId = await seedMeeting({ roster: true });
    const id = randomUUID();
    await run(msg(COMMANDS.minutesCreate, { minutesId: id, meetingId, tenantId: TENANT }));
    const row = await readMinutes(id);
    expect(row.template_type).toBe("summary"); // default when omitted
    expect(row.content).toContain("## Attendance");
  });

  it("is a no-op when the meeting already has a minutes record (one-per-meeting guard)", async () => {
    const meetingId = await seedMeeting();
    const first = randomUUID();
    const second = randomUUID();
    await run(msg(COMMANDS.minutesCreate, { minutesId: first, meetingId, tenantId: TENANT }));
    await run(msg(COMMANDS.minutesCreate, { minutesId: second, meetingId, tenantId: TENANT }));
    expect(await readMinutes(second)).toBeNull();
    expect((await readMinutesByMeeting(meetingId))?.id).toBe(first);
  });

  it("is a no-op when the meeting does not exist", async () => {
    const id = randomUUID();
    await run(msg(COMMANDS.minutesCreate, { minutesId: id, meetingId: randomUUID(), tenantId: TENANT }));
    expect(await readMinutes(id)).toBeNull();
  });
});

describe("minutes.update (Req 7.8)", () => {
  it("snapshots the prior content into minutes_versions and bumps current_version", async () => {
    const meetingId = await seedMeeting({ roster: true });
    const id = randomUUID();
    await run(msg(COMMANDS.minutesCreate, { minutesId: id, meetingId, tenantId: TENANT }));
    const before = await readMinutes(id);

    await run(
      msg(COMMANDS.minutesUpdate, {
        minutesId: id,
        tenantId: TENANT,
        version: before.version,
        content: "revised minutes body",
        changeNote: "typo fixes",
      }),
    );

    const after = await readMinutes(id);
    expect(after.content).toBe("revised minutes body");
    expect(after.current_version).toBe(before.current_version + 1);
    expect(after.version).toBe(before.version + 1);
    expect(await versionCount(id)).toBe(1);
  });
});

describe("minutes.submit (Req 7.3)", () => {
  it("transitions draft → submitted and routes the minutes.submitted event to workflow", async () => {
    const meetingId = await seedMeeting({ roster: true });
    const id = randomUUID();
    await run(msg(COMMANDS.minutesCreate, { minutesId: id, meetingId, tenantId: TENANT }));
    const created = await readMinutes(id);
    const submittedBefore = await outboxCount(EVENTS.minutesSubmitted);

    await run(msg(COMMANDS.minutesSubmit, { minutesId: id, tenantId: TENANT, version: created.version }));

    expect((await readMinutes(id)).status).toBe("submitted");
    expect(await outboxCount(EVENTS.minutesSubmitted)).toBe(submittedBefore + 1);
  });

  it("rejects submit from a non-draft state as a permanent (DLQ) error (workflow-pending guard)", async () => {
    const meetingId = await seedMeeting();
    const id = randomUUID();
    await createSubmitApprove(id, meetingId); // now approved
    const row = await readMinutes(id);
    await expect(
      run(msg(COMMANDS.minutesSubmit, { minutesId: id, tenantId: TENANT, version: row.version })),
    ).rejects.toBeInstanceOf(NonRetryableError);
    expect((await readMinutes(id)).status).toBe("approved");
  });
});

describe("minutes.approve + hash chain (Req 7.5, 8.5 · P23)", () => {
  it("links consecutive approved minutes of the same committee: minutes[2].hash_previous == minutes[1].hash_current", async () => {
    // A fresh committee so the first approval is a genesis (hash_previous null), deterministically.
    const mA = await seedMeeting({ committeeId: COMMITTEE_2 });
    const mB = await seedMeeting({ committeeId: COMMITTEE_2 });
    const idA = randomUUID();
    const idB = randomUUID();

    await createSubmitApprove(idA, mA);
    const a = await readMinutes(idA);
    expect(a.status).toBe("approved");
    expect(a.approved_by).toBe(APPROVER);
    expect(a.hash_previous).toBeNull(); // genesis for this committee
    expect(a.hash_current).toBe(computeHash(a.content));

    await createSubmitApprove(idB, mB);
    const b = await readMinutes(idB);
    // P23: the second approved minutes links back to the first's hash_current.
    expect(b.hash_previous).toBe(a.hash_current);
    expect(b.hash_current).toBe(computeHash(b.content));
    expect(await outboxCount(EVENTS.minutesApproved)).toBeGreaterThanOrEqual(2);
  });

  it("approving a draft (not submitted) is a permanent (DLQ) error", async () => {
    const meetingId = await seedMeeting({ roster: true });
    const id = randomUUID();
    await run(msg(COMMANDS.minutesCreate, { minutesId: id, meetingId, tenantId: TENANT }));
    const row = await readMinutes(id);
    await expect(
      run(msg(COMMANDS.minutesApprove, { minutesId: id, tenantId: TENANT, version: row.version, approverId: APPROVER })),
    ).rejects.toBeInstanceOf(NonRetryableError);
  });

  it("editing an approved (locked) minutes is a permanent (DLQ) error — MINUTES_LOCKED", async () => {
    const meetingId = await seedMeeting({ rich: true });
    const id = randomUUID();
    await createSubmitApprove(id, meetingId);
    const row = await readMinutes(id);
    await expect(
      run(msg(COMMANDS.minutesUpdate, { minutesId: id, tenantId: TENANT, version: row.version, content: "tampered" })),
    ).rejects.toBeInstanceOf(NonRetryableError);
    expect((await readMinutes(id)).content).toBe(row.content); // content unchanged
  });
});

describe("minutes.reject (Req 7.6)", () => {
  it("returns submitted → draft, increments the version, and snapshots the content", async () => {
    const meetingId = await seedMeeting({ roster: true });
    const id = randomUUID();
    await run(msg(COMMANDS.minutesCreate, { minutesId: id, meetingId, tenantId: TENANT }));
    let row = await readMinutes(id);
    await run(msg(COMMANDS.minutesSubmit, { minutesId: id, tenantId: TENANT, version: row.version }));
    row = await readMinutes(id);
    const beforeVersion = row.current_version;

    await run(
      msg(COMMANDS.minutesReject, {
        minutesId: id,
        tenantId: TENANT,
        version: row.version,
        rejectionComments: "please correct the quorum note",
      }),
    );

    const after = await readMinutes(id);
    expect(after.status).toBe("draft");
    expect(after.current_version).toBe(beforeVersion + 1); // Req 7.6 version increment
    expect(await versionCount(id)).toBeGreaterThanOrEqual(1);
    expect(await outboxCount(EVENTS.minutesRejected)).toBeGreaterThan(0);
  });
});

describe("minutes.sign (Req 8.1 · P24)", () => {
  it("seals the approved minutes with a DSC signature such that SHA256(content) == hash_current", async () => {
    const meetingId = await seedMeeting();
    const id = randomUUID();
    await createSubmitApprove(id, meetingId);
    let row = await readMinutes(id);
    expect(row.status).toBe("approved");

    await run(msg(COMMANDS.minutesSign, { minutesId: id, tenantId: TENANT, version: row.version, signerId: CHAIR }));

    row = await readMinutes(id);
    expect(row.status).toBe("signed");
    expect(row.dsc_signature).toBeTruthy();
    expect(row.dsc_signer_name).toBe(CHAIR);
    expect(row.dsc_signed_at).not.toBeNull();
    // P24: a signed document's persisted hash_current equals SHA256(content).
    expect(row.hash_current).toBe(computeHash(row.content));
    expect(await outboxCount(EVENTS.minutesSigned)).toBeGreaterThan(0);
  });
});

describe("minutes.circulate (Req 8.3)", () => {
  it("circulates a signed minutes, notifying the participant roster", async () => {
    const meetingId = await seedMeeting({ roster: true });
    const id = randomUUID();
    await createSubmitApprove(id, meetingId);
    let row = await readMinutes(id);
    await run(msg(COMMANDS.minutesSign, { minutesId: id, tenantId: TENANT, version: row.version, signerId: CHAIR }));
    const notifBefore = await outboxCount("notification.send");
    const circBefore = await outboxCount(EVENTS.minutesCirculated);

    await run(msg(COMMANDS.minutesCirculate, { minutesId: id, tenantId: TENANT }));

    expect((await readMinutes(id)).status).toBe("circulated");
    expect(await outboxCount(EVENTS.minutesCirculated)).toBe(circBefore + 1);
    // The roster has one invited participant → at least one notification enqueued.
    expect(await outboxCount("notification.send")).toBeGreaterThan(notifBefore);
  });

  it("circulates to an explicit recipient list when provided", async () => {
    const meetingId = await seedMeeting();
    const id = randomUUID();
    await createSubmitApprove(id, meetingId);
    let row = await readMinutes(id);
    await run(msg(COMMANDS.minutesSign, { minutesId: id, tenantId: TENANT, version: row.version, signerId: CHAIR }));
    const notifBefore = await outboxCount("notification.send");

    await run(
      msg(COMMANDS.minutesCirculate, { minutesId: id, tenantId: TENANT, recipientIds: [CHAIR, SECRETARY, APPROVER] }),
    );

    expect((await readMinutes(id)).status).toBe("circulated");
    expect(await outboxCount("notification.send")).toBe(notifBefore + 3);
  });
});

describe("consumer no-ops for missing records", () => {
  it("submit / approve / reject / sign / circulate / update on an unknown minutes id are silent no-ops", async () => {
    const unknown = randomUUID();
    await run(msg(COMMANDS.minutesSubmit, { minutesId: unknown, tenantId: TENANT, version: 1 }));
    await run(msg(COMMANDS.minutesApprove, { minutesId: unknown, tenantId: TENANT, version: 1, approverId: APPROVER }));
    await run(msg(COMMANDS.minutesReject, { minutesId: unknown, tenantId: TENANT, version: 1, rejectionComments: "x" }));
    await run(msg(COMMANDS.minutesSign, { minutesId: unknown, tenantId: TENANT, version: 1, signerId: CHAIR }));
    await run(msg(COMMANDS.minutesCirculate, { minutesId: unknown, tenantId: TENANT }));
    await run(msg(COMMANDS.minutesUpdate, { minutesId: unknown, tenantId: TENANT, version: 1, content: "x" }));
    expect(await readMinutes(unknown)).toBeNull();
  });
});
