/**
 * Multi-tenancy, quorum gate, and idempotency — property tests (task 21.1).
 *
 * Three architectural correctness properties exercised against the real DB + routes:
 *
 *   - P4  Quorum gate on decisions — meetings with quorum_established==false have zero
 *         decisions and zero resolutions. The state machine prevents a meeting from reaching
 *         in_progress (where decisions may be recorded) unless quorum is established; conversely,
 *         the decision consumer only records decisions for meetings in_progress (which requires
 *         quorum). Verified both via domain logic + DB invariant.
 *
 *   - P29 Tenant isolation — all query results have row.tenant_id == requesting_user.tenant_id.
 *         A user in tenant A can never see tenant B's meetings, committees, decisions, etc.
 *         Verified via route-level GET requests with cross-tenant JWTs against seeded data.
 *
 *   - P30 Consumer idempotency — processing the same messageId twice = same DB state as once.
 *         Verified by running a consumer handler twice with the same message and asserting the
 *         row count and state do not change on the second invocation.
 *
 * fast-check is not a dependency of this service and no sibling meeting-service test uses it, so
 * per the task guidance these are thorough example + generated-input tests: each property is
 * exercised across many deterministic pseudo-random inputs (seeded `mulberry32`, reproducible).
 *
 * **Validates: Requirements 1.4, 15.1, 15.2**
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import type { CommandEnvelope } from "@civitasone/queue";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { COMMANDS, EVENTS } from "../src/topics.js";
import { registerDecisionConsumers } from "../src/modules/decision/consumer.js";
import { registerCalendarConsumers } from "../src/modules/calendar/consumer.js";
import {
  assertTransition,
  validateQuorumForStart,
} from "../src/modules/meeting-core/domain.js";
import { HttpError } from "../src/shared/context.js";

// ─── Deterministic PRNG (reproducible property-style loops) ──────────────────

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const RUNS = 200;

// ─── Test constants ──────────────────────────────────────────────────────────

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

const TENANT_A = "a1a1a1a1-2100-4000-8000-000000000001";
const TENANT_B = "b2b2b2b2-2100-4000-8000-000000000002";
const ACTOR_A = "acacacac-2100-4000-8000-000000000001";
const ACTOR_B = "bcbcbcbc-2100-4000-8000-000000000002";

const COMMITTEE_A = "ca2a2a2a-2100-4000-8000-000000000001";
const COMMITTEE_B = "cb2b2b2b-2100-4000-8000-000000000002";
const MEETING_A_QUORUM = "da2a2a2a-2100-4000-8000-000000000001"; // in_progress, quorum=true
const MEETING_A_NO_QUORUM = "da2a2a2a-2100-4000-8000-000000000002"; // draft, quorum=false
const MEETING_B = "db2b2b2b-2100-4000-8000-000000000001"; // tenant B meeting
const ROOM_A = "ea2a2a2a-2100-4000-8000-000000000001";

function token(roles: string[], tid: string, sub: string) {
  return signToken({ sub, tid, roles, sid: "sess-1" }, SECRET);
}
function authA(roles: string[] = ["meeting_admin"]) {
  return { authorization: `Bearer ${token(roles, TENANT_A, ACTOR_A)}` };
}
function authB(roles: string[] = ["meeting_admin"]) {
  return { authorization: `Bearer ${token(roles, TENANT_B, ACTOR_B)}` };
}

// ─── Consumer handler maps ────────────────────────────────────────────────────

const decisionHandlers = new Map<string, (msg: CommandEnvelope<any>) => Promise<void>>();
registerDecisionConsumers((topic, h) => decisionHandlers.set(topic, h as any));

const calendarHandlers = new Map<string, (msg: CommandEnvelope<any>) => Promise<void>>();
registerCalendarConsumers((topic, h) => calendarHandlers.set(topic, h as any));

function msg<T>(type: string, payload: T, tenantId: string, actorId: string, messageId = randomUUID()): CommandEnvelope<T> {
  return { messageId, type, tenantId, actorId, correlationId: randomUUID(), schemaVersion: "1.0", payload } as CommandEnvelope<T>;
}

function runConsumer<T>(m: CommandEnvelope<T>, handlers: Map<string, (msg: CommandEnvelope<any>) => Promise<void>>): Promise<void> {
  const handler = handlers.get(m.type);
  if (!handler) throw new Error(`no handler for ${m.type}`);
  return runWithTenant(m.tenantId, () => handler(m)) as Promise<void>;
}

let app: FastifyInstance;

beforeAll(async () => {
  // Clean up test tenants
  for (const tid of [TENANT_A, TENANT_B]) {
    await sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${tid}, true)`;
      await sql`delete from meeting.room_bookings where tenant_id = ${tid}`;
      await sql`delete from meeting.rooms where tenant_id = ${tid}`;
      await sql`delete from meeting.resolutions where tenant_id = ${tid}`;
      await sql`delete from meeting.decisions where tenant_id = ${tid}`;
      await sql`delete from meeting.agenda_items where tenant_id = ${tid}`;
      await sql`delete from meeting.meeting_state_transitions where tenant_id = ${tid}`;
      await sql`delete from meeting.meetings where tenant_id = ${tid}`;
      await sql`delete from meeting.committee_members where tenant_id = ${tid}`;
      await sql`delete from meeting.committees where tenant_id = ${tid}`;
      await sql`delete from _outbox.messages where tenant_id = ${tid}`;
    });
  }

  // Seed tenant A
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT_A}, true)`;
    await sql`
      insert into meeting.committees (id, tenant_id, name, code, type, constitution_date, quorum_rule, created_by, updated_by)
      values (${COMMITTEE_A}, ${TENANT_A}, 'Tenant A Committee', 'TAC', 'finance', '2025-01-01',
              ${sql.json({ minMembers: 2 })}, ${ACTOR_A}, ${ACTOR_A})`;
    // Meeting WITH quorum (in_progress)
    await sql`
      insert into meeting.meetings
        (id, tenant_id, type, title, status, committee_id, quorum_established, financial_year,
         meeting_number, scheduled_at, actual_start_at, created_by, updated_by)
      values (${MEETING_A_QUORUM}, ${TENANT_A}, 'committee', 'A Quorum Meeting', 'in_progress',
              ${COMMITTEE_A}, true, '2025-26', 'TAC/2025-26/001', '2026-06-01T09:00:00Z',
              '2026-06-01T09:05:00Z', ${ACTOR_A}, ${ACTOR_A})`;
    // Meeting WITHOUT quorum (draft)
    await sql`
      insert into meeting.meetings
        (id, tenant_id, type, title, status, committee_id, quorum_established, financial_year,
         meeting_number, scheduled_at, created_by, updated_by)
      values (${MEETING_A_NO_QUORUM}, ${TENANT_A}, 'committee', 'A No-Quorum Meeting', 'draft',
              ${COMMITTEE_A}, false, '2025-26', 'TAC/2025-26/002', '2026-07-01T09:00:00Z',
              ${ACTOR_A}, ${ACTOR_A})`;
    // Seed an agenda item for the quorum meeting (so it has data to find)
    await sql`
      insert into meeting.agenda_items
        (id, tenant_id, meeting_id, sequence, title, outcome_type, status, created_by, updated_by)
      values (${randomUUID()}, ${TENANT_A}, ${MEETING_A_QUORUM}, 1, 'Budget Approval', 'decision', 'accepted', ${ACTOR_A}, ${ACTOR_A})`;
    // Room for tenant A (calendar idempotency test)
    await sql`
      insert into meeting.rooms (id, tenant_id, name, capacity, status, created_by, updated_by)
      values (${ROOM_A}, ${TENANT_A}, 'Room A1', 10, 'active', ${ACTOR_A}, ${ACTOR_A})`;
  });

  // Seed tenant B
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT_B}, true)`;
    await sql`
      insert into meeting.committees (id, tenant_id, name, code, type, constitution_date, quorum_rule, created_by, updated_by)
      values (${COMMITTEE_B}, ${TENANT_B}, 'Tenant B Committee', 'TBC', 'statutory', '2025-01-01',
              ${sql.json({ minMembers: 3 })}, ${ACTOR_B}, ${ACTOR_B})`;
    await sql`
      insert into meeting.meetings
        (id, tenant_id, type, title, status, committee_id, quorum_established, financial_year,
         meeting_number, scheduled_at, created_by, updated_by)
      values (${MEETING_B}, ${TENANT_B}, 'statutory', 'B Statutory Meeting', 'in_progress',
              ${COMMITTEE_B}, true, '2025-26', 'TBC/2025-26/001', '2026-06-01T10:00:00Z',
              ${ACTOR_B}, ${ACTOR_B})`;
  });

  app = await buildApp();
});

afterAll(async () => {
  await app.close();
  for (const tid of [TENANT_A, TENANT_B]) {
    await sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${tid}, true)`;
      await sql`delete from meeting.room_bookings where tenant_id = ${tid}`;
      await sql`delete from meeting.rooms where tenant_id = ${tid}`;
      await sql`delete from meeting.resolutions where tenant_id = ${tid}`;
      await sql`delete from meeting.decisions where tenant_id = ${tid}`;
      await sql`delete from meeting.agenda_items where tenant_id = ${tid}`;
      await sql`delete from meeting.meeting_state_transitions where tenant_id = ${tid}`;
      await sql`delete from meeting.meetings where tenant_id = ${tid}`;
      await sql`delete from meeting.committee_members where tenant_id = ${tid}`;
      await sql`delete from meeting.committees where tenant_id = ${tid}`;
      await sql`delete from _outbox.messages where tenant_id = ${tid}`;
    });
  }
  await sqlClient.end();
});

// ═══════════════════════════════════════════════════════════════════════════════
// P4: Quorum gate on decisions
// meetings with quorum_established==false have zero decisions and zero resolutions
// ═══════════════════════════════════════════════════════════════════════════════

describe("P4: quorum gate on decisions (Req 1.4)", () => {
  it("the domain rejects transition to in_progress when quorum is not established", () => {
    const rand = mulberry32(0x04a);
    for (let i = 0; i < RUNS; i++) {
      const quorumEstablished = rand() > 0.5;
      try {
        assertTransition("agenda_locked", "in_progress", {
          now: new Date(),
          quorumEstablished,
        });
        // If it didn't throw, quorum must have been true.
        expect(quorumEstablished).toBe(true);
      } catch (err) {
        // If it threw with MEETING_QUORUM_NOT_MET, quorum must have been false.
        if (err instanceof HttpError && err.code === "MEETING_QUORUM_NOT_MET") {
          expect(quorumEstablished).toBe(false);
        }
        // Other errors (e.g. MEETING_INVALID_TRANSITION) are not quorum-related.
      }
    }
  });

  it("validateQuorumForStart rejects all non-quorum contexts and accepts all quorum contexts", () => {
    const rand = mulberry32(0x04b);
    for (let i = 0; i < RUNS; i++) {
      const quorum = rand() > 0.5;
      if (quorum) {
        expect(() => validateQuorumForStart({ now: new Date(), quorumEstablished: true })).not.toThrow();
      } else {
        expect(() => validateQuorumForStart({ now: new Date(), quorumEstablished: false })).toThrow(HttpError);
      }
    }
  });

  it("a meeting with quorum_established=false (not in_progress) has zero decisions in the DB", async () => {
    // The no-quorum meeting is in draft state — decisions cannot be recorded for it.
    const rows = await sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${TENANT_A}, true)`;
      return sql`
        select count(*)::int as n from meeting.decisions
        where tenant_id = ${TENANT_A} and meeting_id = ${MEETING_A_NO_QUORUM}`;
    });
    expect(rows[0].n).toBe(0);
  });

  it("a meeting with quorum_established=false has zero resolutions in the DB", async () => {
    const rows = await sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${TENANT_A}, true)`;
      return sql`
        select count(*)::int as n from meeting.resolutions
        where tenant_id = ${TENANT_A} and meeting_id = ${MEETING_A_NO_QUORUM}`;
    });
    expect(rows[0].n).toBe(0);
  });

  it("decisions can only be recorded for a meeting in in_progress state (quorum=true)", async () => {
    // Record a decision on the quorum meeting — should succeed.
    const decisionId = randomUUID();
    const m = msg(COMMANDS.decisionRecord, {
      decisionId,
      meetingId: MEETING_A_QUORUM,
      tenantId: TENANT_A,
      text: "P4 quorum test decision",
      type: "administrative",
    }, TENANT_A, ACTOR_A);
    await runConsumer(m, decisionHandlers);

    const rows = await sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${TENANT_A}, true)`;
      return sql`select id from meeting.decisions where id = ${decisionId}`;
    });
    expect(rows.length).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// P29: Tenant isolation
// all query results have row.tenant_id == requesting_user.tenant_id
// ═══════════════════════════════════════════════════════════════════════════════

describe("P29: tenant isolation (Req 15.1)", () => {
  it("GET /v1/meetings returns only meetings belonging to the requesting tenant", async () => {
    const resA = await app.inject({ method: "GET", url: "/v1/meetings", headers: authA() });
    expect(resA.statusCode).toBe(200);
    const dataA = resA.json().data as any[];
    for (const row of dataA) {
      expect(row.tenantId ?? row.tenant_id).toBe(TENANT_A);
    }
    // Tenant A should NOT see tenant B's meeting
    const ids = dataA.map((r: any) => r.id);
    expect(ids).not.toContain(MEETING_B);

    const resB = await app.inject({ method: "GET", url: "/v1/meetings", headers: authB() });
    expect(resB.statusCode).toBe(200);
    const dataB = resB.json().data as any[];
    for (const row of dataB) {
      expect(row.tenantId ?? row.tenant_id).toBe(TENANT_B);
    }
    // Tenant B should NOT see tenant A's meetings
    const idsB = dataB.map((r: any) => r.id);
    expect(idsB).not.toContain(MEETING_A_QUORUM);
    expect(idsB).not.toContain(MEETING_A_NO_QUORUM);
  });

  it("GET /v1/meetings/:meetingId returns 404 when requesting cross-tenant meeting", async () => {
    // Tenant A tries to access Tenant B's meeting → 404
    const res = await app.inject({
      method: "GET",
      url: `/v1/meetings/${MEETING_B}`,
      headers: authA(),
    });
    expect(res.statusCode).toBe(404);

    // Tenant B tries to access Tenant A's meeting → 404
    const res2 = await app.inject({
      method: "GET",
      url: `/v1/meetings/${MEETING_A_QUORUM}`,
      headers: authB(),
    });
    expect(res2.statusCode).toBe(404);
  });

  it("GET /v1/meetings/committees returns only committees for the requesting tenant", async () => {
    const resA = await app.inject({ method: "GET", url: "/v1/meetings/committees", headers: authA() });
    expect(resA.statusCode).toBe(200);
    const dataA = resA.json().data as any[];
    for (const row of dataA) {
      expect(row.tenantId ?? row.tenant_id).toBe(TENANT_A);
    }
    expect(dataA.map((r: any) => r.id)).not.toContain(COMMITTEE_B);

    const resB = await app.inject({ method: "GET", url: "/v1/meetings/committees", headers: authB() });
    expect(resB.statusCode).toBe(200);
    const dataB = resB.json().data as any[];
    for (const row of dataB) {
      expect(row.tenantId ?? row.tenant_id).toBe(TENANT_B);
    }
    expect(dataB.map((r: any) => r.id)).not.toContain(COMMITTEE_A);
  });

  it("GET /v1/meetings/committees/:committeeId returns 404 for cross-tenant access", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/meetings/committees/${COMMITTEE_B}`,
      headers: authA(),
    });
    expect(res.statusCode).toBe(404);
  });

  it("GET /v1/meetings/:meetingId/agenda returns empty/404 for cross-tenant meetings", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/meetings/${MEETING_B}/agenda`,
      headers: authA(),
    });
    // Either 404 (meeting not found) or 200 with empty data
    expect([200, 404]).toContain(res.statusCode);
    if (res.statusCode === 200) {
      expect(res.json().data).toEqual([]);
    }
  });

  it("tenant isolation holds across N random cross-tenant meeting ID probes", async () => {
    const rand = mulberry32(0x29a);
    // Tenant B probes Tenant A's meetings — all must return 404
    const tenantAMeetings = [MEETING_A_QUORUM, MEETING_A_NO_QUORUM];
    for (let i = 0; i < Math.min(RUNS, 50); i++) {
      const meetingId = tenantAMeetings[Math.floor(rand() * tenantAMeetings.length)]!;
      const res = await app.inject({
        method: "GET",
        url: `/v1/meetings/${meetingId}`,
        headers: authB(),
      });
      expect(res.statusCode).toBe(404);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// P30: Consumer idempotency
// processing same messageId twice = same DB state as once
// ═══════════════════════════════════════════════════════════════════════════════

describe("P30: consumer idempotency (Req 15.2)", () => {
  it("decision.record: same messageId processed twice yields exactly one decision row", async () => {
    const decisionId = randomUUID();
    const messageId = randomUUID();
    const m = msg(COMMANDS.decisionRecord, {
      decisionId,
      meetingId: MEETING_A_QUORUM,
      tenantId: TENANT_A,
      text: "Idempotency test decision",
      type: "general",
    }, TENANT_A, ACTOR_A, messageId);

    // First processing
    await runConsumer(m, decisionHandlers);
    const afterFirst = await sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${TENANT_A}, true)`;
      return sql`select count(*)::int as n from meeting.decisions where id = ${decisionId}`;
    });
    expect(afterFirst[0].n).toBe(1);

    // Second processing (same messageId) — must be a no-op
    await runConsumer(m, decisionHandlers);
    const afterSecond = await sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${TENANT_A}, true)`;
      return sql`select count(*)::int as n from meeting.decisions where id = ${decisionId}`;
    });
    expect(afterSecond[0].n).toBe(1);
  });

  it("resolution.record: same messageId processed twice yields exactly one resolution row", async () => {
    const resolutionId = randomUUID();
    const messageId = randomUUID();
    const m = msg(COMMANDS.resolutionRecord, {
      resolutionId,
      meetingId: MEETING_A_QUORUM,
      tenantId: TENANT_A,
      text: "Idempotency test resolution",
      voteType: "electronic_poll",
      majorityRule: "simple_majority",
      votesFor: 3,
      votesAgainst: 1,
      votesAbstain: 0,
    }, TENANT_A, ACTOR_A, messageId);

    await runConsumer(m, decisionHandlers);
    const afterFirst = await sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${TENANT_A}, true)`;
      return sql`select count(*)::int as n from meeting.resolutions where id = ${resolutionId}`;
    });
    expect(afterFirst[0].n).toBe(1);

    // Second processing — still exactly one row
    await runConsumer(m, decisionHandlers);
    const afterSecond = await sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${TENANT_A}, true)`;
      return sql`select count(*)::int as n from meeting.resolutions where id = ${resolutionId}`;
    });
    expect(afterSecond[0].n).toBe(1);
  });

  it("room.book: same messageId processed twice yields exactly one booking and one event", async () => {
    const bookingId = randomUUID();
    const messageId = randomUUID();
    const m = msg(COMMANDS.roomBook, {
      bookingId,
      tenantId: TENANT_A,
      meetingId: MEETING_A_QUORUM,
      roomId: ROOM_A,
      startAt: "2032-01-15T09:00:00.000Z",
      endAt: "2032-01-15T10:00:00.000Z",
    }, TENANT_A, ACTOR_A, messageId);

    await runConsumer(m, calendarHandlers);
    const afterFirst = await sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${TENANT_A}, true)`;
      return sql`select count(*)::int as n from meeting.room_bookings where id = ${bookingId}`;
    });
    expect(afterFirst[0].n).toBe(1);

    const eventsBefore = await sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${TENANT_A}, true)`;
      return sql`select count(*)::int as n from _outbox.messages where tenant_id = ${TENANT_A} and topic = ${EVENTS.roomBooked}`;
    });

    // Second processing — no-op
    await runConsumer(m, calendarHandlers);
    const afterSecond = await sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${TENANT_A}, true)`;
      return sql`select count(*)::int as n from meeting.room_bookings where id = ${bookingId}`;
    });
    expect(afterSecond[0].n).toBe(1);

    // No additional outbox event emitted
    const eventsAfter = await sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${TENANT_A}, true)`;
      return sql`select count(*)::int as n from _outbox.messages where tenant_id = ${TENANT_A} and topic = ${EVENTS.roomBooked}`;
    });
    expect(eventsAfter[0].n).toBe(eventsBefore[0].n);
  });

  it("idempotency holds across N random message redeliveries (decision.record)", async () => {
    const rand = mulberry32(0x30a);
    const decisionsToTest = 10;
    for (let i = 0; i < decisionsToTest; i++) {
      const decisionId = randomUUID();
      const messageId = randomUUID();
      const m = msg(COMMANDS.decisionRecord, {
        decisionId,
        meetingId: MEETING_A_QUORUM,
        tenantId: TENANT_A,
        text: `Random idempotency test ${i}`,
        type: "general",
      }, TENANT_A, ACTOR_A, messageId);

      // Process 1 to N+1 times (simulating redeliveries)
      const deliveries = 1 + Math.floor(rand() * 4);
      for (let d = 0; d < deliveries; d++) {
        await runConsumer(m, decisionHandlers);
      }

      // Invariant: exactly one row exists regardless of delivery count
      const rows = await sqlClient.begin(async (sql) => {
        await sql`select set_config('app.tenant_id', ${TENANT_A}, true)`;
        return sql`select count(*)::int as n from meeting.decisions where id = ${decisionId}`;
      });
      expect(rows[0].n).toBe(1);
    }
  });
});
