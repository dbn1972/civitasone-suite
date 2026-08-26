/**
 * Attendance module — HTTP route tests (app.inject) + repo read coverage (task 8.3).
 *
 * Exercises every attendance endpoint's happy path plus the mandated failure matrix
 * (400 validation / 401 unauthenticated / 403 forbidden / 404 not-found) via in-memory
 * Fastify injection with HS256 test JWTs (JWT_ALGORITHM=HS256 in vitest.config.ts), and
 * covers the cache-first repo reads (getAttendance / getLiveAttendance / getAttendanceCount /
 * generateAttendanceSheet) against seeded rows.
 *
 * meeting-service owns its `meeting` schema tables and RLS is not FORCEd on the owner role, so
 * the app-layer `WHERE tenant_id = …` filter provides isolation and the test seeds/cleans rows
 * with the same db client the app uses. A fresh random tenant id per run keeps the fixtures
 * isolated from any residual data.
 *
 * _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7_
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { runWithTenant } from "@civitasone/db";
import { meetings } from "../src/modules/meeting-core/schema.js";
import { committees, committeeMembers } from "../src/modules/committee/schema.js";
import { participants } from "../src/modules/participant/schema.js";
import { attendanceRecords } from "../src/modules/attendance/schema.js";
import * as repo from "../src/modules/attendance/repo.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

const TENANT = randomUUID();
const ACTOR = randomUUID();
const MEETING = randomUUID();
const COMMITTEE = randomUUID();
const P1 = randomUUID(); // has an attendance record (present)
const P2 = randomUUID(); // invited, no record yet (absent on the live board)
const MISSING_MEETING = randomUUID();

const START = new Date("2026-01-15T09:00:00.000Z");

function token(roles: string[] = ["committee_secretary"], tid = TENANT): string {
  return signToken({ sub: ACTOR, tid, roles, sid: "sess-att" }, SECRET);
}

const auth = (roles?: string[], tid?: string) => ({ authorization: `Bearer ${token(roles, tid)}` });
const idem = { "x-idempotency-key": randomUUID(), "content-type": "application/json" };

beforeAll(async () => {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(committees).values({
      id: COMMITTEE,
      tenantId: TENANT,
      name: "Finance Committee",
      type: "statutory",
      constitutionDate: "2024-01-01",
      quorumRule: { minMembers: 1, vcCountsForQuorum: true },
      createdBy: ACTOR,
      updatedBy: ACTOR,
    });
    await tx.insert(committeeMembers).values([
      {
        id: randomUUID(),
        tenantId: TENANT,
        committeeId: COMMITTEE,
        memberId: P1,
        role: "chairperson",
        appointmentDate: "2024-01-01",
        status: "active",
        createdBy: ACTOR,
        updatedBy: ACTOR,
      },
      {
        id: randomUUID(),
        tenantId: TENANT,
        committeeId: COMMITTEE,
        memberId: P2,
        role: "member",
        appointmentDate: "2024-01-01",
        status: "active",
        createdBy: ACTOR,
        updatedBy: ACTOR,
      },
    ]);
    await tx.insert(meetings).values({
      id: MEETING,
      tenantId: TENANT,
      type: "statutory",
      title: "Q1 Review Meeting",
      status: "in_progress",
      committeeId: COMMITTEE,
      venue: "Board Room A",
      scheduledAt: START,
      actualStartAt: START,
      quorumEstablished: true,
      quorumEstablishedAt: START,
      meetingNumber: "FC/2026/01",
      createdBy: ACTOR,
      updatedBy: ACTOR,
    });
    await tx.insert(participants).values([
      {
        id: P1,
        tenantId: TENANT,
        meetingId: MEETING,
        employeeId: P1,
        role: "chairperson",
        invitationStatus: "accepted",
        createdBy: ACTOR,
        updatedBy: ACTOR,
      },
      {
        id: P2,
        tenantId: TENANT,
        meetingId: MEETING,
        employeeId: P2,
        role: "member",
        invitationStatus: "accepted",
        createdBy: ACTOR,
        updatedBy: ACTOR,
      },
    ]);
    await tx.insert(attendanceRecords).values({
      id: randomUUID(),
      tenantId: TENANT,
      meetingId: MEETING,
      participantId: P1,
      method: "manual",
      checkInAt: new Date("2026-01-15T09:05:00.000Z"),
      mode: "in_person",
      status: "present",
      createdBy: ACTOR,
      updatedBy: ACTOR,
    });
  }));
});

afterAll(async () => {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(attendanceRecords).where(eq(attendanceRecords.tenantId, TENANT));
    await tx.delete(participants).where(eq(participants.tenantId, TENANT));
    await tx.delete(committeeMembers).where(eq(committeeMembers.tenantId, TENANT));
    // meetings before committees (fix 8: meeting.meetings.committee_id now carries a real FK).
    await tx.delete(meetings).where(and(eq(meetings.tenantId, TENANT), eq(meetings.id, MEETING)));
    await tx.delete(committees).where(eq(committees.tenantId, TENANT));
  }));
  await sqlClient.end();
});

// ─── POST check-in (Req 6.1, 6.2) ────────────────────────────────────────────

describe("POST /v1/meetings/:id/attendance/check-in", () => {
  it("accepts a valid check-in and returns 202", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING}/attendance/check-in`,
      headers: { ...auth(["committee_member"]), ...idem },
      payload: { participantId: P2, method: "biometric" },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.data.status).toBe("accepted");
    expect(typeof body.data.id).toBe("string");
  });

  it("rejects a missing X-Idempotency-Key with 400", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING}/attendance/check-in`,
      headers: { ...auth(["committee_member"]), "content-type": "application/json" },
      payload: { participantId: P2, method: "biometric" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_FAILED");
  });

  it("rejects an invalid body (geo without coordinates) with 400", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING}/attendance/check-in`,
      headers: { ...auth(["committee_member"]), ...idem },
      payload: { participantId: P2, method: "geo" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("rejects an unauthenticated request with 401", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING}/attendance/check-in`,
      headers: { "content-type": "application/json" },
      payload: { participantId: P2, method: "biometric" },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("rejects a forbidden role with 403", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING}/attendance/check-in`,
      headers: { ...auth(["citizen"]), ...idem },
      payload: { participantId: P2, method: "biometric" },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("returns 404 for an unknown meeting", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MISSING_MEETING}/attendance/check-in`,
      headers: { ...auth(["committee_member"]), ...idem },
      payload: { participantId: P2, method: "biometric" },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("MEETING_NOT_FOUND");
  });
});

// ─── POST check-out (Req 6.6) ─────────────────────────────────────────────────

describe("POST /v1/meetings/:id/attendance/check-out", () => {
  it("accepts a valid check-out and returns 202", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING}/attendance/check-out`,
      headers: { ...auth(["committee_member"]), ...idem },
      payload: { participantId: P1 },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
  });

  it("returns 404 for an unknown meeting", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MISSING_MEETING}/attendance/check-out`,
      headers: { ...auth(["committee_member"]), ...idem },
      payload: { participantId: P1 },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });
});

// ─── GET attendance list (Req 6.1) ────────────────────────────────────────────

describe("GET /v1/meetings/:id/attendance", () => {
  it("returns 200 with the seeded records and meta", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/meetings/${MEETING}/attendance`,
      headers: auth(["observer"]),
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThanOrEqual(1);
    expect(body.meta.total).toBeGreaterThanOrEqual(1);
  });

  it("filters by status via query param", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/meetings/${MEETING}/attendance?status=present`,
      headers: auth(["observer"]),
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    for (const r of res.json().data) expect(r.status).toBe("present");
  });

  it("returns 401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: `/v1/meetings/${MEETING}/attendance` });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for a forbidden role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/meetings/${MEETING}/attendance`,
      headers: auth(["citizen"]),
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("returns 404 for an unknown meeting", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/meetings/${MISSING_MEETING}/attendance`,
      headers: auth(["observer"]),
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });
});

// ─── GET live dashboard (Req 6.3) ─────────────────────────────────────────────

describe("GET /v1/meetings/:id/attendance/live", () => {
  it("returns 200 with the real-time dashboard shape", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/meetings/${MEETING}/attendance/live`,
      headers: auth(["committee_chairperson"]),
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d.meetingId).toBe(MEETING);
    expect(d.counts.total).toBe(2); // two invited participants
    expect(d.counts.present).toBe(1); // P1 present
    expect(d.counts.absent).toBe(1); // P2 no record
    expect(d.participants).toHaveLength(2);
  });

  it("returns 404 for an unknown meeting", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/meetings/${MISSING_MEETING}/attendance/live`,
      headers: auth(["committee_chairperson"]),
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });
});

// ─── POST manual mark (Req 6.1) ───────────────────────────────────────────────

describe("POST /v1/meetings/:id/attendance/manual", () => {
  it("accepts a secretary manual mark and returns 202", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING}/attendance/manual`,
      headers: { ...auth(["committee_secretary"]), ...idem },
      payload: { participantId: P2, status: "present" },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
  });

  it("forbids a plain member from manual marking (403)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING}/attendance/manual`,
      headers: { ...auth(["committee_member"]), ...idem },
      payload: { participantId: P2, status: "present" },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("rejects a missing X-Idempotency-Key with 400", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING}/attendance/manual`,
      headers: { ...auth(["committee_secretary"]), "content-type": "application/json" },
      payload: { participantId: P2, status: "present" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("rejects an invalid status with 400", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING}/attendance/manual`,
      headers: { ...auth(["committee_secretary"]), ...idem },
      payload: { participantId: P2, status: "teleported" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 404 for an unknown meeting", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MISSING_MEETING}/attendance/manual`,
      headers: { ...auth(["committee_secretary"]), ...idem },
      payload: { participantId: P2, status: "present" },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });
});

// ─── GET attendance sheet (PDF, Req 6.6) ──────────────────────────────────────

describe("GET /v1/meetings/:id/attendance/sheet", () => {
  it("returns 200 with a PDF attachment", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/meetings/${MEETING}/attendance/sheet`,
      headers: auth(["committee_secretary"]),
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("application/pdf");
    expect(res.headers["content-disposition"]).toContain(`attendance-${MEETING}.pdf`);
    expect(res.rawPayload.length).toBeGreaterThan(0);
  });

  it("returns 404 for an unknown meeting", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/meetings/${MISSING_MEETING}/attendance/sheet`,
      headers: auth(["committee_secretary"]),
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });
});

// ─── POST QR mint (Req 6.1, 6.2) ──────────────────────────────────────────────

describe("POST /v1/meetings/:id/attendance/qr", () => {
  it("mints a signed QR token with an expiry (200)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING}/attendance/qr`,
      headers: { ...auth(["committee_secretary"]), "content-type": "application/json" },
      payload: { ttlMinutes: 60 },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d.meetingId).toBe(MEETING);
    expect(typeof d.token).toBe("string");
    expect(d.token).toContain(".");
    expect(typeof d.expiresAt).toBe("string");
  });

  it("forbids a plain member from minting a QR token (403)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING}/attendance/qr`,
      headers: { ...auth(["committee_member"]), "content-type": "application/json" },
      payload: {},
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("returns 404 for an unknown meeting", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MISSING_MEETING}/attendance/qr`,
      headers: { ...auth(["committee_secretary"]), "content-type": "application/json" },
      payload: {},
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });
});

// ─── Repo read coverage (cache-first) ─────────────────────────────────────────

describe("attendance repo reads", () => {
  it("getAttendanceCount reports counts + live quorum evaluation (Req 6.4)", async () => {
    const summary = await runWithTenant(TENANT, () => repo.getAttendanceCount(TENANT, MEETING));
    expect(summary).not.toBeNull();
    expect(summary!.present).toBeGreaterThanOrEqual(1);
    expect(summary!.quorumEstablished).toBe(true);
    expect(summary!.quorumRequired).toBe(1);
    expect(summary!.countedForQuorum).toBeGreaterThanOrEqual(1);
    expect(summary!.quorumMet).toBe(true);
  });

  it("getAttendanceCount returns null for an unknown meeting", async () => {
    const summary = await runWithTenant(TENANT, () => repo.getAttendanceCount(TENANT, randomUUID()));
    expect(summary).toBeNull();
  });

  it("getMeetingSnapshot returns null for an unknown meeting", async () => {
    const snap = await runWithTenant(TENANT, () => repo.getMeetingSnapshot(TENANT, randomUUID()));
    expect(snap).toBeNull();
  });

  it("generateAttendanceSheet returns null for an unknown meeting", async () => {
    const sheet = await runWithTenant(TENANT, () => repo.generateAttendanceSheet(TENANT, randomUUID()));
    expect(sheet).toBeNull();
  });
});
