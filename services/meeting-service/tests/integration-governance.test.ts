/**
 * Integration test — governance completeness LIVE proofs (Gap 1 recusal, Gap 2 weighted voting,
 * Gap 4 config-driven default threshold).
 *
 * Mirrors integration-voting.test.ts: app.inject() for the route boundary + direct consumer
 * invocation via runWithTenant for write-side effects, against the real civitas_meeting DB.
 *
 * Proves:
 *   1. A recused member's ballot is REJECTED and the member is EXCLUDED from the tally; the recusal
 *      is recorded and the item-quorum denominator shrinks by the recused roster member.
 *   2. A weighted tally FLIPS the result versus headcount (a heavy "against" defeats two "for").
 *   3. When the initiator omits the majority rule, the tenant's configured `voting.default_threshold`
 *      is applied.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import type { CommandEnvelope } from "@civitasone/queue";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { COMMANDS } from "../src/topics.js";
import { registerVotingConsumers } from "../src/modules/voting/consumer.js";

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT = "e9e9e9e9-9999-4000-8000-0000000000e9";
const COMMITTEE = "e8e8e8e8-9999-4000-8000-0000000000e8";
const MEETING = "e7e7e7e7-9999-4000-8000-0000000000e7";
const ACTOR = "e6e6e6e6-9999-4000-8000-0000000000e6";
const MEMBER_A = "e5e5e5e5-9999-4000-8000-000000000001";
const MEMBER_B = "e5e5e5e5-9999-4000-8000-000000000002";
const MEMBER_C = "e5e5e5e5-9999-4000-8000-000000000003";
const MEMBER_D = "e5e5e5e5-9999-4000-8000-000000000004";

const handlers = new Map<string, (msg: CommandEnvelope<any>) => Promise<void>>();
registerVotingConsumers((topic, h) => handlers.set(topic, h as any));

function token(roles: string[] = ["super_admin"]): string {
  return signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-integ-gov" }, SECRET, 3600);
}
function writeHeaders(roles?: string[]) {
  return { authorization: `Bearer ${token(roles)}`, "x-idempotency-key": `idem-${randomUUID()}` };
}
function readHeaders(roles?: string[]) {
  return { authorization: `Bearer ${token(roles)}` };
}
function msg<T>(type: string, payload: T, messageId = randomUUID()): CommandEnvelope<T> {
  return { messageId, type, tenantId: TENANT, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0", payload } as CommandEnvelope<T>;
}
/** Like `msg`, but with an explicit `actorId` — voteRecuse now requires the caller to be the
 * recused member themselves (self-recusal) or that committee's own chairperson/secretary. */
function msgAs<T>(type: string, payload: T, actorId: string): CommandEnvelope<T> {
  return { messageId: randomUUID(), type, tenantId: TENANT, actorId, correlationId: randomUUID(), schemaVersion: "1.0", payload } as CommandEnvelope<T>;
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

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`delete from meeting.recusals where tenant_id = ${TENANT}`;
    await sql`delete from meeting.votes where tenant_id = ${TENANT}`;
    await sql`delete from meeting.resolutions where tenant_id = ${TENANT}`;
    await sql`delete from meeting.attendance_records where tenant_id = ${TENANT}`;
    await sql`delete from meeting.participants where tenant_id = ${TENANT}`;
    await sql`delete from meeting.committee_members where tenant_id = ${TENANT}`;
    await sql`delete from meeting.meetings where tenant_id = ${TENANT}`;
    await sql`delete from meeting.committees where tenant_id = ${TENANT}`;
    await sql`delete from meeting.config_entries where tenant_id = ${TENANT}`;
    await sql`delete from _outbox.messages where tenant_id = ${TENANT}`;

    // Committee: quorum minMembers 3, vc counts. 4 members. MEMBER_C carries vote weight 5.
    await sql`
      insert into meeting.committees
        (id, tenant_id, name, code, type, constitution_date, quorum_rule, created_by, updated_by)
      values (${COMMITTEE}, ${TENANT}, 'Governance Board', 'GB', 'board', '2025-01-01',
        ${sql.json({ minMembers: 3, vcCountsForQuorum: true })}, ${ACTOR}, ${ACTOR})`;
    for (const [m, w] of [[MEMBER_A, 1], [MEMBER_B, 1], [MEMBER_C, 5], [MEMBER_D, 1]] as [string, number][]) {
      await sql`
        insert into meeting.committee_members
          (id, tenant_id, committee_id, member_id, role, appointment_date, status, vote_weight, created_by, updated_by)
        values (${randomUUID()}, ${TENANT}, ${COMMITTEE}, ${m}, 'member', '2025-01-01', 'active', ${w}, ${ACTOR}, ${ACTOR})`;
    }
    await sql`
      insert into meeting.meetings
        (id, tenant_id, type, title, status, committee_id, financial_year, scheduled_at, quorum_established, created_by, updated_by)
      values (${MEETING}, ${TENANT}, 'board', 'GB Q1', 'in_progress', ${COMMITTEE}, '2025-26',
        '2025-06-15T10:00:00Z', true, ${ACTOR}, ${ACTOR})`;
    for (const m of [MEMBER_A, MEMBER_B, MEMBER_C, MEMBER_D]) {
      const pid = randomUUID();
      await sql`
        insert into meeting.participants
          (id, tenant_id, meeting_id, employee_id, role, invitation_status, created_by, updated_by)
        values (${pid}, ${TENANT}, ${MEETING}, ${m}, 'member', 'accepted', ${ACTOR}, ${ACTOR})`;
      await sql`
        insert into meeting.attendance_records
          (id, tenant_id, meeting_id, participant_id, method, check_in_at, mode, status, created_by, updated_by)
        values (${randomUUID()}, ${TENANT}, ${MEETING}, ${pid}, 'manual', now(), 'in_person', 'present', ${ACTOR}, ${ACTOR})`;
    }
  });
});

