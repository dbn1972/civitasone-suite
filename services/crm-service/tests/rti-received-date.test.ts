/**
 * GAP-CRM-RTI-NEW-02 — RTI received-date + mode-of-receipt, and the statutory
 * 30-day due date computed from the real date of receipt (not the filing time).
 *
 * These assertions FAIL on the old code: POST /v1/crm/rti had no receivedDate
 * or mode field, so an RTI physically received days earlier started its 30-day
 * clock whenever the register entry happened to be filed, and a future receipt
 * date was silently accepted.
 *
 * Real DB round trips (the due_at column is a generated STORED column computed
 * from received_at) — the test asserts the DB-computed deadline, not app math.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

function authHeaders(roles: string[], tid: string): Record<string, string> {
  const jwt = signToken({ sub: randomUUID(), tid, roles, sid: "sess-rti-newrecv" }, SECRET);
  return { authorization: `Bearer ${jwt}`, "x-tenant-id": tid };
}

const app = await buildApp();

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

function basePayload(overrides: Record<string, unknown> = {}) {
  return {
    section: "s.6",
    departmentRef: "REVENUE",
    applicantName: "Test Applicant",
    subject: "Request for property tax records",
    description: "Please furnish copies of assessment records for FY24-25.",
    ...overrides,
  };
}

/** Calendar date "YYYY-MM-DD" `days` relative to today, in UTC. */
function utcDateOffset(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

describe("GAP-CRM-RTI-NEW-02: receivedDate drives the 30-day statutory due date", () => {
  it("defaults received_at to now() and dueAt = received + 30 days when receivedDate is omitted", async () => {
    const tid = randomUUID();
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/rti",
      headers: authHeaders(["crm_user"], tid),
      payload: basePayload(),
    });
    expect(res.statusCode).toBe(201);
    const row = res.json().data;
    const days = Math.round(
      (new Date(row.dueAt).getTime() - new Date(row.receivedAt).getTime()) / 86_400_000,
    );
    expect(days).toBe(30);
  });

  it("persists a back-dated receivedDate and computes dueAt = receivedDate + 30 days (DB generated column)", async () => {
    const tid = randomUUID();
    const receivedDate = utcDateOffset(-5); // received 5 days ago
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/rti",
      headers: authHeaders(["crm_user"], tid),
      payload: basePayload({ receivedDate, mode: "post" }),
    });
    expect(res.statusCode).toBe(201);
    const row = res.json().data;

    // received_at is the supplied calendar day (UTC midnight).
    expect(new Date(row.receivedAt).toISOString().slice(0, 10)).toBe(receivedDate);
    // dueAt is exactly 30 days after the received calendar day.
    const expectedDue = utcDateOffset(25); // today - 5 + 30 == today + 25
    expect(new Date(row.dueAt).toISOString().slice(0, 10)).toBe(expectedDue);
    // mode of receipt is persisted and returned.
    expect(row.mode).toBe("post");
  });

  it("rejects a future receivedDate with 422 (fail closed — the clock cannot start in the future)", async () => {
    const tid = randomUUID();
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/rti",
      headers: authHeaders(["crm_user"], tid),
      payload: basePayload({ receivedDate: utcDateOffset(5) }),
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("INVALID_RECEIVED_DATE");
  });

  it("rejects a malformed receivedDate with 400 (zod boundary validation)", async () => {
    const tid = randomUUID();
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/rti",
      headers: authHeaders(["crm_user"], tid),
      payload: basePayload({ receivedDate: "yesterday" }),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_FAILED");
  });

  it("rejects an invalid mode with 400 (zod enum)", async () => {
    const tid = randomUUID();
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/rti",
      headers: authHeaders(["crm_user"], tid),
      payload: basePayload({ mode: "pigeon" }),
    });
    expect(res.statusCode).toBe(400);
  });

  it("surfaces receivedDate + mode through GET /:id detail (real DB read)", async () => {
    const tid = randomUUID();
    const receivedDate = utcDateOffset(-3);
    const create = await app.inject({
      method: "POST",
      url: "/v1/crm/rti",
      headers: authHeaders(["crm_user"], tid),
      payload: basePayload({ receivedDate, mode: "email" }),
    });
    const { id } = create.json().data;

    const detail = await app.inject({
      method: "GET",
      url: `/v1/crm/rti/${id}`,
      headers: authHeaders(["crm_user"], tid),
    });
    expect(detail.statusCode).toBe(200);
    const row = detail.json().data;
    expect(row.mode).toBe("email");
    expect(new Date(row.receivedAt).toISOString().slice(0, 10)).toBe(receivedDate);
    expect(new Date(row.dueAt).toISOString().slice(0, 10)).toBe(utcDateOffset(27));
  });
});
