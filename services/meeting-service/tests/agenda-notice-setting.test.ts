/**
 * Gap-fix wave (HANDOFF 5 item 10): the agenda notice period ("agenda items need more than 7 days to the
 * meeting") is a setting per tenant AND per committee, defaulting to the former hard-coded 7 days.
 *
 * Resolution: committee override -> tenant `meeting_policy` -> 7. The code encodes no statutory minimum for
 * this knob; the statutory notice of a MEETING is the separate `meeting.notice_period_days` rule (unchanged).
 *
 * Part 1: pure unit tests. Part 2: real DB through the config routes, the config consumer and the agenda
 * submit consumer.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { runWithTenant } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import type { CommandEnvelope } from "@civitasone/queue";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { COMMANDS } from "../src/topics.js";
import { registerAgendaConsumers } from "../src/modules/agenda/consumer.js";
import { registerConfigRegistryConsumers } from "../src/modules/config-registry/consumer.js";
import { setConfigBody } from "../src/modules/config-registry/validators.js";
import {
  AGENDA_NOTICE_KEY, COMMITTEE_POLICY_NS, committeeAgendaNoticeKey, committeeIdFromAgendaNoticeKey, parseAgendaNoticeDays,
} from "../src/modules/config-registry/domain.js";
import { POLICY_DEFAULTS, resolveAgendaNotice } from "../src/modules/config-registry/policy.js";
import { DEFAULT_SUBMISSION_DEADLINE_DAYS } from "../src/modules/agenda/domain.js";

const C1 = "11111111-2222-4333-8444-555555555555";

describe("resolveAgendaNotice (pure)", () => {
  it("nothing configured = the former 7 days, source default", () => {
    expect(resolveAgendaNotice(undefined, undefined)).toEqual({ days: 7, source: "default" });
    expect(POLICY_DEFAULTS["agenda.submission_deadline_days"]).toBe(7);
    expect(DEFAULT_SUBMISSION_DEADLINE_DAYS).toBe(7);
  });

  it("the tenant setting applies when there is no committee override (read exactly as before)", () => {
    expect(resolveAgendaNotice(undefined, 10)).toEqual({ days: 10, source: "tenant" });
    expect(resolveAgendaNotice(undefined, "5")).toEqual({ days: 5, source: "tenant" });
    expect(resolveAgendaNotice(undefined, { value: 4 })).toEqual({ days: 4, source: "tenant" });
  });

  it("a committee override wins over the tenant setting, including 0", () => {
    expect(resolveAgendaNotice(14, 10)).toEqual({ days: 14, source: "committee" });
    expect(resolveAgendaNotice(0, 10)).toEqual({ days: 0, source: "committee" });
  });

  it("a malformed stored committee override is ignored, not trusted", () => {
    for (const bad of [-1, 2.5, 366, "abc", null, {}, NaN]) {
      expect(resolveAgendaNotice(bad, 10)).toEqual({ days: 10, source: "tenant" });
      expect(resolveAgendaNotice(bad, undefined)).toEqual({ days: 7, source: "default" });
    }
  });

  it("parseAgendaNoticeDays accepts whole days 0..365 only", () => {
    expect([0, 7, 365, "7", " 12 ", { value: 3 }].map(parseAgendaNoticeDays)).toEqual([0, 7, 365, 7, 12, 3]);
    expect([-1, 366, 1.5, "x", "", null, undefined, true].map(parseAgendaNoticeDays)).toEqual([undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined]);
  });

  it("committee keys round-trip", () => {
    expect(committeeAgendaNoticeKey(C1)).toBe(`${AGENDA_NOTICE_KEY}.${C1}`);
    expect(committeeIdFromAgendaNoticeKey(committeeAgendaNoticeKey(C1))).toBe(C1);
    expect(committeeIdFromAgendaNoticeKey(AGENDA_NOTICE_KEY)).toBeNull();
    expect(committeeIdFromAgendaNoticeKey(`${AGENDA_NOTICE_KEY}.not-a-uuid`)).toBeNull();
    expect(committeeIdFromAgendaNoticeKey(`other.key.${C1}`)).toBeNull();
  });
});

describe("setConfigBody validates the notice period on write", () => {
  const tenant = (value: unknown) => ({ namespace: "meeting_policy", configKey: AGENDA_NOTICE_KEY, value });
  const committee = (value: unknown, configKey = committeeAgendaNoticeKey(C1)) => ({ namespace: COMMITTEE_POLICY_NS, configKey, value });

  it("accepts valid values at both levels", () => {
    for (const v of [0, 3, 7, 30, 365, "10", { value: 6 }]) {
      expect(setConfigBody.safeParse(tenant(v)).success).toBe(true);
      expect(setConfigBody.safeParse(committee(v)).success).toBe(true);
    }
  });

  it("refuses negative, fractional, too-large and non-numeric values", () => {
    for (const v of [-1, 1.5, 366, "abc", null, true]) {
      expect(setConfigBody.safeParse(tenant(v)).success).toBe(false);
      expect(setConfigBody.safeParse(committee(v)).success).toBe(false);
    }
  });

  it("a committee-namespace key must be agenda.submission_deadline_days.<committeeId>", () => {
    expect(setConfigBody.safeParse(committee(7, "agenda.submission_deadline_days")).success).toBe(false);
    expect(setConfigBody.safeParse(committee(7, "something.else")).success).toBe(false);
  });

  it("other policy keys and namespaces are not affected by this validation", () => {
    expect(setConfigBody.safeParse({ namespace: "meeting_policy", configKey: "minutes.submission_deadline_days", value: 21 }).success).toBe(true);
    expect(setConfigBody.safeParse({ namespace: "meeting_policy", configKey: "meeting.tenant_timezone", value: "+05:30" }).success).toBe(true);
  });
});

// ─────────────────────────────── real DB ───────────────────────────────────────────

const SECRET = process.env.JWT_SECRET as string;
const TENANT = randomUUID();
const ACTOR = randomUUID();
const COMMITTEE_A = randomUUID();
const COMMITTEE_B = randomUUID();
const OTHER_TENANT_COMMITTEE = randomUUID();
const OTHER_TENANT = randomUUID();
const bearer = (roles: string[]) => ({ authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles, sid: "s-gf" }, SECRET, 3600)}` });

const handlers = new Map<string, (msg: CommandEnvelope<any>) => Promise<void>>();
registerAgendaConsumers((t, h) => handlers.set(t, h as any));
registerConfigRegistryConsumers((t, h) => handlers.set(t, h as any));
const published: CommandEnvelope<any>[] = [];
let app: FastifyInstance;
const deliverAll = async () => { for (const m of published.splice(0)) await runWithTenant(TENANT, () => handlers.get(m.type)!(m)); };
function tenantQuery<T>(fn: (sql: typeof sqlClient) => Promise<T>): Promise<T> {
  return runWithTenant(TENANT, () => sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    return fn(sql as unknown as typeof sqlClient);
  })) as Promise<T>;
}
const setCfg = async (namespace: string, configKey: string, value: unknown, roles = ["tenant_admin"]) => {
  const res = await app.inject({ method: "POST", url: "/v1/meetings/config", headers: bearer(roles), payload: { namespace, configKey, value } });
  if (res.statusCode === 202) await deliverAll();
  return res;
};

/** A scheduled meeting `days` days from now (agenda still open) for a committee. */
async function meetingIn(committeeId: string, days: number): Promise<string> {
  const id = randomUUID();
  await tenantQuery((sql) => sql`
    insert into meeting.meetings (id, tenant_id, type, title, status, committee_id, scheduled_at, chairperson_id, created_by, updated_by)
    values (${id}, ${TENANT}, 'committee', 'Agenda notice probe', 'scheduled', ${committeeId},
      ${new Date(Date.now() + days * 86_400_000).toISOString()}, ${ACTOR}, ${ACTOR}, ${ACTOR})`);
  return id;
}
async function submitItem(meetingId: string): Promise<{ ok: boolean; code?: string }> {
  const m = {
    messageId: randomUUID(), type: COMMANDS.agendaItemSubmit, tenantId: TENANT, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0",
    payload: { agendaItemId: randomUUID(), meetingId, tenantId: TENANT, title: "Ward 14 drainage", outcomeType: "decision" },
  } as CommandEnvelope<any>;
  try {
    await runWithTenant(TENANT, () => handlers.get(m.type)!(m));
    return { ok: true };
  } catch (e) {
    return { ok: false, code: (e as { code?: string }).code };
  }
}

