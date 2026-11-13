/**
 * Gap-fix wave (HANDOFF 5 item 10): "record a held meeting".
 *
 * A draft meeting could only be scheduled for a future date, so a meeting that had already taken place was
 * entered by scheduling it in the future and patching `scheduledAt`, which left `actualStartAt` and the meeting
 * number at the run time. POST /v1/meetings/record-held enters it properly: past date, actual start/end,
 * attendees, minutes, in one atomic command.
 *
 * Real DB (service role, forced RLS): the route is driven through app.inject, the published command is
 * delivered to the real consumer, and the rows are read back.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { runWithTenant } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import { isNonRetryable, type CommandEnvelope } from "@civitasone/queue";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { COMMANDS } from "../src/topics.js";
import { registerMeetingCoreConsumers } from "../src/modules/meeting-core/consumer.js";
import { validateDraftToScheduled } from "../src/modules/meeting-core/domain.js";

const SECRET = process.env.JWT_SECRET as string;
const TENANT = randomUUID();
const COMMITTEE = randomUUID();
const OTHER_COMMITTEE = randomUUID();
const ADMIN = randomUUID();
const SECRETARY = randomUUID(); // named secretary of the meetings
const STANDING_SECRETARY = randomUUID(); // committee roster secretary, not named on the meeting
const OTHER_SECRETARY = randomUUID(); // committee_secretary role, no connection to the meeting
const CHAIR = randomUUID();
const MEMBERS = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];

const as = (sub: string, roles: string[], idem: string | null = randomUUID()) => ({
  authorization: `Bearer ${signToken({ sub, tid: TENANT, roles, sid: "s-gf" }, SECRET, 3600)}`,
  ...(idem ? { "x-idempotency-key": idem } : {}),
});

const handlers = new Map<string, (msg: CommandEnvelope<any>) => Promise<void>>();
registerMeetingCoreConsumers((topic: string, h: any) => handlers.set(topic, h));

type Env = CommandEnvelope<any>;
const published: Env[] = [];
let app: FastifyInstance;
const deliver = (m: Env) => runWithTenant(TENANT, () => handlers.get(m.type)!(m)) as Promise<void>;
const deliverAll = async () => { for (const m of published.splice(0)) await deliver(m); };

function tenantQuery<T>(fn: (sql: typeof sqlClient) => Promise<T>): Promise<T> {
  return runWithTenant(TENANT, () => sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    return fn(sql as unknown as typeof sqlClient);
  })) as Promise<T>;
}

/** A valid body for a sitting held on 15 Jun 2025, 10:00-12:00 IST (FY 2025-26). */
function heldBody(over: Record<string, unknown> = {}) {
  return {
    title: "Standing Committee: June 2025 sitting",
    type: "committee",
    committeeId: COMMITTEE,
    chairpersonId: CHAIR,
    secretaryId: SECRETARY,
    venue: "Committee Room 2, Civic Centre",
    scheduledAt: "2025-06-15T10:00:00+05:30",
    actualStartAt: "2025-06-15T10:07:00+05:30",
    actualEndAt: "2025-06-15T12:10:00+05:30",
    attendees: [
      { employeeId: CHAIR, role: "chairperson" },
      { employeeId: MEMBERS[0]!, role: "member" },
      { employeeId: MEMBERS[1]!, role: "member" },
      { employeeId: MEMBERS[2]!, role: "member", status: "joined_late" },
      { employeeId: MEMBERS[3]!, role: "member", status: "absent" },
    ],
    minutes: { content: "1. Minutes of the previous meeting confirmed.\n2. Ward 14 drainage works approved." },
    ...over,
  };
}
const record = (headers: Record<string, string>, body: unknown) =>
  app.inject({ method: "POST", url: "/v1/meetings/record-held", headers, payload: body as object });
const seq = (num: string) => Number(num.split("/").pop());
async function meetingRow(id: string) {
  return (await tenantQuery((sql) => sql`select * from meeting.meetings where id = ${id}`))[0];
}
async function recordOk(over: Record<string, unknown> = {}, roles = ["meeting_admin"], sub = ADMIN): Promise<string> {
  const res = await record(as(sub, roles), heldBody(over));
  expect(res.statusCode).toBe(202);
  await deliverAll();
  return res.json().data.id as string;
}

