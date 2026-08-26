/**
 * Decision module — committee-membership / authority IDOR (Gap 1 of the governance-chain review).
 *
 * Fix 6 added `requireCommitteeStanding` (an ACTIVE, officer-role `committee_members` row on the
 * SPECIFIC committee being acted on) to committee/routes.ts and voting/routes.ts — but never to
 * decision/routes.ts, the route family that owns the real resolution-recording and DSC-signing
 * endpoints. Its role arrays (`RECORD_ROLES`/`SIGN_ROLES`) are flat, tenant-wide role checks
 * including `committee_secretary`/`committee_chairperson`. So a user holding ONLY the flat
 * `committee_secretary` role and ZERO `committee_members` rows anywhere could record a fabricated
 * resolution for a committee they never served, and a flat `committee_chairperson` could then sign
 * it — exactly the governance-chain exploit this PR closes, via the one route family fix 6 missed.
 *
 * This file proves, against real Postgres and through the HTTP boundary (`buildApp().inject`), that
 * the standing gate is now applied to decision routes too — mirroring
 * tests/voting-membership-idor.test.ts / tests/committee-membership-idor.test.ts:
 *   1. A flat `committee_secretary` with no roster row on Committee B is rejected (403) by
 *      POST /v1/meetings/:meetingId/resolutions for a Committee B meeting.
 *   2. A flat `committee_chairperson` with no roster row on Committee B is rejected (403) by
 *      POST /v1/meetings/:meetingId/resolutions/:resolutionId/sign for a Committee B resolution.
 *   3. A genuine Committee B secretary / chairperson (an ACTIVE officer row on B) still succeeds
 *      (202) on both — proving the gate blocks only the IDOR, not legitimate committee officers.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "a0b8b3e6-dec0-4000-8000-00000000de01";

// Two DISTINCT committees in the same tenant — the whole point of an IDOR test.
const COMMITTEE_A = randomUUID();
const COMMITTEE_B = randomUUID();
const MEETING_B = randomUUID(); // owned by COMMITTEE_B

// Officers who serve on A only (NO committee_members row on B whatsoever).
const SEC_OF_A = randomUUID();
const CHAIR_OF_A = randomUUID();
// Genuine officers on B (ACTIVE roster rows on B) — the legitimate control group.
const SEC_OF_B = randomUUID();
const CHAIR_OF_B = randomUUID();

const RES_B = randomUUID(); // a resolution already recorded for MEETING_B (target of the sign route)
const SEED_ACTOR = randomUUID();

function token(roles: string[], sub: string): string {
  return signToken({ sub, tid: TENANT, roles, sid: "sess-decision-idor" }, SECRET);
}

let app: FastifyInstance;

beforeAll(async () => {
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`delete from meeting.resolutions where tenant_id = ${TENANT}`;
    await sql`delete from meeting.committee_members where tenant_id = ${TENANT}`;
    await sql`delete from meeting.committees where tenant_id = ${TENANT}`;
    await sql`delete from meeting.meetings where tenant_id = ${TENANT}`;
    await sql`delete from _outbox.messages where tenant_id = ${TENANT}`;

    await sql`
      insert into meeting.committees (id, tenant_id, name, code, type, constitution_date, quorum_rule, created_by, updated_by)
      values
        (${COMMITTEE_A}, ${TENANT}, 'Committee A', 'CA', 'board', '2025-01-01', ${sql.json({ minMembers: 1 })}, ${SEED_ACTOR}, ${SEED_ACTOR}),
        (${COMMITTEE_B}, ${TENANT}, 'Committee B', 'CB', 'board', '2025-01-01', ${sql.json({ minMembers: 1 })}, ${SEED_ACTOR}, ${SEED_ACTOR})`;

    // A's officers hold NO row on Committee B. B's officers are the only ones with B standing.
    await sql`
      insert into meeting.committee_members (id, tenant_id, committee_id, member_id, role, appointment_date, status, created_by, updated_by)
      values
        (${randomUUID()}, ${TENANT}, ${COMMITTEE_A}, ${SEC_OF_A}, 'secretary', '2025-01-01', 'active', ${SEED_ACTOR}, ${SEED_ACTOR}),
        (${randomUUID()}, ${TENANT}, ${COMMITTEE_A}, ${CHAIR_OF_A}, 'chairperson', '2025-01-01', 'active', ${SEED_ACTOR}, ${SEED_ACTOR}),
        (${randomUUID()}, ${TENANT}, ${COMMITTEE_B}, ${SEC_OF_B}, 'secretary', '2025-01-01', 'active', ${SEED_ACTOR}, ${SEED_ACTOR}),
        (${randomUUID()}, ${TENANT}, ${COMMITTEE_B}, ${CHAIR_OF_B}, 'chairperson', '2025-01-01', 'active', ${SEED_ACTOR}, ${SEED_ACTOR})`;

    await sql`
      insert into meeting.meetings (id, tenant_id, type, title, status, committee_id, financial_year, scheduled_at, quorum_established, created_by, updated_by)
      values (${MEETING_B}, ${TENANT}, 'committee', 'Committee B meeting', 'in_progress', ${COMMITTEE_B}, '2025-26', '2025-06-01T09:00:00Z', true, ${SEED_ACTOR}, ${SEED_ACTOR})`;

    // A resolution already on the record for MEETING_B, so the sign route reaches the standing
    // gate (past its own existence 404) rather than 404-ing first.
    await sql`
      insert into meeting.resolutions
        (id, tenant_id, meeting_id, resolution_number, text, vote_type, majority_rule, result, status, is_circulation, created_by, updated_by)
      values (${RES_B}, ${TENANT}, ${MEETING_B}, ${"CB/RES/2025-26/001"}, 'A recorded resolution of Committee B', 'roll_call',
              'simple_majority', 'passed', 'effective', false, ${SEED_ACTOR}, ${SEED_ACTOR})`;
  });

  app = await buildApp();
});

afterAll(async () => {
  await app.close();
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`delete from meeting.resolutions where tenant_id = ${TENANT}`;
    await sql`delete from meeting.committee_members where tenant_id = ${TENANT}`;
    await sql`delete from meeting.committees where tenant_id = ${TENANT}`;
    await sql`delete from meeting.meetings where tenant_id = ${TENANT}`;
    await sql`delete from _outbox.messages where tenant_id = ${TENANT}`;
  });
  await sqlClient.end();
});

describe("[FIXED, Gap 1] resolution.record now requires committee standing", () => {
  it("rejects a flat committee_secretary with ZERO committee_members rows on the target committee", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING_B}/resolutions`,
      headers: {
        authorization: `Bearer ${token(["committee_secretary"], SEC_OF_A)}`,
        "x-idempotency-key": randomUUID(),
      },
      payload: { text: "Resolved: fabricated expenditure for a committee I never served", voteType: "roll_call" },
    });
    // SEC_OF_A has the flat role (passes requireRole) but no roster row on COMMITTEE_B —
    // requireCommitteeStanding rejects with 403 before the command is ever published.
    expect(res.statusCode).not.toBe(202);
    expect(res.statusCode).toBe(403);
  });

  it("confirms the fix: a GENUINE Committee B secretary (active roster row on B) still records (202)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING_B}/resolutions`,
      headers: {
        authorization: `Bearer ${token(["committee_secretary"], SEC_OF_B)}`,
        "x-idempotency-key": randomUUID(),
      },
      payload: { text: "Resolved: legitimate business of Committee B", voteType: "roll_call" },
    });
    expect(res.statusCode).toBe(202);
  });
});

describe("[FIXED, Gap 1] resolution.sign now requires committee standing", () => {
  it("rejects a flat committee_chairperson with ZERO committee_members rows on the target committee", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING_B}/resolutions/${RES_B}/sign`,
      headers: {
        authorization: `Bearer ${token(["committee_chairperson"], CHAIR_OF_A)}`,
        "x-idempotency-key": randomUUID(),
      },
      payload: { signerId: CHAIR_OF_A },
    });
    // CHAIR_OF_A can sign nothing on Committee B — no roster standing there. 403, not 202.
    expect(res.statusCode).not.toBe(202);
    expect(res.statusCode).toBe(403);
  });

  it("confirms the fix: the GENUINE Committee B chairperson (active roster row on B) can still sign (202)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING_B}/resolutions/${RES_B}/sign`,
      headers: {
        authorization: `Bearer ${token(["committee_chairperson"], CHAIR_OF_B)}`,
        "x-idempotency-key": randomUUID(),
      },
      payload: { signerId: CHAIR_OF_B },
    });
    expect(res.statusCode).toBe(202);
  });
});
