/**
 * X04 / R-RA-0140 — interview calendar routes (.ics download + external sync seam).
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-0140-4000-8000-000000000140";
const USER = "aaaaaaaa-7777-4000-8000-000000000140";
const IV = "dddddddd-0140-4000-8000-00000000d140";

const H = vi.hoisted(() => ({ findInterview: vi.fn() }));

vi.mock("../src/shared/db.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  db: { transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb({}) },
}));
vi.mock("../src/modules/recruitment/interview-comms-repo.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  findInterview: (...a: unknown[]) => H.findInterview(...a),
}));

import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const tok = (roles: string[]) => signToken({ sub: USER, tid: TENANT, roles, sid: "s" }, SECRET);
const auth = (roles = ["hr_officer"]) => ({ authorization: `Bearer ${tok(roles)}` });
const iv = { id: IV, tenantId: TENANT, roundType: "technical", roundNumber: 1, scheduledDate: "2026-08-01", scheduledTime: "10:00", durationMinutes: 60, mode: "video", location: null, meetingLink: "https://meet.example/x" };

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.FEATURE_CALENDAR_SYNC_ENABLED;
  H.findInterview.mockResolvedValue(iv);
});
afterAll(async () => { await sqlClient.end(); });

describe("interview calendar (R-RA-0140)", () => {
  it("downloads a valid .ics invite (200 text/calendar)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/interviews/${IV}/calendar.ics`, headers: auth() });
    expect(r.statusCode).toBe(200);
    expect(r.headers["content-type"]).toContain("text/calendar");
    expect(r.headers["content-disposition"]).toContain(`interview_${IV}.ics`);
    expect(r.body).toContain("BEGIN:VCALENDAR");
    expect(r.body).toContain("DTSTART:20260801T100000Z");
    await app.close();
  });

  it("404 for a missing interview", async () => {
    H.findInterview.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/interviews/${IV}/calendar.ics`, headers: auth() });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("external sync is 501 when not enabled (honest, no fake sync)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/interviews/${IV}/calendar-sync`, headers: auth(["hr_admin"]), payload: { provider: "google" } });
    expect(r.statusCode).toBe(501);
    expect(r.json().code).toBe("CALENDAR_SYNC_NOT_ENABLED");
    await app.close();
  });

  it("external sync is still 501 (adapter not implemented) even when the flag is on", async () => {
    process.env.FEATURE_CALENDAR_SYNC_ENABLED = "true";
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/interviews/${IV}/calendar-sync`, headers: auth(["hr_admin"]), payload: { provider: "outlook" } });
    expect(r.statusCode).toBe(501);
    expect(r.json().code).toBe("CALENDAR_ADAPTER_NOT_IMPLEMENTED");
    await app.close();
  });

  it("rejects an unknown provider (400)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/interviews/${IV}/calendar-sync`, headers: auth(["hr_admin"]), payload: { provider: "ical" } });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("requires auth (401)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/interviews/${IV}/calendar.ics` });
    expect(r.statusCode).toBe(401);
    await app.close();
  });
});