beforeAll(async () => {
  (queue as unknown as { publish: unknown }).publish = async (_t: string, msg: Env) => { published.push(msg); };
  app = await buildApp();
  await app.ready();
  await tenantQuery(async (sql) => {
    for (const [id, code] of [[COMMITTEE, "SC"], [OTHER_COMMITTEE, "WC"]] as const) {
      await sql`
        insert into meeting.committees (id, tenant_id, name, code, type, constitution_date, quorum_rule, created_by, updated_by)
        values (${id}, ${TENANT}, ${code + " committee"}, ${code}, 'standing', '2024-01-01',
          ${sql.json({ minMembers: 3, vcCountsForQuorum: true })}, ${ADMIN}, ${ADMIN})`;
    }
    for (const m of [CHAIR, ...MEMBERS]) {
      await sql`
        insert into meeting.committee_members (id, tenant_id, committee_id, member_id, role, appointment_date, status, created_by, updated_by)
        values (${randomUUID()}, ${TENANT}, ${COMMITTEE}, ${m}, ${m === CHAIR ? "chairperson" : "member"}, '2024-01-01', 'active', ${ADMIN}, ${ADMIN})`;
    }
    await sql`
      insert into meeting.committee_members (id, tenant_id, committee_id, member_id, role, appointment_date, status, created_by, updated_by)
      values (${randomUUID()}, ${TENANT}, ${COMMITTEE}, ${STANDING_SECRETARY}, 'secretary', '2024-01-01', 'active', ${ADMIN}, ${ADMIN})`;
  });
});

afterAll(async () => {
  await tenantQuery(async (sql) => {
    for (const t of ["attendance_records", "participants", "minutes", "committee_members", "meeting_state_transitions", "meetings", "committees", "number_sequences"]) {
      await sql.unsafe(`delete from meeting.${t} where tenant_id = '${TENANT}'`);
    }
    await sql`delete from _outbox.messages where tenant_id = ${TENANT}`;
  }).catch(() => undefined);
  await app.close();
  await sqlClient.end();
});

