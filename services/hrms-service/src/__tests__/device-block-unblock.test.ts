/**
 * GAP-ADMIN-DEVICES-03 review fixes: block needs a real reason (3-200 chars, no
 * default), 404s when no row matches, unblock is logged and never restores a
 * rooted / still-flagged device straight to 'trusted'. Only the DB layer is mocked.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-0002-4000-8000-0000000000d8";
const DEVICE = "bbbbbbbb-0002-4000-8000-0000000000d1";
const tok = (roles: string[]) => signToken({ sub: "device-admin", tid: TENANT, roles, sid: "sess-device-admin" }, SECRET);

const unsafeMock = vi.hoisted(() => vi.fn());
vi.mock("../shared/db.js", () => {
  const sqlClientFn = (..._a: unknown[]) => Promise.resolve([]);
  sqlClientFn.end = vi.fn(async () => {});
  sqlClientFn.unsafe = unsafeMock;
  sqlClientFn.begin = vi.fn(async (fn: (tx: typeof sqlClientFn) => Promise<unknown>) => fn(sqlClientFn));
  return {
    db: { transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb({}) },
    sqlClient: sqlClientFn,
    scopedRead: async () => [],
  };
});
vi.mock("../shared/outbox.js", () => ({ markProcessed: vi.fn(async () => true), enqueue: vi.fn(async () => {}) }));

import { buildApp } from "../app.js";
import { sqlClient } from "../shared/db.js";

let app: FastifyInstance;
beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); await sqlClient.end(); });

const call = (action: "block" | "unblock", roles: string[], payload?: unknown, id = DEVICE) =>
  app.inject({ method: "PATCH", url: `/v1/hrms/devices/${id}/${action}`, headers: { authorization: `Bearer ${tok(roles)}` }, ...(payload !== undefined ? { payload: payload as object } : {}) });

const sqls = () => unsafeMock.mock.calls.map((c) => String(c[0]));
const deviceSqls = () => sqls().filter((q) => q.includes("trusted_devices") || q.includes("device_activity_log"));
const isUpdate = (q: unknown) => String(q).includes("UPDATE hrms.trusted_devices");

describe("PATCH /v1/hrms/devices/:id/block", () => {
  beforeEach(() => unsafeMock.mockReset());

  it("400 without a reason, and with a too-short / whitespace-only / too-long one; nothing is written", async () => {
    for (const body of [{}, { reason: "ab" }, { reason: "     " }, { reason: "x".repeat(201) }]) {
      expect((await call("block", ["it_admin"], body)).statusCode).toBe(400);
    }
    expect(deviceSqls()).toEqual([]);
  });

  it("404 when the update affects no row, and no activity is logged", async () => {
    unsafeMock.mockResolvedValue([]);
    expect((await call("block", ["it_admin"], { reason: "Lost phone" })).statusCode).toBe(404);
    expect(sqls().some((q) => q.includes("device_activity_log"))).toBe(false);
  });

  it("stores the trimmed reason and logs the block", async () => {
    unsafeMock.mockImplementation(async (q: unknown) => (isUpdate(q) ? [{ device_id: "dev-1", user_id: "u1" }] : []));
    const r = await call("block", ["it_admin"], { reason: "  Lost phone  " });
    expect(r.statusCode).toBe(200);
    const update = unsafeMock.mock.calls.find((c) => isUpdate(c[0]))!;
    expect((update[1] as unknown[])[1]).toBe("Lost phone");
    expect(sqls().some((q) => q.includes("device_activity_log") && q.includes("'blocked'"))).toBe(true);
  });

  it("403 for an ordinary employee", async () => {
    expect((await call("block", ["employee"], { reason: "Lost phone" })).statusCode).toBe(403);
  });
});

describe("PATCH /v1/hrms/devices/:id/unblock", () => {
  beforeEach(() => unsafeMock.mockReset());

  it("404 when the device is not blocked / not found", async () => {
    unsafeMock.mockResolvedValue([]);
    expect((await call("unblock", ["hr_admin"])).statusCode).toBe(404);
  });

  it("logs the unblock and reports the restored status; SQL never hard-codes 'trusted' for rooted/flagged devices", async () => {
    unsafeMock.mockImplementation(async (q: unknown) => (isUpdate(q) ? [{ device_id: "dev-1", user_id: "u1", trust_status: "flagged" }] : []));
    const r = await call("unblock", ["hr_admin"]);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ id: DEVICE, status: "flagged" });
    const update = sqls().find((q) => q.includes("UPDATE hrms.trusted_devices"))!;
    expect(update).toMatch(/is_rooted IS TRUE OR COALESCE\(flagged_reason/);
    expect(update).toMatch(/THEN 'flagged' ELSE 'trusted'/);
    expect(sqls().some((q) => q.includes("device_activity_log") && q.includes("'unblocked'"))).toBe(true);
  });
});
