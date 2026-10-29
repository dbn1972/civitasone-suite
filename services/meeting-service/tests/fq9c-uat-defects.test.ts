/**
 * FQ9-C UAT regressions (meeting-service), real Postgres + RLS.
 *
 *  #9  committee.member_update dropped `appointingAuthority` (role/votingRight applied).
 *  #10 resolution.circulation_init stored status "effective", which the voting module treats
 *      as TERMINAL → every circulation vote was 202'd and silently no-op'd (0 votes rows).
 *  #12 agenda lock had no source-state guard → a DRAFT meeting recorded draft → agenda_locked.
 *      Now 409 at the route and a permanent (NonRetryable) rejection in the consumer.
 *  #8  attendance check-in/out outside the 24h window: 202 then dead-letter → now 422 up front.
 *  #7  POST /config/presets/:preset published entries serially (504 on UAT) → bounded concurrency.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { NonRetryableError, type CommandEnvelope } from "@civitasone/queue";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { COMMANDS } from "../src/topics.js";
import { registerAgendaConsumers } from "../src/modules/agenda/consumer.js";
import { registerCommitteeConsumers } from "../src/modules/committee/consumer.js";
import { registerDecisionConsumers } from "../src/modules/decision/consumer.js";
import { registerVotingConsumers } from "../src/modules/voting/consumer.js";
import { applyPreset, forEachBounded, getPreset } from "../src/modules/config-registry/presets.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "f9c0f9c0-0000-4000-8000-0000000f9c01";
const ACTOR = "f9c0f9c0-0000-4000-8000-0000000f9ca0";
const COMMITTEE = "f9c0f9c0-0000-4000-8000-0000000f9cc0";
const MEMBER_A = "f9c0f9c0-0000-4000-8000-0000000f9cd1";
const MEMBER_B = "f9c0f9c0-0000-4000-8000-0000000f9cd2";
const MEMBERSHIP_A = "f9c0f9c0-0000-4000-8000-0000000f9ce1";
const ANCHOR_MEETING = "f9c0f9c0-0000-4000-8000-0000000f9cb0";
const DRAFT_MEETING = "f9c0f9c0-0000-4000-8000-0000000f9cb1";
const SCHEDULED_MEETING = "f9c0f9c0-0000-4000-8000-0000000f9cb2";
const NEAR_MEETING = "f9c0f9c0-0000-4000-8000-0000000f9cb3";

const FUTURE = "2035-03-10T10:00:00.000Z";
const NEAR = new Date(Date.now() + 60 * 60 * 1000).toISOString();

const handlers = new Map<string, (msg: CommandEnvelope<any>) => Promise<void>>();
const register = (topic: string, h: (m: CommandEnvelope<any>) => Promise<void>) => handlers.set(topic, h);
registerAgendaConsumers(register as any);
registerCommitteeConsumers(register as any);
registerDecisionConsumers(register as any);
registerVotingConsumers(register as any);

function msg<T>(type: string, payload: T, actorId = ACTOR): CommandEnvelope<T> {
  return {
    messageId: randomUUID(), type, tenantId: TENANT, actorId,
    correlationId: randomUUID(), schemaVersion: "1.0", payload,
  } as CommandEnvelope<T>;
}

function run<T>(m: CommandEnvelope<T>): Promise<void> {
  const h = handlers.get(m.type);
  if (!h) throw new Error(`no handler for ${m.type}`);
  return runWithTenant(TENANT, () => h(m)) as Promise<void>;
}

function q<T = any>(fn: (sql: typeof sqlClient) => Promise<T>): Promise<T> {
  return runWithTenant(TENANT, () =>
    sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
      return fn(sql as unknown as typeof sqlClient);
    }),
  ) as Promise<T>;
}

const token = (roles: string[] = ["committee_secretary"]) => signToken({ sub: ACTOR, tid: TENANT, roles, sid: "s-fq9c" }, SECRET);
const H = (roles?: string[]) => ({ authorization: `Bearer ${token(roles)}`, "content-type": "application/json" });

async function wipe(): Promise<void> {
  await q(async (sql) => {
    await sql`delete from meeting.votes where tenant_id = ${TENANT}`;
    await sql`delete from meeting.resolutions where tenant_id = ${TENANT}`;
    await sql`delete from meeting.attendance_records where tenant_id = ${TENANT}`;
    await sql`delete from meeting.participants where tenant_id = ${TENANT}`;
    await sql`delete from meeting.meeting_state_transitions where tenant_id = ${TENANT}`;
    await sql`delete from meeting.meetings where tenant_id = ${TENANT}`;
    await sql`delete from meeting.committee_members where tenant_id = ${TENANT}`;
    await sql`delete from meeting.committees where tenant_id = ${TENANT}`;
    await sql`delete from _outbox.messages where tenant_id = ${TENANT}`;
    return null;
  });
}

let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  await wipe();
  await q(async (sql) => {
    await sql`
      insert into meeting.committees (id, tenant_id, name, code, type, constitution_date, quorum_rule, created_by, updated_by)
      values (${COMMITTEE}, ${TENANT}, 'FQ9C Committee', 'FQC', 'standing', '2025-01-01', ${sql.json({ minMembers: 2 })}, ${ACTOR}, ${ACTOR})`;
    await sql`
      insert into meeting.committee_members (id, tenant_id, committee_id, member_id, role, appointment_date, appointing_authority, status, created_by, updated_by)
      values (${MEMBERSHIP_A}, ${TENANT}, ${COMMITTEE}, ${MEMBER_A}, 'member', '2025-01-01', 'FQ9 Auth', 'active', ${ACTOR}, ${ACTOR}),
             (${randomUUID()}, ${TENANT}, ${COMMITTEE}, ${MEMBER_B}, 'member', '2025-01-01', 'FQ9 Auth', 'active', ${ACTOR}, ${ACTOR})`;
    await sql`
      insert into meeting.meetings (id, tenant_id, type, title, status, committee_id, financial_year, scheduled_at, duration_minutes, created_by, updated_by)
      values (${ANCHOR_MEETING}, ${TENANT}, 'committee', 'FQ9C anchor', 'scheduled', ${COMMITTEE}, '2034-35', ${FUTURE}, 60, ${ACTOR}, ${ACTOR}),
             (${DRAFT_MEETING}, ${TENANT}, 'committee', 'FQ9C draft', 'draft', ${COMMITTEE}, '2034-35', ${FUTURE}, 60, ${ACTOR}, ${ACTOR}),
             (${SCHEDULED_MEETING}, ${TENANT}, 'committee', 'FQ9C scheduled', 'scheduled', ${COMMITTEE}, '2034-35', ${FUTURE}, 60, ${ACTOR}, ${ACTOR}),
             (${NEAR_MEETING}, ${TENANT}, 'committee', 'FQ9C near', 'scheduled', ${COMMITTEE}, '2026-27', ${NEAR}, 60, ${ACTOR}, ${ACTOR})`;
    return null;
  });
  app = await buildApp();
});

afterAll(async () => {
  if (app) await app.close();
  await wipe();
  await sqlClient.end();
});

describe("FQ9 #9 — committee member PATCH applies appointingAuthority", () => {
  it("member_update writes appointing_authority alongside role / votingRight", async () => {
    await run(msg(COMMANDS.committeeMemberUpdate, {
      committeeId: COMMITTEE, membershipId: MEMBERSHIP_A, version: 1,
      patch: { role: "member", appointingAuthority: "FQ9 Auth2", votingRight: true },
    }));
    const rows = await q((sql) => sql`select appointing_authority, role from meeting.committee_members where id = ${MEMBERSHIP_A}`);
    expect(rows[0]).toMatchObject({ appointing_authority: "FQ9 Auth2", role: "member" });
  });
});

describe("FQ9 #10 — circulation resolution accepts and records votes", () => {
  it("circulation_init leaves the resolution open; a member's response lands a meeting.votes row", async () => {
    const rid = randomUUID();
    await run(msg(COMMANDS.resolutionCirculationInit, {
      resolutionId: rid, tenantId: TENANT, committeeId: COMMITTEE, text: "FQ9C circulation",
      deadline: new Date(Date.now() + 2 * 86_400_000).toISOString(), majorityRule: "simple_majority",
    }));
    const [res] = await q((sql) => sql`select status, is_circulation from meeting.resolutions where id = ${rid}`);
    expect(res?.is_circulation).toBe(true);
    expect(res?.status).toBe("circulating");

    await run(msg(COMMANDS.voteCirculationRespond, {
      resolutionId: rid, tenantId: TENANT, memberId: MEMBER_A, position: "approve", comment: "ok",
    }, MEMBER_A));
    const votes = await q((sql) => sql`select member_id, position from meeting.votes where resolution_id = ${rid}`);
    expect(votes).toHaveLength(1);
    expect(votes[0]).toMatchObject({ member_id: MEMBER_A, position: "approve" });
  });
});

describe("FQ9 #12 — agenda lock enforces the meeting state machine", () => {
  it("consumer: locking a DRAFT meeting is a permanent rejection; status and transitions unchanged", async () => {
    await expect(run(msg(COMMANDS.agendaLock, { meetingId: DRAFT_MEETING, version: 1, locked: true })))
      .rejects.toBeInstanceOf(NonRetryableError);
    const [m] = await q((sql) => sql`select status from meeting.meetings where id = ${DRAFT_MEETING}`);
    expect(m?.status).toBe("draft");
    const t = await q((sql) => sql`select 1 from meeting.meeting_state_transitions where meeting_id = ${DRAFT_MEETING}`);
    expect(t).toHaveLength(0);
  });

  it("route: lock / unlock of a DRAFT meeting → 409; lock of a SCHEDULED meeting → 202", async () => {
    const lockDraft = await app.inject({ method: "POST", url: `/v1/meetings/${DRAFT_MEETING}/agenda/lock`, headers: H(), payload: { version: 1 } });
    expect(lockDraft.statusCode).toBe(409);
    expect(lockDraft.body).toContain("MEETING_INVALID_TRANSITION");
    const unlockDraft = await app.inject({ method: "POST", url: `/v1/meetings/${DRAFT_MEETING}/agenda/unlock`, headers: H(["committee_chairperson"]), payload: { version: 1 } });
    expect(unlockDraft.statusCode).toBe(409);
    const lockScheduled = await app.inject({ method: "POST", url: `/v1/meetings/${SCHEDULED_MEETING}/agenda/lock`, headers: H(), payload: { version: 1 } });
    expect(lockScheduled.statusCode).toBe(202);
  });
});

describe("FQ9 #8 — attendance check-in outside the 24h window is rejected synchronously", () => {
  const body = { participantId: randomUUID(), method: "manual", mode: "in_person" };

  it("check-in now for a meeting scheduled years ahead → 422 ATTENDANCE_INVALID_TIMESTAMP", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/meetings/${ANCHOR_MEETING}/attendance/check-in`,
      headers: { ...H(), "x-idempotency-key": randomUUID() }, payload: body,
    });
    expect(res.statusCode).toBe(422);
    expect(res.body).toContain("ATTENDANCE_INVALID_TIMESTAMP");
  });

  it("check-in within the window → 202", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/meetings/${NEAR_MEETING}/attendance/check-in`,
      headers: { ...H(), "x-idempotency-key": randomUUID() }, payload: body,
    });
    expect(res.statusCode).toBe(202);
  });

  it("check-out outside the window → 422", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/meetings/${ANCHOR_MEETING}/attendance/check-out`,
      headers: { ...H(), "x-idempotency-key": randomUUID() }, payload: { participantId: body.participantId },
    });
    expect(res.statusCode).toBe(422);
  });
});

describe("FQ9 #7 — applying a preset publishes with bounded concurrency", () => {
  it("forEachBounded never exceeds the limit and visits every item", async () => {
    let inFlight = 0;
    let peak = 0;
    const seen: number[] = [];
    await forEachBounded([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      inFlight += 1; peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 10));
      seen.push(n); inFlight -= 1;
    });
    expect(peak).toBe(3);
    expect(seen.sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("board-of-directors: every entry is published and publishes overlap (not serial)", async () => {
    const entries = getPreset("board-of-directors")!.length;
    const PUBLISH_MS = 100;
    let inFlight = 0;
    let peak = 0;
    const spy = vi.spyOn(queue, "publish").mockImplementation(async () => {
      inFlight += 1; peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, PUBLISH_MS));
      inFlight -= 1;
      return randomUUID();
    });
    try {
      const started = Date.now();
      const result = await applyPreset({ tenantId: TENANT, actorId: ACTOR, correlationId: "fq9c-preset" } as any, "board-of-directors");
      const elapsed = Date.now() - started;
      expect(result).toMatchObject({ accepted: true, entries });
      expect(spy).toHaveBeenCalledTimes(entries);
      expect(peak).toBeGreaterThan(1);
      // Serial would take entries × PUBLISH_MS; concurrent finishes in a fraction of that.
      expect(elapsed).toBeLessThan(entries * PUBLISH_MS * 0.6);
    } finally {
      spy.mockRestore();
    }
  });
});