describe("POST /v1/meetings/record-held: what is recorded", () => {
  it("records the meeting at its real date, with attendees, quorum, a minutes draft, a transition and an audit record", async () => {
    const lateIn = { employeeId: MEMBERS[2]!, role: "member", status: "joined_late", checkInAt: "2025-06-15T10:30:00+05:30" };
    const body = heldBody();
    const id = await recordOk({ attendees: [...body.attendees.filter((a) => a.employeeId !== MEMBERS[2]), lateIn] });
    const m = await meetingRow(id);
    expect(m.status).toBe("minutes_pending");
    expect(new Date(m.scheduled_at).toISOString()).toBe("2025-06-15T04:30:00.000Z");
    expect(new Date(m.actual_start_at).toISOString()).toBe("2025-06-15T04:37:00.000Z");
    expect(new Date(m.actual_end_at).toISOString()).toBe("2025-06-15T06:40:00.000Z");
    expect(m.duration_minutes).toBe(123);
    expect(m.financial_year).toBe("2025-26");
    expect(m.meeting_number).toMatch(/^SC\/2025-26\/\d{3}$/);
    expect(m.created_by).toBe(ADMIN);
    // 3 of 4 members present (chair + 2 + 1 late = 4 eligible; the absent one does not count) >= minMembers 3
    expect(m.quorum_established).toBe(true);
    expect(new Date(m.quorum_established_at).toISOString()).toBe("2025-06-15T04:37:00.000Z");

    const att = await tenantQuery((sql) => sql`
      select p.employee_id, p.role, a.status, a.method, a.check_in_at from meeting.attendance_records a
      join meeting.participants p on p.id = a.participant_id where a.meeting_id = ${id}`);
    expect(att).toHaveLength(5);
    expect(att.find((a: any) => a.employee_id === MEMBERS[3])).toMatchObject({ status: "absent", method: "manual" });
    expect(att.find((a: any) => a.employee_id === MEMBERS[2])).toMatchObject({ status: "joined_late" });
    expect(new Date(att.find((a: any) => a.employee_id === MEMBERS[2]).check_in_at).toISOString()).toBe("2025-06-15T05:00:00.000Z");

    const mins = await tenantQuery((sql) => sql`select * from meeting.minutes where meeting_id = ${id}`);
    expect(mins).toHaveLength(1);
    expect(mins[0]).toMatchObject({ status: "draft", current_version: 1, submission_deadline: null });
    expect(mins[0].content).toContain("Ward 14 drainage works approved.");

    const tr = await tenantQuery((sql) => sql`select from_state, to_state, reason, actor_id from meeting.meeting_state_transitions where meeting_id = ${id}`);
    expect(tr).toEqual([{ from_state: "draft", to_state: "minutes_pending", reason: "Recorded as an already-held meeting", actor_id: ADMIN }]);

    const audit = await sqlClient.unsafe(
      `SELECT payload FROM _outbox.messages WHERE tenant_id = $1 AND payload->>'resourceId' = $2 AND payload->>'action' = 'record_held'`, [TENANT, id],
    ) as unknown as Array<{ payload: { metadata: { attendeeCount: number; quorumEstablished: boolean } } }>;
    expect(audit).toHaveLength(1);
    expect(audit[0]!.payload.metadata).toMatchObject({ attendeeCount: 5, quorumEstablished: true });
    // no invitations / calendar side effects for a meeting that is over
    const events = await sqlClient.unsafe(`SELECT topic FROM _outbox.messages WHERE tenant_id = $1 AND payload->>'meetingId' = $2`, [TENANT, id]) as unknown as unknown[];
    expect(events).toHaveLength(0);
  });

  it("computes quorum from the attendees against the committee rule (2 present of a quorum of 3 = not established)", async () => {
    const id = await recordOk({
      title: "Standing Committee: July 2025 sitting",
      scheduledAt: "2025-07-15T10:00:00+05:30", actualStartAt: "2025-07-15T10:00:00+05:30", actualEndAt: "2025-07-15T11:00:00+05:30",
      attendees: [{ employeeId: CHAIR, role: "chairperson" }, { employeeId: MEMBERS[0]!, role: "member" }],
    });
    const m = await meetingRow(id);
    expect(m.quorum_established).toBe(false);
    expect(m.quorum_established_at).toBeNull();
  });

  it("refuses an attendee check-in outside the sitting (non-retryable, nothing recorded)", async () => {
    const res = await record(as(ADMIN, ["meeting_admin"]), heldBody({
      title: "Attendee time probe",
      attendees: [{ employeeId: CHAIR, role: "chairperson", checkInAt: "2025-06-15T16:00:00+05:30" }],
    }));
    expect(res.statusCode).toBe(202);
    let err: unknown;
    try { await deliverAll(); } catch (e) { err = e; }
    expect(isNonRetryable(err)).toBe(true);
    expect(await tenantQuery((sql) => sql`select id from meeting.meetings where title = 'Attendee time probe'`)).toHaveLength(0);
  });

  it("scheduledAt defaults to the actual start", async () => {
    const body = heldBody({ title: "Standing Committee: August 2025 sitting", actualStartAt: "2025-08-15T10:00:00+05:30", actualEndAt: "2025-08-15T11:00:00+05:30" });
    delete (body as Record<string, unknown>).scheduledAt;
    const res = await record(as(ADMIN, ["meeting_admin"]), body);
    expect(res.statusCode).toBe(202);
    await deliverAll();
    const m = await meetingRow(res.json().data.id);
    expect(new Date(m.scheduled_at).toISOString()).toBe("2025-08-15T04:30:00.000Z");
  });

  it("a replay under the same idempotency key records one meeting", async () => {
    const key = randomUUID();
    const body = heldBody({ title: "Standing Committee: September 2025 sitting", scheduledAt: "2025-09-15T10:00:00+05:30", actualStartAt: "2025-09-15T10:00:00+05:30", actualEndAt: "2025-09-15T11:00:00+05:30" });
    const a = await record(as(ADMIN, ["meeting_admin"], key), body);
    const b = await record(as(ADMIN, ["meeting_admin"], key), body);
    expect(a.json().data.id).toBe(b.json().data.id);
    await deliverAll();
    const rows = await tenantQuery((sql) => sql`select id from meeting.meetings where title = ${body.title}`);
    expect(rows).toHaveLength(1);
  });
});

