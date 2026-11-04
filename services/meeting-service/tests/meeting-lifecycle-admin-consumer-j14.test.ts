/**
 * UAT J14 (bundle 15): "Schedule meeting" on the console answered 202 and the meeting stayed in
 * draft. The worker dead-lettered meeting.meeting.transition with NonRetryableError "actor ...
 * lacks ownership standing (chairperson/secretary or committee standing)". The UAT persona was a
 * meeting admin who created the meeting and named other users as chairperson and secretary:
 * the route let it through (ADMIN_ROLES keep the documented Full CRUD bypass), but the consumer
 * re-checked ownership with no role information at all, so every admin-driven transition, update
 * and cancel on a meeting the admin did not chair could only dead-letter.
 *
 * The route now stamps the verified token roles on the command (actorRoles, after the body, so a
 * client cannot supply it) and the consumer honours the same MEETING_ADMIN_ROLES bypass. Everyone
 * else still needs real standing on this meeting.
 *
 * Real DB, real route, real memory queue, real consumer, through the same retry/DLQ router the
 * worker uses: draft -> scheduled -> agenda_locked -> in_progress -> adjourned -> in_progress ->
 * minutes_pending -> minutes_approved -> closed -> archived, plus PATCH and cancel.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { NonRetryableError, type CommandEnvelope, type MemoryQueue } from "@civitasone/queue";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { COMMANDS } from "../src/topics.js";
import { registerMeetingCoreConsumers } from "../src/modules/meeting-core/consumer.js";
import { makeConsumerRouter } from "../src/shared/consumer-router.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const ADMIN = randomUUID();      // meeting_admin who created the meeting (the UAT persona)
const CHAIR = randomUUID();      // named chairperson
const SECRETARY = randomUUID();  // named secretary
const OUTSIDER = randomUUID();   // a chairperson of some other meeting
const COMMITTEE = randomUUID();

const handlers = new Map<string, (m: CommandEnvelope<any>) => Promise<void>>();
registerMeetingCoreConsumers((topic, h) => handlers.set(topic, h as any));

type Dead = { topic: string; err: Error; attempts: number };
const dead: Dead[] = [];
for (const topic of [COMMANDS.meetingTransition, COMMANDS.meetingUpdate, COMMANDS.meetingCancel]) {
  queue.subscribe(topic, makeConsumerRouter({
    topic,
    getHandler: (t) => handlers.get(t),
    runInTenant: async (tenantId, fn) => { await runWithTenant(tenantId, fn); },
    deadLetter: async (t, _m, err, attempts) => { dead.push({ topic: t, err, attempts }); },
    onMissingHandler: () => undefined,
    maxAttempts: 3,
    backoffMs: [0, 0, 0],
    sleep: async () => undefined,
  }));
}
const drain = () => (queue as unknown as MemoryQueue).drain();

const auth = (sub: string, roles: string[]) => ({
  authorization: `Bearer ${signToken({ sub, tid: TENANT, roles, sid: "s-j14b15" }, SECRET)}`,
});

function q<T = any>(fn: (sql: typeof sqlClient) => Promise<T>): Promise<T> {
  return sqlClient.begin(async (sql) => {
    await sql`select set_config(${"app.tenant_id"}, ${TENANT}, true)`;
    return fn(sql as unknown as typeof sqlClient);
  }) as Promise<T>;
}
const readMeeting = (id: string) => q((sql) => sql`select * from meeting.meetings where id = ${id}`).then((r: any) => r[0]);

async function seedMeeting(id: string, committeeId: string | null = null): Promise<void> {
  await q((sql) => sql`
    insert into meeting.meetings (id, tenant_id, type, title, status, committee_id, chairperson_id, secretary_id,
      scheduled_at, duration_minutes, version, created_by, updated_by)
    values (${id}, ${TENANT}, ${"committee"}, ${"J14 admin lifecycle"}, ${"draft"}, ${committeeId}, ${CHAIR}, ${SECRETARY},
      ${new Date(Date.now() + 30 * 86_400_000).toISOString()}, 60, 1, ${ADMIN}, ${ADMIN})`);
  await q((sql) => sql`
    insert into meeting.agenda_items (id, tenant_id, meeting_id, sequence, title, outcome_type, created_by, updated_by)
    values (${randomUUID()}, ${TENANT}, ${id}, 1, ${"Item 1"}, ${"decision"}, ${ADMIN}, ${ADMIN})`);
}

let app: FastifyInstance;
beforeAll(async () => {
  await q((sql) => sql`
    insert into meeting.committees (id, tenant_id, name, code, type, constitution_date, quorum_rule, created_by, updated_by)
    values (${COMMITTEE}, ${TENANT}, ${"J14 Committee"}, ${"JC"}, ${"finance"}, ${"2020-01-01"}, ${sql.json({ minMembers: 1 })}, ${ADMIN}, ${ADMIN})`);
  await q((sql) => sql`
    insert into meeting.committee_members (id, tenant_id, committee_id, member_id, role, appointment_date, status, created_by, updated_by)
    values (${randomUUID()}, ${TENANT}, ${COMMITTEE}, ${CHAIR}, ${"chairperson"}, ${"2020-01-01"}, ${"active"}, ${ADMIN}, ${ADMIN})`);
  app = await buildApp();
});
afterAll(async () => {
  await app.close();
  for (const t of ["meeting_state_transitions", "attendance_records", "participants", "agenda_items", "meetings", "committee_members", "committees"]) {
    await q((sql) => sql`delete from ${sql("meeting." + t)} where tenant_id = ${TENANT}`.catch(() => undefined));
  }
  await q((sql) => sql`delete from _outbox.messages where tenant_id = ${TENANT}`.catch(() => undefined));
  await sqlClient.end();
});

/** POST the transition as `who`, let the worker router process it, return the meeting row. */
async function transition(id: string, to: string, who = auth(ADMIN, ["meeting_admin"]), extra: Record<string, unknown> = {}) {
  const before = await readMeeting(id);
  const res = await app.inject({ method: "POST", url: `/v1/meetings/${id}/transition`, headers: who, payload: { version: before.version, to, ...extra } });
  await drain();
  return { res, row: await readMeeting(id) };
}