beforeAll(async () => {
  (queue as unknown as { publish: unknown }).publish = async (_t: string, msg: CommandEnvelope<any>) => { published.push(msg); };
  app = await buildApp();
  await app.ready();
  await tenantQuery(async (sql) => {
    for (const [id, code] of [[COMMITTEE_A, "AA"], [COMMITTEE_B, "BB"]] as const) {
      await sql`
        insert into meeting.committees (id, tenant_id, name, code, type, constitution_date, quorum_rule, created_by, updated_by)
        values (${id}, ${TENANT}, ${code + " committee"}, ${code}, 'standing', '2024-01-01', ${sql.json({ minMembers: 1, vcCountsForQuorum: true })}, ${ACTOR}, ${ACTOR})`;
    }
  });
  const other = OTHER_TENANT;
  await runWithTenant(other, () => sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${other}, true)`;
    await sql`insert into meeting.committees (id, tenant_id, name, code, type, constitution_date, quorum_rule, created_by, updated_by)
      values (${OTHER_TENANT_COMMITTEE}, ${other}, 'Other tenant committee', 'OT', 'standing', '2024-01-01', ${sql.json({ minMembers: 1, vcCountsForQuorum: true })}, ${ACTOR}, ${ACTOR})`;
  }));
});

afterAll(async () => {
  await tenantQuery(async (sql) => {
    for (const t of ["agenda_items", "meetings", "committees", "config_entries"]) {
      await sql.unsafe(`delete from meeting.${t} where tenant_id = '${TENANT}'`);
    }
    await sql`delete from _outbox.messages where tenant_id = ${TENANT}`;
  }).catch(() => undefined);
  await runWithTenant(OTHER_TENANT, () => sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${OTHER_TENANT}, true)`;
    await sql`delete from meeting.committees where tenant_id = ${OTHER_TENANT}`;
  })).catch(() => undefined);
  await app.close();
  await sqlClient.end();
});

