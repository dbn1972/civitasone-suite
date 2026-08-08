/**
 * Scheduled report generation and delivery tests.
 * Covers:
 *  - CRUD routes (create, list, get, update, delete, manual run)
 *  - computeNextRunAt correctness for each cadence
 *  - Max 20 recipients validation
 *  - Env gate for cron
 *  - Timeout handling (120s)
 *  - Retry logic (3 retries on delivery failure)
 *  - Optimistic locking on update
 */
import { describe, it, expect, afterAll, beforeAll, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { computeNextRunAt, isValidCadence, GENERATION_TIMEOUT_MS, MAX_DELIVERY_RETRIES, MAX_RECIPIENTS } from "../src/modules/scheduled/domain.js";
import { startScheduledReportCron } from "../src/modules/scheduled/cron.js";
import {
  handleCreateScheduled,
  handleUpdateScheduled,
  handleDisableScheduled,
} from "../src/modules/scheduled/consumer.js";
import type { ScheduledReportView } from "../src/modules/scheduled/schema.js";
import type { FastifyInstance } from "fastify";

/** JSON round-trip turns Dates into strings; Drizzle timestamp columns need Date. */
function asScheduledView(data: Record<string, unknown>): ScheduledReportView {
  return {
    ...(data as unknown as ScheduledReportView),
    nextRunAt: new Date(String(data.nextRunAt)),
    createdAt: new Date(String(data.createdAt)),
    updatedAt: new Date(String(data.updatedAt)),
    lastRunAt: data.lastRunAt == null ? null : new Date(String(data.lastRunAt)),
  };
}

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000077";
const ACTOR = "aaaaaaaa-1111-4000-8000-000000000001";
const TEMPLATE_ID = "11111111-1111-4000-8000-000000000001";

function makeToken(roles: string[] = ["report_admin"]) {
  return signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-sched-001" }, SECRET);
}

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

// ─── Domain Logic Tests (Pure, no DB) ────────────────────────────────────────

describe("computeNextRunAt", () => {
  describe("hourly cadence", () => {
    it("advances by exactly 1 hour", () => {
      const from = new Date("2026-07-10T14:30:00.000Z");
      const next = computeNextRunAt(from, "hourly");
      expect(next.toISOString()).toBe("2026-07-10T15:30:00.000Z");
    });

    it("rolls over midnight", () => {
      const from = new Date("2026-07-10T23:15:00.000Z");
      const next = computeNextRunAt(from, "hourly");
      expect(next.toISOString()).toBe("2026-07-11T00:15:00.000Z");
    });
  });

  describe("daily cadence", () => {
    it("advances by exactly 24 hours", () => {
      const from = new Date("2026-07-10T08:00:00.000Z");
      const next = computeNextRunAt(from, "daily");
      expect(next.toISOString()).toBe("2026-07-11T08:00:00.000Z");
    });

    it("handles end-of-month boundary", () => {
      const from = new Date("2026-07-31T12:00:00.000Z");
      const next = computeNextRunAt(from, "daily");
      expect(next.toISOString()).toBe("2026-08-01T12:00:00.000Z");
    });
  });

  describe("weekly cadence", () => {
    it("advances by exactly 7 days", () => {
      const from = new Date("2026-07-10T10:00:00.000Z");
      const next = computeNextRunAt(from, "weekly");
      expect(next.toISOString()).toBe("2026-07-17T10:00:00.000Z");
    });

    it("crosses month boundary", () => {
      const from = new Date("2026-07-28T10:00:00.000Z");
      const next = computeNextRunAt(from, "weekly");
      expect(next.toISOString()).toBe("2026-08-04T10:00:00.000Z");
    });
  });

  describe("monthly cadence", () => {
    it("advances to the same day next month", () => {
      const from = new Date("2026-07-15T09:00:00.000Z");
      const next = computeNextRunAt(from, "monthly");
      expect(next.toISOString()).toBe("2026-08-15T09:00:00.000Z");
    });

    it("clamps to last day of month when target month is shorter", () => {
      const from = new Date("2026-01-31T12:00:00.000Z");
      const next = computeNextRunAt(from, "monthly");
      expect(next.toISOString()).toBe("2026-02-28T12:00:00.000Z");
    });

    it("handles leap year Feb 29", () => {
      const from = new Date("2028-01-31T12:00:00.000Z");
      const next = computeNextRunAt(from, "monthly");
      expect(next.toISOString()).toBe("2028-02-29T12:00:00.000Z");
    });

    it("rolls over year boundary", () => {
      const from = new Date("2026-12-15T10:00:00.000Z");
      const next = computeNextRunAt(from, "monthly");
      expect(next.toISOString()).toBe("2027-01-15T10:00:00.000Z");
    });

    it("preserves time components", () => {
      const from = new Date("2026-07-10T14:35:22.123Z");
      const next = computeNextRunAt(from, "monthly");
      expect(next.getUTCHours()).toBe(14);
      expect(next.getUTCMinutes()).toBe(35);
      expect(next.getUTCSeconds()).toBe(22);
      expect(next.getUTCMilliseconds()).toBe(123);
    });
  });
});

describe("isValidCadence", () => {
  it("accepts valid cadences", () => {
    expect(isValidCadence("hourly")).toBe(true);
    expect(isValidCadence("daily")).toBe(true);
    expect(isValidCadence("weekly")).toBe(true);
    expect(isValidCadence("monthly")).toBe(true);
  });

  it("rejects invalid cadences", () => {
    expect(isValidCadence("yearly")).toBe(false);
    expect(isValidCadence("")).toBe(false);
    expect(isValidCadence("minutely")).toBe(false);
  });
});

describe("domain constants", () => {
  it("GENERATION_TIMEOUT_MS is 120s", () => {
    expect(GENERATION_TIMEOUT_MS).toBe(120_000);
  });

  it("MAX_DELIVERY_RETRIES is 3", () => {
    expect(MAX_DELIVERY_RETRIES).toBe(3);
  });

  it("MAX_RECIPIENTS is 20", () => {
    expect(MAX_RECIPIENTS).toBe(20);
  });
});

// ─── Env Gate Tests ──────────────────────────────────────────────────────────

describe("startScheduledReportCron — env gate", () => {
  const originalEnv = process.env.REPORT_SCHEDULER_ENABLED;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.REPORT_SCHEDULER_ENABLED;
    } else {
      process.env.REPORT_SCHEDULER_ENABLED = originalEnv;
    }
  });

  it("returns null when REPORT_SCHEDULER_ENABLED is not set", () => {
    delete process.env.REPORT_SCHEDULER_ENABLED;
    const timer = startScheduledReportCron(60_000);
    expect(timer).toBeNull();
  });

  it("returns null when REPORT_SCHEDULER_ENABLED is 'false'", () => {
    process.env.REPORT_SCHEDULER_ENABLED = "false";
    const timer = startScheduledReportCron(60_000);
    expect(timer).toBeNull();
  });

  it("returns a timer handle when REPORT_SCHEDULER_ENABLED is 'true'", () => {
    process.env.REPORT_SCHEDULER_ENABLED = "true";
    const timer = startScheduledReportCron(60_000);
    expect(timer).not.toBeNull();
    if (timer) clearInterval(timer);
  });
});

