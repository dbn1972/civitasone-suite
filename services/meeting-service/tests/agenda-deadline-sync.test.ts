/**
 * An agenda item proposed inside the notice window used to get 202, then dead-letter in the worker with
 * "agenda submission deadline has passed" -- the user never heard. Real-DB test (app.inject + consumer):
 *   - the route answers 422 MEETING_PAST_DEADLINE with the deadline date, synchronously (also 422 when locked);
 *   - the tenant's agenda.submission_deadline_days is honoured;
 *   - POST .../agenda/late is chair/admin-only, needs a reason, skips the cut-off, and the consumer accepts it
 *     and audits it;
 *   - the worker's own re-check stays (HttpError, same code) but is flagged non-retryable and logged.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { isNonRetryable, type CommandEnvelope } from "@civitasone/queue";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { COMMANDS } from "../src/topics.js";
import { HttpError } from "../src/shared/context.js";
import { registerAgendaConsumers } from "../src/modules/agenda/consumer.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-dead-4a1a-9b2c-000000000d01";
const ACTOR = "0a000000-dead-4a1a-9b2c-000000000d01";
const COMMITTEE = "c0c0c0c0-dead-4a1a-9b2c-000000000d01";
const M_SOON = "b1000000-dead-4a1a-9b2c-000000000d01"; // 2 days out: inside the default 7-day window
const M_FAR = "b2000000-dead-4a1a-9b2c-000000000d01";  // far future: open
const M_LOCKED = "b3000000-dead-4a1a-9b2c-000000000d01";
const M_TEN_DAYS = "b4000000-dead-4a1a-9b2c-000000000d01"; // 10 days out: open by default, closed at a 14-day notice

const DAY = 24 * 60 * 60 * 1000;
const SOON = new Date(Date.now() + 2 * DAY);
const TEN_DAYS = new Date(Date.now() + 10 * DAY);

const token = (roles: string[]) => signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-dl" }, SECRET);
let app: Awaited<ReturnType<typeof buildApp>>;
const body = { title: "Late budget note", outcomeType: "discussion" };
const post = (meetingId: string, path: string, roles: string[], payload: Record<string, unknown>) =>
  app.inject({ method: "POST", url: `/v1/meetings/${meetingId}/${path}`, headers: { authorization: `Bearer ${token(roles)}` }, payload });

const asTenant = <T>(fn: (sql: typeof sqlClient) => Promise<T>): Promise<T> =>
  runWithTenant(TENANT, () => sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    return fn(sql as unknown as typeof sqlClient);
  })) as Promise<T>;

const handlers = new Map<string, (m: CommandEnvelope<any>) => Promise<void>>();
registerAgendaConsumers((topic, h) => handlers.set(topic, h as never));
const submitMsg = (meetingId: string, extra: Record<string, unknown> = {}): CommandEnvelope<any> => ({
  messageId: randomUUID(), type: COMMANDS.agendaItemSubmit, tenantId: TENANT, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0",
  payload: { agendaItemId: randomUUID(), meetingId, tenantId: TENANT, ...body, ...extra },
} as CommandEnvelope<any>);
const runSubmit = (m: CommandEnvelope<any>) => runWithTenant(TENANT, () => handlers.get(COMMANDS.agendaItemSubmit)!(m)) as Promise<void>;

beforeAll(async () => {
  await asTenant(async (sql) => {
    await sql`insert into meeting.committees (id, tenant_id, name, code, type, constitution_date, quorum_rule, created_by, updated_by)
      values (${COMMITTEE}, ${TENANT}, 'Deadline Sync Committee', 'DSC', 'standing', '2025-01-01', ${'{"minMembers":2}'}::jsonb, ${ACTOR}, ${ACTOR}) on conflict (id) do nothing`;
    await sql`insert into meeting.meetings (id, tenant_id, type, title, status, committee_id, chairperson_id, scheduled_at, duration_minutes, created_by, updated_by) values
      (${M_SOON}, ${TENANT}, 'committee', 'Soon', 'scheduled', ${COMMITTEE}, ${ACTOR}, ${SOON.toISOString()}, 60, ${ACTOR}, ${ACTOR}),
      (${M_FAR}, ${TENANT}, 'committee', 'Far', 'scheduled', ${COMMITTEE}, ${ACTOR}, '2035-01-15T10:00:00.000Z', 60, ${ACTOR}, ${ACTOR}),
      (${M_LOCKED}, ${TENANT}, 'committee', 'Locked', 'agenda_locked', ${COMMITTEE}, ${ACTOR}, '2035-01-15T10:00:00.000Z', 60, ${ACTOR}, ${ACTOR}),
      (${M_TEN_DAYS}, ${TENANT}, 'committee', 'Ten days', 'scheduled', ${COMMITTEE}, ${ACTOR}, ${TEN_DAYS.toISOString()}, 60, ${ACTOR}, ${ACTOR})
      on conflict (id) do nothing`;
    return null;
  });
  app = await buildApp();
});

afterEach(() => vi.restoreAllMocks());

afterAll(async () => {
  if (app) await app.close();
  await asTenant(async (sql) => {
    await sql`delete from meeting.config_entries where tenant_id = ${TENANT}`;
    await sql`delete from meeting.agenda_items where tenant_id = ${TENANT}`;
    await sql`delete from meeting.meetings where tenant_id = ${TENANT}`;
    await sql`delete from meeting.committees where tenant_id = ${TENANT}`;
    await sql`delete from _outbox.messages where tenant_id = ${TENANT}`;
    return null;
  });
  await sqlClient.end();
});

describe("POST /agenda -- deadline validated synchronously", () => {
  it("422 MEETING_PAST_DEADLINE with the deadline date, and nothing is published", async () => {
    const publish = vi.spyOn(queue, "publish");
    const res = await post(M_SOON, "agenda", ["committee_secretary"], body);
    expect(res.statusCode).toBe(422);
    // The shared error handler flattens `details` into the body: { code, message, deadline, scheduledAt }.
    const e = res.json() as { code: string; message: string; deadline: string; scheduledAt: string };
    expect(e.code).toBe("MEETING_PAST_DEADLINE");
    expect(e.message).toMatch(/deadline has passed/);
    expect(e.scheduledAt).toBe(SOON.toISOString());
    expect(e.deadline).toBe(new Date(SOON.getTime() - 7 * DAY).toISOString());
    expect(publish).not.toHaveBeenCalled();
  });

  it("422 MEETING_AGENDA_LOCKED for a locked agenda (also used to vanish in the worker)", async () => {
    const res = await post(M_LOCKED, "agenda", ["committee_secretary"], body);
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("MEETING_AGENDA_LOCKED");
  });

  it("202 for a meeting still outside the window", async () => {
    const res = await post(M_FAR, "agenda", ["committee_secretary"], body);
    expect(res.statusCode).toBe(202);
  });

  it("honours the tenant's agenda.submission_deadline_days (10 days out: open at 7, closed at 14)", async () => {
    expect((await post(M_TEN_DAYS, "agenda", ["committee_secretary"], body)).statusCode).toBe(202);
    await asTenant((sql) => sql`insert into meeting.config_entries (id, tenant_id, namespace, config_key, value, active, created_by, updated_by)
      values (gen_random_uuid(), ${TENANT}, 'meeting_policy', 'agenda.submission_deadline_days', '14'::jsonb, true, ${ACTOR}, ${ACTOR})`);
    const res = await post(M_TEN_DAYS, "agenda", ["committee_secretary"], body);
    expect(res.statusCode).toBe(422);
    expect(res.json().deadline).toBe(new Date(TEN_DAYS.getTime() - 14 * DAY).toISOString());
    await asTenant((sql) => sql`delete from meeting.config_entries where tenant_id = ${TENANT}`);
  });
});

describe("POST /agenda/late -- chair-approved late inclusion", () => {
  const late = { ...body, reason: "Urgent: sanction letter arrived after the cut-off" };

  it("403 for a secretary: only the chair / administrators may waive the cut-off", async () => {
    expect((await post(M_SOON, "agenda/late", ["committee_secretary"], late)).statusCode).toBe(403);
  });

  it("400 without a reason", async () => {
    expect((await post(M_SOON, "agenda/late", ["committee_chairperson"], body)).statusCode).toBe(400);
  });

  it("422 when the agenda is locked even for the chair", async () => {
    const res = await post(M_LOCKED, "agenda/late", ["committee_chairperson"], late);
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("MEETING_AGENDA_LOCKED");
  });

  it("202 for the chair on a past-deadline meeting; the command carries the approval and the reason", async () => {
    const publish = vi.spyOn(queue, "publish");
    const res = await post(M_SOON, "agenda/late", ["committee_chairperson"], late);
    expect(res.statusCode).toBe(202);
    const env = publish.mock.calls.find((c) => c[0] === COMMANDS.agendaItemSubmit)![1] as { payload: Record<string, unknown> };
    expect(env.payload.lateApproval).toEqual({ approvedBy: ACTOR, reason: late.reason });
    expect(env.payload.title).toBe(body.title);
    expect(env.payload).not.toHaveProperty("reason");
  });
});

describe("agenda.submit worker re-check", () => {
  it("still refuses a past-deadline item, with the same code, flagged non-retryable", async () => {
    const err = await runSubmit(submitMsg(M_SOON)).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).code).toBe("MEETING_PAST_DEADLINE");
    expect((err as HttpError).status).toBe(422);
    expect(isNonRetryable(err)).toBe(true);
  });

  it("a locked-agenda refusal is untouched (not flagged by this change)", async () => {
    const err = await runSubmit(submitMsg(M_LOCKED)).then(() => null, (e: unknown) => e);
    expect((err as HttpError).code).toBe("MEETING_AGENDA_LOCKED");
  });

  it("accepts the same item when it carries a chair's lateApproval, and audits it with the reason", async () => {
    const id = randomUUID();
    await runSubmit(submitMsg(M_SOON, { agendaItemId: id, lateApproval: { approvedBy: ACTOR, reason: "Urgent: sanction letter arrived after the cut-off" } }));
    const rows = await asTenant((sql) => sql`select status from meeting.agenda_items where id = ${id}`);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("proposed");
    const audit = await asTenant((sql) => sql`select payload from _outbox.messages where tenant_id = ${TENANT} and topic = 'audit.event.record' order by created_at desc limit 1`);
    const p = (typeof audit[0]!.payload === "string" ? JSON.parse(audit[0]!.payload as string) : audit[0]!.payload) as { action: string; metadata: { reason: string } };
    expect(p.action).toBe("submit_late_approved");
    expect(p.metadata.reason).toMatch(/sanction letter/);
  });
});