describe("agenda submission: committee override -> tenant -> 7", () => {
  it("DEFAULT UNCHANGED: with nothing configured a proposal 5 days out is refused and one 9 days out is accepted", async () => {
    expect(await submitItem(await meetingIn(COMMITTEE_A, 5))).toEqual({ ok: false, code: "MEETING_PAST_DEADLINE" });
    expect(await submitItem(await meetingIn(COMMITTEE_A, 9))).toEqual({ ok: true });
    const eff = await app.inject({ method: "GET", url: `/v1/meetings/committees/${COMMITTEE_A}/agenda-notice`, headers: bearer(["tenant_admin"]) });
    expect(eff.json().data).toEqual({ committeeId: COMMITTEE_A, submissionDeadlineDays: 7, source: "default" });
  });

  it("the tenant setting (3 days) lets a 5-days-out proposal through, for every committee", async () => {
    expect((await setCfg("meeting_policy", AGENDA_NOTICE_KEY, 3)).statusCode).toBe(202);
    expect(await submitItem(await meetingIn(COMMITTEE_A, 5))).toEqual({ ok: true });
    expect(await submitItem(await meetingIn(COMMITTEE_B, 5))).toEqual({ ok: true });
    expect(await submitItem(await meetingIn(COMMITTEE_B, 2))).toEqual({ ok: false, code: "MEETING_PAST_DEADLINE" });
  });

  it("a committee override (14 days) applies to that committee only; the other keeps the tenant setting", async () => {
    expect((await setCfg(COMMITTEE_POLICY_NS, committeeAgendaNoticeKey(COMMITTEE_A), 14)).statusCode).toBe(202);
    expect(await submitItem(await meetingIn(COMMITTEE_A, 10))).toEqual({ ok: false, code: "MEETING_PAST_DEADLINE" });
    expect(await submitItem(await meetingIn(COMMITTEE_A, 20))).toEqual({ ok: true });
    expect(await submitItem(await meetingIn(COMMITTEE_B, 5))).toEqual({ ok: true }); // still the tenant's 3 days
    const a = await app.inject({ method: "GET", url: `/v1/meetings/committees/${COMMITTEE_A}/agenda-notice`, headers: bearer(["meeting_admin"]) });
    const b = await app.inject({ method: "GET", url: `/v1/meetings/committees/${COMMITTEE_B}/agenda-notice`, headers: bearer(["meeting_admin"]) });
    expect(a.json().data).toMatchObject({ submissionDeadlineDays: 14, source: "committee" });
    expect(b.json().data).toMatchObject({ submissionDeadlineDays: 3, source: "tenant" });
  });

  it("a committee can also be SHORTER than the tenant (0 = open until the meeting starts)", async () => {
    expect((await setCfg(COMMITTEE_POLICY_NS, committeeAgendaNoticeKey(COMMITTEE_B), 0)).statusCode).toBe(202);
    expect(await submitItem(await meetingIn(COMMITTEE_B, 1))).toEqual({ ok: true });
  });

  it("removing the override (deactivate) falls back to the tenant setting", async () => {
    const list = await app.inject({ method: "GET", url: `/v1/meetings/config/${COMMITTEE_POLICY_NS}`, headers: bearer(["tenant_admin"]) });
    const entry = (list.json().items as Array<{ id: string; configKey: string; version: number }>).find((i) => i.configKey === committeeAgendaNoticeKey(COMMITTEE_A))!;
    const res = await app.inject({ method: "PATCH", url: `/v1/meetings/config/${entry.id}/deactivate`, headers: bearer(["tenant_admin"]), payload: { expectedVersion: entry.version } });
    expect(res.statusCode).toBe(202);
    await deliverAll();
    expect(await submitItem(await meetingIn(COMMITTEE_A, 10))).toEqual({ ok: true }); // back to the tenant's 3
    const eff = await app.inject({ method: "GET", url: `/v1/meetings/committees/${COMMITTEE_A}/agenda-notice`, headers: bearer(["tenant_admin"]) });
    expect(eff.json().data).toMatchObject({ submissionDeadlineDays: 3, source: "tenant" });
  });
});