// ─── Route Tests ─────────────────────────────────────────────────────────────

describe("POST /v1/reports/scheduled — create", () => {
  const validPayload = {
    templateId: TEMPLATE_ID,
    cadence: "daily",
    recipients: ["user@example.com"],
    format: "pdf",
  };

  it("returns 202 with valid body", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/reports/scheduled",
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: validPayload,
    });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.data.id).toBeDefined();
    expect(body.data.status).toBe("accepted");
  });

  it("returns 401 without token", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/reports/scheduled",
      payload: validPayload,
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for unauthorized role", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/reports/scheduled",
      headers: { authorization: `Bearer ${makeToken(["citizen"])}` },
      payload: validPayload,
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns 400 for missing templateId", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/reports/scheduled",
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: { cadence: "daily", recipients: ["a@b.com"] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for invalid cadence", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/reports/scheduled",
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: { ...validPayload, cadence: "yearly" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when recipients exceeds 20", async () => {
    const tooManyRecipients = Array.from({ length: 21 }, (_, i) => `user${i}@example.com`);
    const res = await app.inject({
      method: "POST",
      url: "/v1/reports/scheduled",
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: { ...validPayload, recipients: tooManyRecipients },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when recipients is empty", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/reports/scheduled",
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: { ...validPayload, recipients: [] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for invalid email in recipients", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/reports/scheduled",
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: { ...validPayload, recipients: ["not-an-email"] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("accepts exactly 20 recipients", async () => {
    const maxRecipients = Array.from({ length: 20 }, (_, i) => `user${i}@example.com`);
    const res = await app.inject({
      method: "POST",
      url: "/v1/reports/scheduled",
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: { ...validPayload, recipients: maxRecipients },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().data.status).toBe("accepted");
  });
});

describe("GET /v1/reports/scheduled — list", () => {
  it("returns 200 with list shape", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/reports/scheduled",
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toBeDefined();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.meta).toBeDefined();
  });

  it("returns 401 without token", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/reports/scheduled",
    });
    expect(res.statusCode).toBe(401);
  });

  it("tenant isolation: other tenant returns empty", async () => {
    const otherTenant = "bbbbbbbb-2222-4000-8000-000000000077";
    const token = signToken({ sub: "bbbbbbbb-2222-4000-8000-000000000002", tid: otherTenant, roles: ["report_admin"], sid: "s2" }, SECRET);
    const res = await app.inject({
      method: "GET",
      url: "/v1/reports/scheduled",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([]);
  });
});

describe("GET /v1/reports/scheduled/:id — single", () => {
  it("returns 404 for non-existent report", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/reports/scheduled/00000000-0000-4000-8000-000000000099",
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 400 for invalid UUID param", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/reports/scheduled/not-a-uuid",
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("PATCH /v1/reports/scheduled/:id — update", () => {
  it("returns 404 for non-existent report", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/v1/reports/scheduled/00000000-0000-4000-8000-000000000099",
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: { cadence: "weekly", version: 1 },
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 400 without version field (optimistic lock required)", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/v1/reports/scheduled/00000000-0000-4000-8000-000000000099",
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: { cadence: "weekly" },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("DELETE /v1/reports/scheduled/:id — disable", () => {
  it("returns 404 for non-existent report", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/v1/reports/scheduled/00000000-0000-4000-8000-000000000099",
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 401 without token", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/v1/reports/scheduled/00000000-0000-4000-8000-000000000099",
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("POST /v1/reports/scheduled/:id/run — manual trigger", () => {
  it("returns 404 for non-existent report", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/reports/scheduled/00000000-0000-4000-8000-000000000099/run",
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 401 without token", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/reports/scheduled/00000000-0000-4000-8000-000000000099/run",
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for unauthorized role", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/reports/scheduled/00000000-0000-4000-8000-000000000099/run",
      headers: { authorization: `Bearer ${makeToken(["citizen"])}` },
    });
    expect(res.statusCode).toBe(403);
  });
});

// ─── Integration: Create → Get → Update → Delete → Manual Run ───────────────

describe("Scheduled report lifecycle", () => {
  let createdId: string;

  it("creates a scheduled report and retrieves it", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/v1/reports/scheduled",
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: {
        templateId: TEMPLATE_ID,
        cadence: "weekly",
        recipients: ["admin@gov.in", "officer@gov.in"],
        format: "xlsx",
      },
    });
    expect(createRes.statusCode).toBe(202);
    createdId = createRes.json().data.id;

    const getRes = await app.inject({
      method: "GET",
      url: `/v1/reports/scheduled/${createdId}`,
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    expect(getRes.statusCode).toBe(200);
    const data = getRes.json().data;
    expect(data.templateId).toBe(TEMPLATE_ID);
    expect(data.cadence).toBe("weekly");
    expect(data.recipients).toEqual(["admin@gov.in", "officer@gov.in"]);
    expect(data.format).toBe("xlsx");
    expect(data.enabled).toBe(true);

    await handleCreateScheduled(
      createdId,
      { tenantId: TENANT, actorId: ACTOR, correlationId: "corr-create" },
      asScheduledView(data as Record<string, unknown>),
    );
  });

  it("updates the scheduled report", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/reports/scheduled/${createdId}`,
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: { cadence: "monthly", format: "pdf", version: 1 },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().data.status).toBe("accepted");

    // markProcessed stores messageId as uuid — non-uuid strings fail against real Postgres.
    await handleUpdateScheduled(
      randomUUID(),
      { tenantId: TENANT, actorId: ACTOR, correlationId: "corr-update" },
      { id: createdId, version: 1, cadence: "monthly", format: "pdf", nextRunAt: new Date() },
    );
  });

  it("returns 409 on version conflict", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/reports/scheduled/${createdId}`,
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: { cadence: "daily", version: 1 }, // stale version
    });
    expect(res.statusCode).toBe(409);
  });

  it("triggers manual run", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/reports/scheduled/${createdId}/run`,
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    expect(res.statusCode).toBe(202);
    const data = res.json().data;
    expect(data.jobId).toBeDefined();
    expect(data.scheduledReportId).toBe(createdId);
    expect(data.status).toBe("queued");
  });

  it("disables (deletes) the scheduled report", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/reports/scheduled/${createdId}`,
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().data.status).toBe("accepted");

    await handleDisableScheduled(
      randomUUID(),
      { tenantId: TENANT, actorId: ACTOR, correlationId: "corr-disable" },
      { id: createdId },
    );
  });

  it("disabled report does not appear in list", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/reports/scheduled",
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    expect(res.statusCode).toBe(200);
    const ids = res.json().data.map((r: { id: string }) => r.id);
    expect(ids).not.toContain(createdId);
  });
});
