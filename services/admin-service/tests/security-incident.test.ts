/**
 * CAP-090 — security incident & breach management tests.
 * Unit: pure lifecycle + statutory deadline logic.
 * Integration: full lifecycle (detected→triaged→contained→resolved→closed),
 *   maker-checker on close, breach-notification deadline + submit, tenant RLS.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import {
  canTransition, checkCloseSegregation, computeBreachDeadline, eventTopicForStatus,
  hoursUntilDeadline, isBreachOverdue, timestampColumnFor,
} from "../src/modules/security-incident/service.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
// Per-run random ids keep these DB-backed tests isolated on the shared Postgres.
const TENANT = randomUUID();
const OTHER_TENANT = randomUUID();
const REPORTER = randomUUID();
const CHECKER = randomUUID();

function token(actorId: string, tenantId = TENANT, roles = ["security_admin"]): string {
  return signToken({ sub: actorId, tid: tenantId, roles, sid: "sess-sec" }, SECRET, 3600);
}
function auth(actorId: string, tenantId?: string, roles?: string[]) {
  return { authorization: `Bearer ${token(actorId, tenantId, roles)}`, "x-tenant-id": tenantId ?? TENANT };
}

let app: FastifyInstance;
beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); await sqlClient.end(); });

describe("service (pure)", () => {
  it("enforces forward-only lifecycle", () => {
    expect(canTransition("detected", "triaged")).toBe(true);
    expect(canTransition("triaged", "contained")).toBe(true);
    expect(canTransition("contained", "resolved")).toBe(true);
    expect(canTransition("resolved", "closed")).toBe(true);
    expect(canTransition("detected", "resolved")).toBe(false);
    expect(canTransition("detected", "closed")).toBe(false);
    expect(canTransition("closed", "detected")).toBe(false);
  });
  it("computes the DPDP statutory deadline (default 72h)", () => {
    const detected = new Date("2026-07-01T00:00:00.000Z");
    expect(computeBreachDeadline(detected).toISOString()).toBe("2026-07-04T00:00:00.000Z");
    expect(computeBreachDeadline(detected, 6).toISOString()).toBe("2026-07-01T06:00:00.000Z");
  });
  it("rejects a non-positive window", () => {
    expect(() => computeBreachDeadline(new Date(), 0)).toThrow();
    expect(() => computeBreachDeadline(new Date(), -5)).toThrow();
  });
  it("detects overdue only for pending", () => {
    const past = new Date(Date.now() - 3_600_000);
    const future = new Date(Date.now() + 3_600_000);
    expect(isBreachOverdue(past, "pending")).toBe(true);
    expect(isBreachOverdue(past, "submitted")).toBe(false);
    expect(isBreachOverdue(future, "pending")).toBe(false);
  });
  it("computes hours remaining and maps status columns/topics", () => {
    const d = new Date(Date.now() + 10 * 3_600_000);
    expect(hoursUntilDeadline(d)).toBeGreaterThanOrEqual(9);
    expect(timestampColumnFor("resolved")).toBe("resolvedAt");
    expect(timestampColumnFor("detected")).toBeNull();
    expect(eventTopicForStatus("closed")).toBe("security.incident.closed");
  });
  it("blocks self-close (maker-checker)", () => {
    expect(checkCloseSegregation("u1", "u1")).toMatch(/cannot close/);
    expect(checkCloseSegregation("u1", "u2")).toBeNull();
  });
});

describe("incident lifecycle (integration)", () => {
  let incidentId: string;

  it("detects (creates) an incident", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/security-incidents", headers: auth(REPORTER),
      payload: { title: "Suspicious data export", severity: "high", category: "data_exfiltration", affectedDataPrincipals: 1200 },
    });
    expect(res.statusCode).toBe(201);
    incidentId = res.json().data.id;
    expect(res.json().data.status).toBe("detected");
  });

  it("rejects an illegal skip transition", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/admin/security-incidents/${incidentId}/transition`,
      headers: auth(REPORTER), payload: { toStatus: "resolved" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("INVALID_TRANSITION");
  });

  it("walks triaged→contained→resolved and records a timeline", async () => {
    for (const toStatus of ["triaged", "contained", "resolved"]) {
      const res = await app.inject({
        method: "POST", url: `/v1/admin/security-incidents/${incidentId}/transition`,
        headers: auth(REPORTER), payload: { toStatus, note: `moved to ${toStatus}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.status).toBe(toStatus);
    }
    const detail = await app.inject({ method: "GET", url: `/v1/admin/security-incidents/${incidentId}`, headers: auth(REPORTER) });
    expect(detail.json().data.status).toBe("resolved");
    expect(detail.json().data.resolvedAt).toBeTruthy();
    expect(detail.json().data.timeline.length).toBeGreaterThanOrEqual(4);
  });

  it("blocks the reporter from closing their own incident", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/admin/security-incidents/${incidentId}/close`,
      headers: auth(REPORTER), payload: { note: "self close attempt" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("MAKER_CHECKER");
  });

  it("allows a different admin to close (checker)", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/admin/security-incidents/${incidentId}/close`,
      headers: auth(CHECKER), payload: { note: "reviewed and closed" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe("closed");
  });
});

describe("breach notification (integration)", () => {
  let incidentId: string;

  it("creates a breach incident + statutory notification with a computed deadline", async () => {
    const create = await app.inject({
      method: "POST", url: "/v1/admin/security-incidents", headers: auth(REPORTER),
      payload: { title: "PII disclosure", severity: "critical", isBreach: true, affectedDataPrincipals: 5000 },
    });
    incidentId = create.json().data.id;
    const notif = await app.inject({
      method: "POST", url: `/v1/admin/security-incidents/${incidentId}/breach-notifications`,
      headers: auth(REPORTER), payload: { authority: "data_protection_board", affectedCount: 5000, windowHours: 72 },
    });
    expect(notif.statusCode).toBe(201);
    expect(notif.json().data.authority).toBe("data_protection_board");
    expect(new Date(notif.json().data.deadlineAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("marks the notification submitted with an authority reference", async () => {
    const detail = await app.inject({ method: "GET", url: `/v1/admin/security-incidents/${incidentId}`, headers: auth(REPORTER) });
    const nid = detail.json().data.breachNotifications[0].id;
    const submit = await app.inject({
      method: "POST", url: `/v1/admin/security-incidents/${incidentId}/breach-notifications/${nid}/submit`,
      headers: auth(CHECKER), payload: { reference: "DPB/2026/00042" },
    });
    expect(submit.statusCode).toBe(200);
    expect(submit.json().data.status).toBe("submitted");
    expect(submit.json().data.onTime).toBe(true);
  });

  it("lists overdue breach notifications endpoint", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/security-incidents/breach/overdue", headers: auth(REPORTER) });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().data)).toBe(true);
  });
});

// Finding 1 (PR #171 review) — Option (a): windowHours is not caller-adjustable.
// The statutory DPDP §8(6) window is fixed at 72h; the deadline is always
// detectedAt+72h and a caller-supplied windowHours>72 is ignored (clamped to 72),
// so an incident admin cannot silently self-extend the compliance clock.
describe("breach deadline is hard-capped at DPDP §8(6) 72h", () => {
  const HOURS_72_MS = 72 * 3_600_000;

  async function createBreachIncident(): Promise<{ id: string; detectedAt: string }> {
    const create = await app.inject({
      method: "POST", url: "/v1/admin/security-incidents", headers: auth(REPORTER),
      payload: { title: "statutory window incident", severity: "critical", isBreach: true },
    });
    const id = create.json().data.id;
    const detail = await app.inject({ method: "GET", url: `/v1/admin/security-incidents/${id}`, headers: auth(REPORTER) });
    return { id, detectedAt: detail.json().data.detectedAt };
  }

  it("persists the deadline as detectedAt + 72h (no windowHours accepted)", async () => {
    const { id, detectedAt } = await createBreachIncident();
    const notif = await app.inject({
      method: "POST", url: `/v1/admin/security-incidents/${id}/breach-notifications`,
      headers: auth(REPORTER), payload: { authority: "data_protection_board", affectedCount: 10 },
    });
    expect(notif.statusCode).toBe(201);
    const gap = new Date(notif.json().data.deadlineAt).getTime() - new Date(detectedAt).getTime();
    expect(gap).toBe(HOURS_72_MS);
  });

  it("clamps a caller trying windowHours>72 back to the 72h ceiling", async () => {
    const { id, detectedAt } = await createBreachIncident();
    const notif = await app.inject({
      method: "POST", url: `/v1/admin/security-incidents/${id}/breach-notifications`,
      // 720h (30 days) attempt — the extra key is stripped and the window stays 72h.
      headers: auth(REPORTER), payload: { authority: "data_protection_board", affectedCount: 10, windowHours: 720 },
    });
    expect(notif.statusCode).toBe(201);
    const gap = new Date(notif.json().data.deadlineAt).getTime() - new Date(detectedAt).getTime();
    expect(gap).toBe(HOURS_72_MS);
    // and it is persisted as 72h, not 720h
    const detail = await app.inject({ method: "GET", url: `/v1/admin/security-incidents/${id}`, headers: auth(REPORTER) });
    expect(detail.json().data.breachNotifications[0].windowHours).toBe(72);
  });
});

describe("tenant isolation (RLS)", () => {
  it("does not leak incidents across tenants", async () => {
    const mine = await app.inject({
      method: "POST", url: "/v1/admin/security-incidents", headers: auth(REPORTER),
      payload: { title: "tenant A only", severity: "low" },
    });
    const id = mine.json().data.id;
    const cross = await app.inject({ method: "GET", url: `/v1/admin/security-incidents/${id}`, headers: auth(REPORTER, OTHER_TENANT) });
    expect(cross.statusCode).toBe(404);
    const list = await app.inject({ method: "GET", url: "/v1/admin/security-incidents", headers: auth(REPORTER, OTHER_TENANT) });
    expect(list.json().data.find((i: { id: string }) => i.id === id)).toBeUndefined();
  });

  it("requires an admin role", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/security-incidents",
      headers: auth(REPORTER, TENANT, ["viewer"]), payload: { title: "x", severity: "low" },
    });
    expect(res.statusCode).toBe(403);
  });
});