describe("config API guards", () => {
  it("refuses an invalid value (400) and publishes nothing", async () => {
    for (const v of [-2, 3.5, 1000, "soon"]) {
      expect((await setCfg("meeting_policy", AGENDA_NOTICE_KEY, v)).statusCode).toBe(400);
      expect((await setCfg(COMMITTEE_POLICY_NS, committeeAgendaNoticeKey(COMMITTEE_A), v)).statusCode).toBe(400);
    }
    expect(published).toHaveLength(0);
  });

  it("404s an override for a committee that does not exist or belongs to another tenant", async () => {
    expect((await setCfg(COMMITTEE_POLICY_NS, committeeAgendaNoticeKey(randomUUID()), 5)).statusCode).toBe(404);
    expect((await setCfg(COMMITTEE_POLICY_NS, committeeAgendaNoticeKey(OTHER_TENANT_COMMITTEE), 5)).statusCode).toBe(404);
    expect(published).toHaveLength(0);
  });

  it("only tenant/super admins write it (meeting_admin, secretary and chairperson are refused); meeting_admin may read it", async () => {
    for (const roles of [["meeting_admin"], ["committee_secretary"], ["committee_chairperson"], ["committee_member"]]) {
      expect((await setCfg(COMMITTEE_POLICY_NS, committeeAgendaNoticeKey(COMMITTEE_A), 5, roles)).statusCode).toBe(403);
    }
    expect((await app.inject({ method: "GET", url: `/v1/meetings/committees/${COMMITTEE_A}/agenda-notice`, headers: bearer(["committee_member"]) })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: `/v1/meetings/committees/${randomUUID()}/agenda-notice`, headers: bearer(["tenant_admin"]) })).statusCode).toBe(404);
    expect(published).toHaveLength(0);
  });

  it("statutory notice of a MEETING is untouched: meeting.notice_period_days still defaults to 0 and is a separate key", () => {
    expect(POLICY_DEFAULTS["meeting.notice_period_days"]).toBe(0);
    expect(AGENDA_NOTICE_KEY).not.toBe("meeting.notice_period_days");
  });
});