afterAll(async () => {
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`delete from meeting.recusals where tenant_id = ${TENANT}`;
    await sql`delete from meeting.votes where tenant_id = ${TENANT}`;
    await sql`delete from meeting.resolutions where tenant_id = ${TENANT}`;
    await sql`delete from meeting.attendance_records where tenant_id = ${TENANT}`;
    await sql`delete from meeting.participants where tenant_id = ${TENANT}`;
    await sql`delete from meeting.committee_members where tenant_id = ${TENANT}`;
    await sql`delete from meeting.meetings where tenant_id = ${TENANT}`;
    await sql`delete from meeting.committees where tenant_id = ${TENANT}`;
    await sql`delete from meeting.config_entries where tenant_id = ${TENANT}`;
    await sql`delete from _outbox.messages where tenant_id = ${TENANT}`;
  });
  await app.close();
  await sqlClient.end();
});

// ─── Gap 1: recusal ─────────────────────────────────────────────────────────────
describe("recusal / conflict-of-interest (Gap 1)", () => {
  const rid = randomUUID();

  it("initiate + record a recusal for MEMBER_A on the motion", async () => {
    await run(msg(COMMANDS.voteInitiate, {
      resolutionId: rid, meetingId: MEETING, tenantId: TENANT,
      resolutionText: "Award the maintenance contract", voteType: "roll_call", majorityRule: "simple_majority",
    }));
    // Route: MEMBER_A recuses (returns 202)
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING}/votes/${rid}/recuse`,
      headers: writeHeaders(),
      payload: { memberId: MEMBER_A, reason: "director of the bidding firm", registerRef: "ROI-2026-014" },
    });
    expect(res.statusCode).toBe(202);
    // Self-recusal: MEMBER_A declares their own conflict of interest (the caller must be the
    // recused member themselves, or that committee's chairperson/secretary — Gap 3 fix).
    await run(msgAs(COMMANDS.voteRecuse, {
      meetingId: MEETING, resolutionId: rid, memberId: MEMBER_A,
      reason: "director of the bidding firm", registerRef: "ROI-2026-014", tenantId: TENANT,
    }, MEMBER_A));
    const recusalRows = await tenantQuery((sql) => sql`select * from meeting.recusals where resolution_id = ${rid}`);
    expect(recusalRows.length).toBe(1);
    expect(recusalRows[0].member_id).toBe(MEMBER_A);
  });

  it("REJECTS the recused member's ballot and keeps them out of the tally", async () => {
    // MEMBER_A (recused) attempts to vote → consumer rejects (NonRetryable).
    await expect(
      run(msg(COMMANDS.voteCast, { meetingId: MEETING, resolutionId: rid, memberId: MEMBER_A, position: "for", tenantId: TENANT })),
    ).rejects.toThrow(/recused/i);

    // The other three vote normally.
    await run(msg(COMMANDS.voteCast, { meetingId: MEETING, resolutionId: rid, memberId: MEMBER_B, position: "for", tenantId: TENANT }));
    await run(msg(COMMANDS.voteCast, { meetingId: MEETING, resolutionId: rid, memberId: MEMBER_C, position: "for", tenantId: TENANT }));
    await run(msg(COMMANDS.voteCast, { meetingId: MEETING, resolutionId: rid, memberId: MEMBER_D, position: "against", tenantId: TENANT }));

    // Only 3 ballots recorded — MEMBER_A excluded from the tally.
    expect(await voteCount(rid)).toBe(3);
    const voters = await tenantQuery((sql) => sql`select member_id from meeting.votes where resolution_id = ${rid}`);
    expect(voters.map((v: any) => v.member_id)).not.toContain(MEMBER_A);
  });

  it("results view records the recusal and shrinks the item-quorum denominator", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/meetings/${MEETING}/votes/${rid}/results`,
      headers: readHeaders(),
    });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.recusedMemberIds).toContain(MEMBER_A);
    // Roster 4, one recused → effective denominator 3, and the shrunk denominator is surfaced.
    expect(data.itemQuorum.activeRoster).toBe(4);
    expect(data.itemQuorum.recusedCount).toBe(1);
    expect(data.itemQuorum.effectiveDenominator).toBe(3);
  });
});

