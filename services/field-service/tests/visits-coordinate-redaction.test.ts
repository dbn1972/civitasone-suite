/**
 * GAP-FIELD-VISITS-03 / owner decision #35 (2026-10-26): the server returns
 * ROUNDED (3dp) coordinates only to permitted roles (field_admin, super_admin);
 * every other role gets no coordinates at all. Full precision is never sent
 * by the list/get endpoints (an audited full reveal is a later feature).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { signToken } from "@civitasone/auth";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-0001-4000-8000-000000000001";
const AGENT = "aaaaaaaa-1111-4000-8000-000000000001";
const VISIT = "bbbbbbbb-1111-4000-8000-000000000001";

const H = vi.hoisted(() => ({ visitList: vi.fn(), visitFind: vi.fn(), visitByAgent: vi.fn(), visitByTask: vi.fn() }));

vi.mock("../src/shared/db.js", () => ({
  db: { transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb({}) },
  scopedRead: async () => [],
  sqlClient: { end: async () => {} },
}));
vi.mock("../src/shared/outbox.js", () => ({ enqueue: vi.fn() }));
vi.mock("../src/shared/infra.js", () => ({
  cache: { getOrLoad: vi.fn(), invalidate: vi.fn(), makeKey: () => "k" },
  queue: { publish: vi.fn() },
}));
vi.mock("../src/modules/visits/repo.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/modules/visits/repo.js")>();
  return {
    ...actual,
    listRecent: (...a: unknown[]) => H.visitList(...a),
    findById: (...a: unknown[]) => H.visitFind(...a),
    findByAgent: (...a: unknown[]) => H.visitByAgent(...a),
    findByTaskId: (...a: unknown[]) => H.visitByTask(...a),
  };
});

import { buildApp } from "../src/app.js";

const auth = (sub: string, roles: string[]) => ({
  authorization: `Bearer ${signToken({ sub, tid: TENANT, roles, sid: "s" }, SECRET)}`,
});
const NOW = new Date("2026-08-27T12:00:00.000Z");
const row = {
  id: VISIT, tenantId: TENANT, taskId: VISIT, agentId: AGENT,
  checkInLatitude: "28.6139391", checkInLongitude: "77.2090212",
  checkOutLatitude: "28.6141999", checkOutLongitude: "77.2095555",
  checkInAt: NOW, checkOutAt: NOW, durationMinutes: 30, outcome: "completed", notes: null,
  photos: [], createdAt: NOW, updatedAt: NOW, createdBy: AGENT, updatedBy: AGENT, version: 1,
};

beforeEach(() => {
  Object.values(H).forEach((f) => f.mockReset());
  H.visitList.mockResolvedValue({ rows: [row], total: 1 });
  H.visitFind.mockResolvedValue(row);
  H.visitByAgent.mockResolvedValue({ rows: [row], total: 1 });
  H.visitByTask.mockResolvedValue({ rows: [row], total: 1 });
});

describe("visit coordinates are role-redacted server-side (decision #35)", () => {
  it("GET /v1/field/visits gives field_admin coordinates rounded to 3dp, never full precision", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/field/visits", headers: auth("u-admin", ["field_admin"]) });
    expect(res.statusCode).toBe(200);
    const v = res.json().data[0];
    expect(v.checkInLatitude).toBe("28.614");
    expect(v.checkInLongitude).toBe("77.209");
    expect(v.checkOutLatitude).toBe("28.614");
    expect(v.checkOutLongitude).toBe("77.210");
    expect(res.body).not.toContain("28.6139391");
    expect(res.body).not.toContain("77.2090212");
  });

  it("GET /v1/field/visits gives a plain field_agent NO coordinates", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/field/visits", headers: auth(AGENT, ["field_agent"]) });
    expect(res.statusCode).toBe(200);
    const v = res.json().data[0];
    expect(v.checkInLatitude).toBeNull();
    expect(v.checkInLongitude).toBeNull();
    expect(v.checkOutLatitude).toBeNull();
    expect(v.checkOutLongitude).toBeNull();
    expect(res.body).not.toContain("28.61");
  });

  it("GET /v1/field/visits/:id redacts the same way", async () => {
    const app = await buildApp();
    const agentRes = await app.inject({ method: "GET", url: `/v1/field/visits/${VISIT}`, headers: auth(AGENT, ["field_agent"]) });
    expect(agentRes.json().data.checkInLatitude).toBeNull();
    const adminRes = await app.inject({ method: "GET", url: `/v1/field/visits/${VISIT}`, headers: auth("u-admin", ["super_admin"]) });
    expect(adminRes.json().data.checkInLatitude).toBe("28.614");
  });

  it("by-agent and by-task histories redact too", async () => {
    const app = await buildApp();
    const a = await app.inject({ method: "GET", url: `/v1/field/visits/by-agent/${AGENT}`, headers: auth(AGENT, ["field_agent"]) });
    expect(a.json().data[0].checkInLongitude).toBeNull();
    const t = await app.inject({ method: "GET", url: `/v1/field/visits/by-task/${VISIT}`, headers: auth("u-admin", ["field_admin"]) });
    expect(t.json().data[0].checkInLongitude).toBe("77.209");
  });
});
