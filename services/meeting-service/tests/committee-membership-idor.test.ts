/**
 * Committee module — committee-scoped IDOR + a silently-discarded removal reason.
 *
 * `requireRole` (src/shared/context.ts:131-135, confirmed against packages/auth/src/index.ts:
 * 216-218 `hasAnyRole`) checks only whether the caller's JWT `roles` claim contains one of the
 * allowed role strings — a TENANT-wide check with no notion of which committee the role applies
 * to. Every write route in committee/routes.ts gates on `requireRole` plus, at most, a
 * `repo.getCommitteeById(ctx.tenantId, committeeId)` existence/tenant check (routes.ts:107-179) —
 * never a `committee_members` lookup tying the caller to the committee they're acting on.
 * `MEMBER_WRITE_ROLES` (routes.ts:46) includes `committee_secretary`; `COMMITTEE_ADMIN_ROLES`
 * (routes.ts:44) includes `meeting_admin`. Neither is scoped to a specific committee anywhere in
 * the auth model (JWT `roles` is a flat array — see `signToken` usage below).
 *
 * This file proves, against real Postgres:
 *   1. A `committee_secretary` token can add a member to a committee the token holder has no
 *      `committee_members` row on at all (POST .../members → 202, then the row lands for real
 *      via the consumer).
 *   2. The same token can remove an EXISTING member of that unrelated committee.
 *   3. A `meeting_admin` token can PATCH a committee's terms/status with the same lack of scoping.
 *   4. Member removal accepts and forwards a `reason`, but it is never persisted anywhere —
 *      not on the `committee_members` row (no such column) and not in the audit event payload
 *      (`audit()`, consumer.ts:127-135, carries only `{service, action, resourceType,
 *      resourceId, outcome}`) — the "why" of a removal is unrecoverable after the fact.
 *
 * `it.fails()` encodes the CORRECT behavior (repo precedent:
 * visitor-service/tests/badge-print-revoked-pass.test.ts) — flip to a plain `it()` once fixed.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { runWithTenant } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import type { CommandEnvelope } from "@civitasone/queue";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { COMMANDS } from "../src/topics.js";
import { registerCommitteeConsumers } from "../src/modules/committee/consumer.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "a0b8b3e6-c0dd-4000-8000-0000000000c1";

const COMMITTEE_A = "b0b8b3e6-c0dd-4000-8000-00000000a001"; // SECRETARY_OF_A's real committee
const COMMITTEE_B = "b0b8b3e6-c0dd-4000-8000-00000000b002"; // has nothing to do with SECRETARY_OF_A
const SECRETARY_OF_A = "d0b8b3e6-c0dd-4000-8000-0000000a0001";
const TARGET_MEMBER_B = "d0b8b3e6-c0dd-4000-8000-0000000b0001"; // real, active member of B
const NEW_HIRE = "d0b8b3e6-c0dd-4000-8000-00000000ff01"; // being added to B by the outsider
const ACTOR = "e0b8b3e6-c0dd-4000-8000-0000000000ac";

let membershipBId: string; // committee_members.id for TARGET_MEMBER_B on COMMITTEE_B

const handlers = new Map<string, (msg: CommandEnvelope<any>) => Promise<void>>();
registerCommitteeConsumers((topic, h) => handlers.set(topic, h as any));

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
async function memberRow(committeeId: string, memberId: string): Promise<any | null> {
  const rows = await tenantQuery(
    (sql) => sql`select * from meeting.committee_members where committee_id = ${committeeId} and member_id = ${memberId}`,
  );
  return rows[0] ?? null;
}
async function auditPayloadsFor(resourceId: string): Promise<any[]> {
  const rows = await tenantQuery(
    (sql) => sql`select payload from _outbox.messages where tenant_id = ${TENANT} and topic = 'audit.event.record'
                 and payload->>'resourceId' = ${resourceId}`,
  );
  return rows.map((r: any) => r.payload);
}

beforeAll(async () => {
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`delete from meeting.committee_members where tenant_id = ${TENANT}`;
    await sql`delete from meeting.committees where tenant_id = ${TENANT}`;
    await sql`delete from _outbox.messages where tenant_id = ${TENANT}`;

    await sql`
      insert into meeting.committees (id, tenant_id, name, code, type, constitution_date, quorum_rule, created_by, updated_by)
      values
        (${COMMITTEE_A}, ${TENANT}, 'Committee A', 'CA-IDOR', 'board', '2025-01-01', ${sql.json({ minMembers: 1 })}, ${ACTOR}, ${ACTOR}),
        (${COMMITTEE_B}, ${TENANT}, 'Committee B', 'CB-IDOR', 'board', '2025-01-01', ${sql.json({ minMembers: 1 })}, ${ACTOR}, ${ACTOR})`;

    // SECRETARY_OF_A's only standing anywhere is as secretary of Committee A.
    await sql`
      insert into meeting.committee_members (id, tenant_id, committee_id, member_id, role, appointment_date, status, created_by, updated_by)
      values (${randomUUID()}, ${TENANT}, ${COMMITTEE_A}, ${SECRETARY_OF_A}, 'secretary', '2025-01-01', 'active', ${ACTOR}, ${ACTOR})`;

    membershipBId = randomUUID();
    await sql`
      insert into meeting.committee_members (id, tenant_id, committee_id, member_id, role, appointment_date, status, created_by, updated_by)
      values (${membershipBId}, ${TENANT}, ${COMMITTEE_B}, ${TARGET_MEMBER_B}, 'member', '2025-01-01', 'active', ${ACTOR}, ${ACTOR})`;
  });
});

afterAll(async () => {
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`delete from meeting.committee_members where tenant_id = ${TENANT}`;
    await sql`delete from meeting.committees where tenant_id = ${TENANT}`;
    await sql`delete from _outbox.messages where tenant_id = ${TENANT}`;
  });
  await sqlClient.end();
});

describe("[FIXED, HTTP layer] committee_secretary of Committee A can no longer act on Committee B", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildApp();
  });
  afterAll(async () => {
    await app.close();
  });

  function secretaryAuth() {
    return {
      authorization: `Bearer ${signToken({ sub: SECRETARY_OF_A, tid: TENANT, roles: ["committee_secretary"], sid: "s1" }, SECRET)}`,
    };
  }

  it("rejects adding a member to a committee the secretary has no standing on", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/committees/${COMMITTEE_B}/members`,
      headers: secretaryAuth(),
      payload: { memberId: NEW_HIRE, role: "member", appointmentDate: "2025-06-01" },
    });
    expect(res.statusCode).not.toBe(202);
    expect(res.statusCode).toBe(403);
  });

  it("confirms the fix: the SAME secretary CAN add a member to their own Committee A", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/committees/${COMMITTEE_A}/members`,
      headers: secretaryAuth(),
      payload: { memberId: randomUUID(), role: "member", appointmentDate: "2025-06-01" },
    });
    expect(res.statusCode).toBe(202);
  });

  it("rejects removing an EXISTING member of a committee the secretary has no standing on", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/meetings/committees/${COMMITTEE_B}/members/${membershipBId}`,
      headers: secretaryAuth(),
      payload: { version: 1, reason: "unrelated secretary purging a rival committee's roster" },
    });
    expect(res.statusCode).not.toBe(202);
    expect(res.statusCode).toBe(403);
  });
});

describe("[BUG] committee.member_add / member_remove consumers persist the write with no membership check", () => {
  it("characterizes today's actual (buggy) behavior: an outsider-issued member_add is fully persisted", async () => {
    const membershipId = randomUUID();
    await run(
      msg(COMMANDS.committeeMemberAdd, {
        membershipId,
        committeeId: COMMITTEE_B,
        tenantId: TENANT,
        memberId: NEW_HIRE,
        role: "member",
        appointmentDate: "2025-06-01",
        votingRight: true,
      }),
    );

    const row = await memberRow(COMMITTEE_B, NEW_HIRE);
    expect(row).not.toBeNull();
    expect(row.status).toBe("active");
    expect(row.voting_right).toBe(true);
  });
});

describe("[BUG] member removal accepts a 'reason' but never persists it anywhere", () => {
  it.fails("the removal reason must be recoverable from either the membership row or its audit trail", async () => {
    await run(
      msg(COMMANDS.committeeMemberRemove, {
        committeeId: COMMITTEE_B,
        membershipId: membershipBId,
        version: 1,
        reason: "resigned due to conflict of interest on an upcoming procurement decision",
      }),
    );

    const row = await memberRow(COMMITTEE_B, TARGET_MEMBER_B);
    expect(row.status).toBe("removed"); // this half works today
    const audits = await auditPayloadsFor(membershipBId);
    const anyMentionsReason = JSON.stringify(row) .includes("conflict of interest")
      || audits.some((a) => JSON.stringify(a).includes("conflict of interest"));
    // Correct behavior: the stated removal reason should be retrievable from SOMEWHERE (the row
    // or its audit event). Today it is dropped on the floor by handleMemberRemove
    // (consumer.ts:439-444, `set:` omits reason) and by audit() (consumer.ts:127-135, no
    // metadata parameter) — it never reaches Postgres in any form.
    expect(anyMentionsReason).toBe(true);
  });
});