// ─── Gap 4: config-driven default threshold ─────────────────────────────────────
describe("config-driven default threshold (Gap 4)", () => {
  it("applies the tenant's configured voting.default_threshold when none is specified", async () => {
    await tenantQuery((sql) => sql`
      insert into meeting.config_entries (id, tenant_id, namespace, config_key, value, created_by, updated_by)
      values (${randomUUID()}, ${TENANT}, 'meeting_policy', 'voting.default_threshold', ${sql.json("two_thirds")}, ${ACTOR}, ${ACTOR})`);
    const rid = randomUUID();
    // majorityRule intentionally omitted from the payload.
    await run(msg(COMMANDS.voteInitiate, {
      resolutionId: rid, meetingId: MEETING, tenantId: TENANT,
      resolutionText: "Amend the terms of reference", voteType: "roll_call",
    } as any));
    const row = await readResolution(rid);
    expect(row.majority_rule).toBe("two_thirds");
  });
});

// ─── Gap 2: weighted voting flips the result ────────────────────────────────────
describe("weighted voting flips the result vs headcount (Gap 2)", () => {
  it("enables weighting, then a heavy 'against' defeats two 'for' that would pass by headcount", async () => {
    await tenantQuery((sql) => sql`
      insert into meeting.config_entries (id, tenant_id, namespace, config_key, value, created_by, updated_by)
      values (${randomUUID()}, ${TENANT}, 'meeting_policy', 'voting.weighted_enabled', ${sql.json(true)}, ${ACTOR}, ${ACTOR})`);

    const rid = randomUUID();
    await run(msg(COMMANDS.voteInitiate, {
      resolutionId: rid, meetingId: MEETING, tenantId: TENANT,
      resolutionText: "Approve the related-party transaction", voteType: "roll_call", majorityRule: "simple_majority",
    }));
    // A (w1) for, B (w1) for, C (w5) against. Headcount: 2 for / 1 against → would PASS.
    await run(msg(COMMANDS.voteCast, { meetingId: MEETING, resolutionId: rid, memberId: MEMBER_A, position: "for", tenantId: TENANT }));
    await run(msg(COMMANDS.voteCast, { meetingId: MEETING, resolutionId: rid, memberId: MEMBER_B, position: "for", tenantId: TENANT }));
    await run(msg(COMMANDS.voteCast, { meetingId: MEETING, resolutionId: rid, memberId: MEMBER_C, position: "against", tenantId: TENANT }));

    await run(msg(COMMANDS.voteConclude, { meetingId: MEETING, resolutionId: rid, tenantId: TENANT }));

    const row = await readResolution(rid);
    // Headcount is preserved (2 for / 1 against) but the WEIGHTED result rejects (2 vs 5).
    expect(row.votes_for).toBe(2);
    expect(row.votes_against).toBe(1);
    expect(row.weight_for).toBe(2);
    expect(row.weight_against).toBe(5);
    expect(row.result).toBe("rejected");
    expect(row.status).toBe("rejected");
  });
});