describe("meeting lifecycle driven by a meeting admin who is not the chairperson (UAT J14)", () => {
  it("draft -> scheduled -> agenda_locked -> in_progress -> adjourned -> in_progress -> minutes_pending -> minutes_approved -> closed -> archived", async () => {
    for (const committeeId of [null, COMMITTEE]) {
      const id = randomUUID();
      await seedMeeting(id, committeeId);
      dead.length = 0;

      let r = await transition(id, "scheduled");
      expect(r.res.statusCode).toBe(202);
      expect(dead.map((d) => d.err.message)).toEqual([]);
      expect(r.row.status).toBe("scheduled");
      expect(r.row.meeting_number).toBeTruthy();

      r = await transition(id, "agenda_locked");
      expect(r.row.status).toBe("agenda_locked");

      // Quorum is established by the attendance module (check-ins). Record the chairperson as a
      // present attendee (counts for the committee rule on resume) and set the stored flag the
      // start guard reads, as the attendance consumer would.
      await q(async (sql) => {
        const pid = randomUUID();
        await sql`insert into meeting.participants (id, tenant_id, meeting_id, employee_id, role, invitation_status, created_by, updated_by)
          values (${pid}, ${TENANT}, ${id}, ${CHAIR}, ${"chairperson"}, ${"accepted"}, ${ADMIN}, ${ADMIN})`;
        await sql`insert into meeting.attendance_records (id, tenant_id, meeting_id, participant_id, method, check_in_at, mode, status, created_by, updated_by)
          values (${randomUUID()}, ${TENANT}, ${id}, ${pid}, ${"manual"}, now(), ${"in_person"}, ${"present"}, ${ADMIN}, ${ADMIN})`;
        await sql`update meeting.meetings set quorum_established = true where id = ${id}`;
      });
      r = await transition(id, "in_progress");
      expect(r.row.status).toBe("in_progress");
      expect(r.row.actual_start_at).toBeTruthy();

      r = await transition(id, "adjourned", undefined, { reason: "Lunch recess" });
      expect(r.row.status).toBe("adjourned");
      r = await transition(id, "in_progress");
      expect(r.row.status).toBe("in_progress");
      r = await transition(id, "minutes_pending");
      expect(r.row.status).toBe("minutes_pending");
      expect(r.row.actual_end_at).toBeTruthy();
      r = await transition(id, "minutes_approved");
      expect(r.row.status).toBe("minutes_approved");
      r = await transition(id, "closed");
      expect(r.row.status).toBe("closed");
      r = await transition(id, "archived");
      expect(r.row.status).toBe("archived");

      expect(dead).toEqual([]);
      const log = await q((sql) => sql`select from_state, to_state, actor_id from meeting.meeting_state_transitions where meeting_id = ${id} order by transitioned_at`);
      expect((log as any[]).map((l) => `${l.from_state}->${l.to_state}`)).toEqual([
        "draft->scheduled", "scheduled->agenda_locked", "agenda_locked->in_progress", "in_progress->adjourned",
        "adjourned->in_progress", "in_progress->minutes_pending", "minutes_pending->minutes_approved",
        "minutes_approved->closed", "closed->archived",
      ]);
      expect(new Set((log as any[]).map((l) => l.actor_id))).toEqual(new Set([ADMIN]));
    }
  });

  it("tenant_admin and super_admin are honoured the same way; PATCH and cancel by an admin apply", async () => {
    for (const roles of [["tenant_admin"], ["super_admin"]]) {
      const id = randomUUID();
      await seedMeeting(id);
      dead.length = 0;
      const who = auth(randomUUID(), roles);
      const r = await transition(id, "scheduled", who);
      expect(r.row.status).toBe("scheduled");

      const patch = await app.inject({ method: "PATCH", url: `/v1/meetings/${id}`, headers: who, payload: { version: r.row.version, patch: { venue: "Committee Room 2" } } });
      expect(patch.statusCode).toBe(202);
      await drain();
      const patched = await readMeeting(id);
      expect(patched.venue).toBe("Committee Room 2");

      const cancel = await app.inject({ method: "DELETE", url: `/v1/meetings/${id}`, headers: who, payload: { version: patched.version, reason: "Rescheduled by the department" } });
      expect(cancel.statusCode).toBe(202);
      await drain();
      expect((await readMeeting(id)).status).toBe("cancelled");
      expect(dead).toEqual([]);
    }
  });

  it("the named chairperson still drives the lifecycle without an admin role", async () => {
    const id = randomUUID();
    await seedMeeting(id);
    dead.length = 0;
    const r = await transition(id, "scheduled", auth(CHAIR, ["committee_chairperson"]));
    expect(r.row.status).toBe("scheduled");
    expect(dead).toEqual([]);
  });
});

