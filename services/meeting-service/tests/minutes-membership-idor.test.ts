/**
 * Minutes module — committee-membership / ownership IDOR.
 *
 * `minutes/routes.ts`'s submit/approve/reject/sign/circulate previously gated on a flat
 * CHAIR_ROLES/SECRETARY_ROLES claim only -- no comparison to the SPECIFIC meeting's own
 * chairperson/secretary or committee roster (the same class of gap fix 6 closed in
 * committee/decision/voting routes.ts, and meeting-core/routes.ts's own writes). Any
 * `committee_chairperson`/`committee_secretary` anywhere in the tenant could approve, reject,
 * DSC-sign, submit, or circulate the minutes of a meeting they never served.
 *
 * This file proves, against real Postgres and through the HTTP boundary (`buildApp().inject`),
 * that the standing gate (`assertMeetingOwnership`, mirroring meeting-core's) is now applied --
 * mirroring tests/decision-membership-idor.test.ts / tests/voting-membership-idor.test.ts /
 * tests/committee-membership-idor.test.ts exactly:
 *   1. A flat `committee_secretary`/`committee_chairperson` with NO committee_members row on
 *      the target meeting's own committee is rejected (403) on all 5 protected actions.
 *   2. A genuine officer of that SAME committee (an ACTIVE roster row, standing only -- the
 *      meeting row's own chairperson_id/secretary_id columns are deliberately left NULL below,
 *      so passing proves the hasCommitteeStanding branch specifically, not just the cheaper
 *      isDirectMeetingOwner short-circuit) still succeeds (202) on all 5.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "a0b8b3e6-dec0-4000-8000-00000000de02";

// Two DISTINCT committees in the same tenant — the whole point of an IDOR test.
const COMMITTEE_A = randomUUID();
const COMMITTEE_B = randomUUID();
const MEETING_B = randomUUID(); // owned by COMMITTEE_B; chairperson_id/secretary_id left NULL

// Officers who serve on A only (NO committee_members row on B whatsoever).
const SEC_OF_A = randomUUID();
const CHAIR_OF_A = randomUUID();
// Genuine officers on B (ACTIVE roster rows on B) — the legitimate control group. Note:
// neither is meetings.chairperson_id/secretary_id directly — standing comes ONLY from the
// committee roster, so a pass here specifically proves the hasCommitteeStanding code path.
const SEC_OF_B = randomUUID();
const CHAIR_OF_B = randomUUID();

const MINUTES_B = randomUUID();
const SEED_ACTOR = randomUUID();

function token(roles: string[], sub: string): string {
  return signToken({ sub, tid: TENANT, roles, sid: "sess-minutes-idor" }, SECRET);
}

let app: FastifyInstance;

beforeAll(async () => {
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`delete from meeting.minutes where tenant_id = ${TENANT}`;
    await sql`delete from meeting.committee_members where tenant_id = ${TENANT}`;
    await sql`delete from meeting.meetings where tenant_id = ${TENANT}`;
    await sql`delete from meeting.committees where tenant_id = ${TENANT}`;
    await sql`delete from _outbox.messages where tenant_id = ${TENANT}`;

    await sql`
      insert into meeting.committees (id, tenant_id, name, code, type, constitution_date, quorum_rule, created_by, updated_by)
      values
        (${COMMITTEE_A}, ${TENANT}, 'Committee A', 'MCA', 'board', '2025-01-01', ${sql.json({ minMembers: 1 })}, ${SEED_ACTOR}, ${SEED_ACTOR}),
        (${COMMITTEE_B}, ${TENANT}, 'Committee B', 'MCB', 'board', '2025-01-01', ${sql.json({ minMembers: 1 })}, ${SEED_ACTOR}, ${SEED_ACTOR})`;

    // A's officers hold NO row on Committee B. B's officers are the only ones with B standing.
    await sql`
      insert into meeting.committee_members (id, tenant_id, committee_id, member_id, role, appointment_date, status, created_by, updated_by)
      values
        (${randomUUID()}, ${TENANT}, ${COMMITTEE_A}, ${SEC_OF_A}, 'secretary', '2025-01-01', 'active', ${SEED_ACTOR}, ${SEED_ACTOR}),
        (${randomUUID()}, ${TENANT}, ${COMMITTEE_A}, ${CHAIR_OF_A}, 'chairperson', '2025-01-01', 'active', ${SEED_ACTOR}, ${SEED_ACTOR}),
        (${randomUUID()}, ${TENANT}, ${COMMITTEE_B}, ${SEC_OF_B}, 'secretary', '2025-01-01', 'active', ${SEED_ACTOR}, ${SEED_ACTOR}),
        (${randomUUID()}, ${TENANT}, ${COMMITTEE_B}, ${CHAIR_OF_B}, 'chairperson', '2025-01-01', 'active', ${SEED_ACTOR}, ${SEED_ACTOR})`;

    // chairperson_id/secretary_id deliberately NULL -- standing must come from the roster above.
    await sql`
      insert into meeting.meetings
        (id, tenant_id, type, title, status, committee_id, financial_year, scheduled_at, quorum_established, created_by, updated_by)
      values (${MEETING_B}, ${TENANT}, 'committee', 'Committee B meeting', 'minutes_pending', ${COMMITTEE_B},
              '2025-26', '2025-06-01T09:00:00Z', true, ${SEED_ACTOR}, ${SEED_ACTOR})`;

    await sql`
      insert into meeting.minutes (id, tenant_id, meeting_id, content, created_by, updated_by)
      values (${MINUTES_B}, ${TENANT}, ${MEETING_B}, 'Draft minutes of Committee B meeting', ${SEED_ACTOR}, ${SEED_ACTOR})`;
  });

  app = await buildApp();
});

afterAll(async () => {
  await app.close();
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`delete from meeting.minutes where tenant_id = ${TENANT}`;
    await sql`delete from meeting.committee_members where tenant_id = ${TENANT}`;
    await sql`delete from meeting.meetings where tenant_id = ${TENANT}`;
    await sql`delete from meeting.committees where tenant_id = ${TENANT}`;
    await sql`delete from _outbox.messages where tenant_id = ${TENANT}`;
  });
  await sqlClient.end();
});

const base = `/v1/meetings/${MEETING_B}/minutes/${MINUTES_B}`;

const secretaryActions: Array<{ name: string; url: string; payload: object }> = [
  { name: "submit", url: `${base}/submit`, payload: { version: 1 } },
  { name: "circulate", url: `${base}/circulate`, payload: {} },
];
const chairActions: Array<{ name: string; url: string; payload: object }> = [
  { name: "approve", url: `${base}/approve`, payload: { version: 1 } },
  { name: "reject", url: `${base}/reject`, payload: { version: 1, rejectionComments: "needs correction" } },
  { name: "sign", url: `${base}/sign`, payload: { version: 1 } },
];

describe("[FIXED] minutes secretariat actions (submit/circulate) now require committee standing", () => {
  for (const { name, url, payload } of secretaryActions) {
    it(`${name}: rejects a flat committee_secretary with ZERO committee_members rows on the target committee`, async () => {
      const res = await app.inject({
        method: "POST",
        url,
        headers: { authorization: `Bearer ${token(["committee_secretary"], SEC_OF_A)}` },
        payload,
      });
      // SEC_OF_A has the flat role (passes requireRole) but no roster row on COMMITTEE_B —
      // assertMeetingOwnership rejects with 403 before the command is ever published.
      expect(res.statusCode).not.toBe(202);
      expect(res.statusCode).toBe(403);
    });

    it(`${name}: confirms the fix — a GENUINE Committee B secretary (active roster row on B, not meetings.secretary_id) still succeeds (202)`, async () => {
      const res = await app.inject({
        method: "POST",
        url,
        headers: { authorization: `Bearer ${token(["committee_secretary"], SEC_OF_B)}` },
        payload,
      });
      expect(res.statusCode).toBe(202);
    });
  }
});

describe("[FIXED] minutes chairperson actions (approve/reject/sign) now require committee standing", () => {
  for (const { name, url, payload } of chairActions) {
    it(`${name}: rejects a flat committee_chairperson with ZERO committee_members rows on the target committee`, async () => {
      const res = await app.inject({
        method: "POST",
        url,
        headers: { authorization: `Bearer ${token(["committee_chairperson"], CHAIR_OF_A)}` },
        payload,
      });
      expect(res.statusCode).not.toBe(202);
      expect(res.statusCode).toBe(403);
    });

    it(`${name}: confirms the fix — a GENUINE Committee B chairperson (active roster row on B, not meetings.chairperson_id) still succeeds (202)`, async () => {
      const res = await app.inject({
        method: "POST",
        url,
        headers: { authorization: `Bearer ${token(["committee_chairperson"], CHAIR_OF_B)}` },
        payload,
      });
      expect(res.statusCode).toBe(202);
    });
  }
});