describe("numbering: consistent and gap-free", () => {
  it("numbers from the FY of the HELD date, consecutively, and a refused recording consumes no number", async () => {
    const mk = (n: number, fy: "2023" | "2025") => heldBody({
      title: `Numbering probe ${fy}-${n}`,
      scheduledAt: `${fy}-05-${10 + n}T10:00:00+05:30`, actualStartAt: `${fy}-05-${10 + n}T10:00:00+05:30`, actualEndAt: `${fy}-05-${10 + n}T11:00:00+05:30`,
    });
    const a = await recordOk(mk(1, "2025"));
    const b = await recordOk(mk(2, "2025"));
    const na = (await meetingRow(a)).meeting_number as string;
    const nb = (await meetingRow(b)).meeting_number as string;
    expect(na).toMatch(/^SC\/2025-26\//);
    expect(seq(nb)).toBe(seq(na) + 1);

    // refused: duplicate of b (different idempotency key) -> non-retryable, nothing inserted, number not consumed
    const dup = await record(as(ADMIN, ["meeting_admin"]), mk(2, "2025"));
    expect(dup.statusCode).toBe(202);
    let err: unknown;
    try { await deliverAll(); } catch (e) { err = e; }
    expect(isNonRetryable(err)).toBe(true);
    expect(String((err as Error).message)).toMatch(/MEETING_ALREADY_RECORDED/);

    const c = await recordOk(mk(3, "2025"));
    const nc = (await meetingRow(c)).meeting_number as string;
    // a (n), b (n+1), c (n+2): the refused duplicate left no gap
    expect(seq(nc)).toBe(seq(nb) + 1);

    // another FY has its own series, starting at 001 for this prefix
    const old = await recordOk(mk(5, "2023"));
    expect((await meetingRow(old)).meeting_number).toBe("SC/2023-24/001");
    // every recorded 2025-26 number so far is consecutive from 001: no gaps in the series
    const nums = await tenantQuery((sql) => sql`select meeting_number from meeting.meetings where financial_year = '2025-26' and committee_id = ${COMMITTEE} order by meeting_number`);
    const seqs = nums.map((r: any) => seq(r.meeting_number)).sort((x: number, y: number) => x - y);
    expect(seqs).toEqual(seqs.map((_: number, i: number) => i + 1));
  });
});

describe("future dates are refused", () => {
  const future = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
  it("route: a future scheduledAt, actualStartAt or actualEndAt is 400 and nothing is published", async () => {
    for (const over of [
      { scheduledAt: future(2) },
      { actualStartAt: future(1), actualEndAt: future(1.1) },
      { actualEndAt: future(0.5) },
    ]) {
      const res = await record(as(ADMIN, ["meeting_admin"]), heldBody({ title: "never recorded", ...over }));
      expect(res.statusCode).toBe(400);
    }
    expect(published).toHaveLength(0);
  });

  it("route: end before start, a >24h sitting, an empty attendee list, no minutes and a duplicated attendee are 400", async () => {
    const bad = [
      { actualStartAt: "2025-06-15T12:00:00+05:30", actualEndAt: "2025-06-15T11:00:00+05:30" },
      { actualStartAt: "2025-06-14T09:00:00+05:30", actualEndAt: "2025-06-15T12:00:00+05:30" },
      { attendees: [] },
      { minutes: { content: "   " } },
      { attendees: [{ employeeId: CHAIR, role: "chairperson" }, { employeeId: CHAIR, role: "member" }] },
    ];
    for (const over of bad) {
      expect((await record(as(ADMIN, ["meeting_admin"]), heldBody({ title: "never recorded", ...over }))).statusCode).toBe(400);
    }
    const noMinutes = heldBody({ title: "never recorded" }); delete (noMinutes as Record<string, unknown>).minutes;
    expect((await record(as(ADMIN, ["meeting_admin"]), noMinutes)).statusCode).toBe(400);
    expect(published).toHaveLength(0);
  });

  it("consumer: a forged command with a future date is refused non-retryably and records nothing (defence in depth)", async () => {
    const id = randomUUID();
    const err = await deliver({
      messageId: id, type: COMMANDS.meetingRecordHeld, tenantId: TENANT, actorId: ADMIN, correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { ...heldBody({ title: "forged future", actualStartAt: new Date(Date.now() + 86_400_000).toISOString(), actualEndAt: new Date(Date.now() + 90_000_000).toISOString(), scheduledAt: new Date(Date.now() + 86_000_000).toISOString() }), id, tenantId: TENANT, minutesId: randomUUID(), actorRoles: ["meeting_admin"] },
    } as Env).then(() => undefined, (e) => e);
    expect(isNonRetryable(err)).toBe(true);
    expect(await meetingRow(id)).toBeUndefined();
  });

  it("the normal scheduling path is unchanged: a past date still cannot be scheduled", () => {
    const now = new Date();
    let unmet: string[] = [];
    try {
      validateDraftToScheduled({ now, chairpersonId: CHAIR, agendaItemCount: 1, scheduledAt: new Date(now.getTime() - 86_400_000) });
    } catch (e) { unmet = (e as { details?: { unmet?: string[] } }).details?.unmet ?? []; }
    expect(unmet).toContain("futureScheduledAt");
  });
});

describe("who may record a held meeting", () => {
  it("meeting admin, the named secretary and a committee-roster secretary may; each recording is attributed to the actor", async () => {
    for (const [sub, roles, title] of [
      [ADMIN, ["meeting_admin"], "Role probe: admin"],
      [SECRETARY, ["committee_secretary"], "Role probe: named secretary"],
      [STANDING_SECRETARY, ["committee_secretary"], "Role probe: roster secretary"],
    ] as const) {
      const id = await recordOk({ title, scheduledAt: "2025-10-10T10:00:00+05:30", actualStartAt: "2025-10-10T10:00:00+05:30", actualEndAt: "2025-10-10T11:00:00+05:30" }, [...roles], sub);
      expect((await meetingRow(id)).created_by).toBe(sub);
    }
  });

  it("refuses chairperson, members, observers, unrelated secretaries and callers with no role (403, nothing published)", async () => {
    for (const [sub, roles] of [
      [CHAIR, ["committee_chairperson"]],
      [MEMBERS[0]!, ["committee_member"]],
      [MEMBERS[1]!, ["observer"]],
      [OTHER_SECRETARY, ["committee_secretary"]], // a secretary with no tie to this meeting or committee
      [ADMIN, []],
    ] as const) {
      const res = await record(as(sub, [...roles]), heldBody({ title: "Role refusal probe" }));
      expect(res.statusCode).toBe(403);
    }
    expect(published).toHaveLength(0);
    expect(await tenantQuery((sql) => sql`select id from meeting.meetings where title = 'Role refusal probe'`)).toHaveLength(0);
  });

  it("an unrelated secretary is also refused for a meeting with no committee unless they are its named secretary", async () => {
    const body = heldBody({ title: "Role refusal probe (no committee)", type: "departmental" });
    delete (body as Record<string, unknown>).committeeId;
    expect((await record(as(OTHER_SECRETARY, ["committee_secretary"]), body)).statusCode).toBe(403);
    const own = { ...body, secretaryId: OTHER_SECRETARY, title: "Departmental review (no committee)" };
    const ok = await record(as(OTHER_SECRETARY, ["committee_secretary"]), own);
    expect(ok.statusCode).toBe(202);
    await deliverAll();
    const m = await meetingRow(ok.json().data.id);
    expect(m.meeting_number).toMatch(/^MTG\/2025-26\//);
    expect(m.quorum_established).toBe(false); // no committee and none stated
  });

  it("consumer re-checks authority: a command without the stamped roles gets no admin bypass", async () => {
    const id = randomUUID();
    const err = await deliver({
      messageId: id, type: COMMANDS.meetingRecordHeld, tenantId: TENANT, actorId: OTHER_SECRETARY, correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { ...heldBody({ title: "forged authority" }), id, tenantId: TENANT, minutesId: randomUUID() },
    } as Env).then(() => undefined, (e) => e);
    expect(isNonRetryable(err)).toBe(true);
    expect(await meetingRow(id)).toBeUndefined();
  });

  it("requires an idempotency key, and a known committee", async () => {
    expect((await record(as(ADMIN, ["meeting_admin"], null), heldBody())).statusCode).toBe(400);
    expect((await record(as(ADMIN, ["meeting_admin"]), heldBody({ committeeId: randomUUID() }))).statusCode).toBe(404);
    expect(published).toHaveLength(0);
  });
});

describe("duplicate recording is also enforced by the database (migration 0016)", () => {
  const dupBody = () => heldBody({
    title: "Race probe sitting",
    scheduledAt: "2025-11-03T10:00:00+05:30", actualStartAt: "2025-11-03T10:00:00+05:30", actualEndAt: "2025-11-03T11:00:00+05:30",
  });
  const nextSeq = async () => {
    const r = await tenantQuery((sql) => sql`select current_value from meeting.number_sequences where series_key = 'meeting:SC' and bucket = '2025-26'`);
    return Number(r[0].current_value);
  };

  it("the unique partial index rejects a second record-held row with the same identity, ignores ordinary meetings and cancelled ones", async () => {
    const mk = async (over: Record<string, unknown>) => tenantQuery((sql) => sql`
      insert into meeting.meetings (id, tenant_id, type, title, status, committee_id, scheduled_at, created_by, updated_by, recorded_held_at)
      values (${randomUUID()}, ${TENANT}, 'committee', 'Index probe', ${(over.status as string) ?? "minutes_pending"}, ${COMMITTEE}, '2025-12-01T10:00:00Z', ${ADMIN}, ${ADMIN}, case when ${Boolean(over.held)}::boolean then now() end)`);
    await mk({ held: true });
    await expect(mk({ held: true })).rejects.toMatchObject({ code: "23505" });
    await mk({ held: false });                       // ordinary meeting, same identity: not constrained
    await mk({ held: false });
    await mk({ held: true, status: "cancelled" });   // cancelled: outside the index
  });

  it("two concurrent recordings under different idempotency keys: exactly one meeting, the loser is MEETING_ALREADY_RECORDED, and no number is lost", async () => {
    const before = await nextSeq();
    const [a, b] = await Promise.all([record(as(ADMIN, ["meeting_admin"]), dupBody()), record(as(ADMIN, ["meeting_admin"]), dupBody())]);
    expect([a.statusCode, b.statusCode]).toEqual([202, 202]);
    const cmds = published.splice(0);
    expect(cmds).toHaveLength(2);
    const results = await Promise.allSettled(cmds.map((m) => deliver(m)));
    const failed = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(isNonRetryable(failed[0]!.reason)).toBe(true);
    expect(String(failed[0]!.reason.message)).toMatch(/MEETING_ALREADY_RECORDED/);
    expect(await tenantQuery((sql) => sql`select id from meeting.meetings where title = 'Race probe sitting'`)).toHaveLength(1);
    // the loser's allocation rolled back with its transaction: exactly one number consumed, so the next is consecutive
    expect(await nextSeq()).toBe(before + 1);
    const next = await recordOk({ title: "After the race", scheduledAt: "2025-11-04T10:00:00+05:30", actualStartAt: "2025-11-04T10:00:00+05:30", actualEndAt: "2025-11-04T11:00:00+05:30" });
    expect(seq((await meetingRow(next)).meeting_number)).toBe(before + 2);
  });

  it("a unique violation that slips past the application guard is mapped to MEETING_ALREADY_RECORDED and consumes no number", async () => {
    // A concurrent, still-uncommitted transaction holds an identical record-held row, which the application guard
    // cannot see; only the unique index can stop the second insert, and only once the first commits.
    const body = heldBody({ title: "Blind race", scheduledAt: "2025-11-05T10:00:00+05:30", actualStartAt: "2025-11-05T10:00:00+05:30", actualEndAt: "2025-11-05T11:00:00+05:30" });
    const before = await nextSeq();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    // transaction A: inserts the identical record-held row and stays open (uncommitted)
    const holder = tenantQuery(async (sql) => {
      await sql`insert into meeting.meetings (id, tenant_id, type, title, status, committee_id, scheduled_at, created_by, updated_by, recorded_held_at)
        values (${randomUUID()}, ${TENANT}, 'committee', 'Blind race', 'minutes_pending', ${COMMITTEE}, ${"2025-11-05T04:30:00.000Z"}::timestamptz, ${ADMIN}, ${ADMIN}, now())`;
      await gate;
    });
    await new Promise((r) => setTimeout(r, 200));
    const res = await record(as(ADMIN, ["meeting_admin"]), body);
    const cmd = published.splice(0)[0]!;
    const loser = deliver(cmd).then(() => undefined, (e) => e);   // passes the guard (A is invisible), blocks on A's index entry
    await new Promise((r) => setTimeout(r, 300));
    release();                                                    // A commits -> the loser's insert violates the index
    await holder;
    const err = await loser;
    expect(res.statusCode).toBe(202);
    expect(isNonRetryable(err)).toBe(true);
    expect(String((err as Error).message)).toMatch(/MEETING_ALREADY_RECORDED/);
    expect(await tenantQuery((sql) => sql`select id from meeting.meetings where title = 'Blind race'`)).toHaveLength(1);
    expect(await nextSeq()).toBe(before);   // the loser's allocation was rolled back
  });
});