describe("ownership is still enforced for everyone else", () => {
  it("a chairperson of another meeting gets 403 at the route and the meeting is unchanged", async () => {
    const id = randomUUID();
    await seedMeeting(id, COMMITTEE);
    const r = await transition(id, "scheduled", auth(OUTSIDER, ["committee_chairperson"]));
    expect(r.res.statusCode).toBe(403);
    expect(r.row.status).toBe("draft");
  });

  it("a command without admin roles from a non-owner is refused by the consumer (non-retryable, one attempt)", async () => {
    const id = randomUUID();
    await seedMeeting(id);
    for (const actorRoles of [undefined, ["committee_chairperson", "committee_member"]]) {
      dead.length = 0;
      await queue.publish(COMMANDS.meetingTransition, {
        messageId: randomUUID(), type: COMMANDS.meetingTransition, tenantId: TENANT, actorId: OUTSIDER,
        correlationId: randomUUID(), schemaVersion: "1.0",
        payload: { meetingId: id, version: 1, to: "scheduled", ...(actorRoles ? { actorRoles } : {}) },
      });
      await drain();
      expect(dead).toHaveLength(1);
      expect(dead[0]!.attempts).toBe(1);
      expect(dead[0]!.err).toBeInstanceOf(NonRetryableError);
      expect(dead[0]!.err.message).toContain("lacks ownership standing");
      expect((await readMeeting(id)).status).toBe("draft");
    }
  });

  it("a client cannot smuggle actorRoles in the request body", async () => {
    const id = randomUUID();
    await seedMeeting(id);
    dead.length = 0;
    const res = await app.inject({
      method: "POST", url: `/v1/meetings/${id}/transition`, headers: auth(OUTSIDER, ["committee_chairperson"]),
      payload: { version: 1, to: "scheduled", actorRoles: ["super_admin"] },
    });
    // Refused at the route (no standing); and even if it were not, the route overwrites actorRoles from the token.
    expect([400, 403]).toContain(res.statusCode);
    await drain();
    expect((await readMeeting(id)).status).toBe("draft");
  });
});
