/**
 * estab-service committee module — meeting summary/detail count integrity.
 *
 * `MeetingSummarySchema.attendeesCount`/`agendaItemsCount` used to have no backing query at
 * all: `mapMeetingRow` never set them, so the zod schema's `.default(0)` silently produced 0
 * for every meeting regardless of real data (found while fixing the estab/meetings frontend's
 * "Agenda Items" stat card, which sums this exact field -- a frontend fix that sums a
 * never-populated backend field would have been hollow). This file proves the real counts,
 * through the actual HTTP boundary, against real seeded resolutions/attendees.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "c0ff33aa-0000-4000-8000-000000000c01";
const ACTOR = randomUUID();

const COMMITTEE = randomUUID();
const MEETING = randomUUID(); // 3 resolutions, 2 attendees seeded below
const EMPTY_MEETING = randomUUID(); // zero of each -- the honest zero case

function token(roles: string[] = ["estab_officer", "super_admin"]) {
  return signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-counts" }, SECRET);
}

let app: FastifyInstance;

beforeAll(async () => {
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`DELETE FROM committee.estab_attendees WHERE tenant_id = ${TENANT}`;
    await sql`DELETE FROM committee.estab_resolutions WHERE tenant_id = ${TENANT}`;
    await sql`DELETE FROM committee.estab_meetings WHERE tenant_id = ${TENANT}`;
    await sql`DELETE FROM committee.estab_committees WHERE tenant_id = ${TENANT}`;

    await sql`
      INSERT INTO committee.estab_committees (id, tenant_id, name, chair_ref, status, created_by, updated_by)
      VALUES (${COMMITTEE}, ${TENANT}, 'Establishment Committee', ${ACTOR}, 'active', ${ACTOR}, ${ACTOR})`;

    await sql`
      INSERT INTO committee.estab_meetings (id, tenant_id, committee_id, title, when_at, status, created_by, updated_by)
      VALUES
        (${MEETING}, ${TENANT}, ${COMMITTEE}, 'Q1 Establishment Review', '2026-03-01T10:00:00Z', 'completed', ${ACTOR}, ${ACTOR}),
        (${EMPTY_MEETING}, ${TENANT}, ${COMMITTEE}, 'Q2 Establishment Review', '2026-06-01T10:00:00Z', 'scheduled', ${ACTOR}, ${ACTOR})`;

    // 3 resolutions on MEETING, 0 on EMPTY_MEETING.
    for (const seq of [1, 2, 3]) {
      await sql`
        INSERT INTO committee.estab_resolutions (id, tenant_id, meeting_id, seq, body, status, created_by, updated_by)
        VALUES (${randomUUID()}, ${TENANT}, ${MEETING}, ${seq}, ${"Resolution " + seq}, 'pending', ${ACTOR}, ${ACTOR})`;
    }

    // 2 attendees on MEETING, 0 on EMPTY_MEETING.
    for (const member of [randomUUID(), randomUUID()]) {
      await sql`
        INSERT INTO committee.estab_attendees (id, tenant_id, meeting_id, member_ref, role, attended, created_by, updated_by)
        VALUES (${randomUUID()}, ${TENANT}, ${MEETING}, ${member}, 'member', true, ${ACTOR}, ${ACTOR})`;
    }
  });

  app = await buildApp();
});

afterAll(async () => {
  await app.close();
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`DELETE FROM committee.estab_attendees WHERE tenant_id = ${TENANT}`;
    await sql`DELETE FROM committee.estab_resolutions WHERE tenant_id = ${TENANT}`;
    await sql`DELETE FROM committee.estab_meetings WHERE tenant_id = ${TENANT}`;
    await sql`DELETE FROM committee.estab_committees WHERE tenant_id = ${TENANT}`;
  });
  await sqlClient.end();
});

describe("[FIXED] GET /v1/estab/meetings reports REAL attendeesCount/agendaItemsCount", () => {
  it("a meeting with 3 resolutions and 2 attendees reports those exact counts, not 0", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/estab/meetings",
      headers: { authorization: `Bearer ${token()}`, "x-tenant-id": TENANT },
    });
    expect(res.statusCode).toBe(200);
    const rows = res.json() as Array<{ id: string; attendeesCount: number; agendaItemsCount: number }>;
    const row = rows.find((r) => r.id === MEETING);
    expect(row).toBeDefined();
    expect(row!.agendaItemsCount).toBe(3);
    expect(row!.attendeesCount).toBe(2);
  });

  it("a meeting with zero resolutions/attendees honestly reports 0, not a fabricated number", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/estab/meetings",
      headers: { authorization: `Bearer ${token()}`, "x-tenant-id": TENANT },
    });
    const rows = res.json() as Array<{ id: string; attendeesCount: number; agendaItemsCount: number }>;
    const row = rows.find((r) => r.id === EMPTY_MEETING);
    expect(row).toBeDefined();
    expect(row!.agendaItemsCount).toBe(0);
    expect(row!.attendeesCount).toBe(0);
  });
});

describe("[FIXED] GET /v1/estab/meetings/:id (detail) reports the same real counts", () => {
  it("matches the list endpoint's counts for the same meeting", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/estab/meetings/${MEETING}`,
      headers: { authorization: `Bearer ${token()}`, "x-tenant-id": TENANT },
    });
    expect(res.statusCode).toBe(200);
    const detail = res.json() as { agendaItemsCount: number; attendeesCount: number; actionPoints: unknown[] };
    expect(detail.agendaItemsCount).toBe(3);
    expect(detail.attendeesCount).toBe(2);
    // actionPoints (the real per-resolution detail rows) independently agrees with the count.
    expect(detail.actionPoints).toHaveLength(3);
  });
});
