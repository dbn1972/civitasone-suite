/**
 * GAP2-ADMIN-DEVICES-01: audit-on-reveal of a device's clear IP.
 *  - POST /v1/hrms/devices/reveal-ip is admin-only (same roles as the device list),
 *    404s for a device the tenant never registered, and publishes a command.
 *  - The consumer turns that command into an audit.event.record outbox row.
 * Only the DB layer is mocked (same shape as device-export-audit.test.ts).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import type { Queue } from "@civitasone/queue";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-0002-4000-8000-0000000000d8";
const DEVICE = "pixel-8-asha-7f3c21";
const tok = (roles: string[]) => signToken({ sub: "device-reveal-user", tid: TENANT, roles, sid: "sess-device-reveal" }, SECRET);

const deviceRows = vi.hoisted(() => ({ rows: [{ "?column?": 1 }] as unknown[] }));

vi.mock("../shared/db.js", () => {
  const sqlClientFn = (..._a: unknown[]) => Promise.resolve([]);
  sqlClientFn.end = vi.fn(async () => {});
  sqlClientFn.unsafe = vi.fn((..._a: unknown[]) => Promise.resolve(deviceRows.rows));
  sqlClientFn.begin = vi.fn(async (fn: (tx: typeof sqlClientFn) => Promise<unknown>) => fn(sqlClientFn));
  return {
    db: { transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb({}) },
    sqlClient: sqlClientFn,
    scopedRead: async () => [],
  };
});

const enqueueMock = vi.fn(async () => {});
vi.mock("../shared/outbox.js", () => ({
  markProcessed: vi.fn(async () => true),
  enqueue: (...a: unknown[]) => (enqueueMock as (...x: unknown[]) => Promise<void>)(...a),
}));

import { buildApp } from "../app.js";
import { queue } from "../shared/infra.js";
import { sqlClient } from "../shared/db.js";
import { registerDeviceTrustConsumers } from "../modules/device-trust/consumer.js";
import { COMMANDS } from "../topics.js";

let app: FastifyInstance;
beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); await sqlClient.end(); });
beforeEach(() => { deviceRows.rows = [{ "?column?": 1 }]; });

const post = (roles: string[], payload: unknown) =>
  app.inject({ method: "POST", url: "/v1/hrms/devices/reveal-ip", headers: { authorization: `Bearer ${tok(roles)}` }, payload: payload as object });

describe("POST /v1/hrms/devices/reveal-ip", () => {
  it("202 for an IT admin and publishes the reveal command with the device id", async () => {
    const spy = vi.spyOn(queue, "publish");
    const r = await post(["it_admin"], { deviceId: DEVICE });
    expect(r.statusCode).toBe(202);
    const call = spy.mock.calls.find((c) => c[0] === COMMANDS.deviceIpRevealed);
    expect(call).toBeTruthy();
    expect((call![1] as { payload: Record<string, unknown> }).payload).toMatchObject({ deviceId: DEVICE });
  });

  it("403 for an ordinary employee", async () => {
    expect((await post(["employee"], { deviceId: DEVICE })).statusCode).toBe(403);
  });

  it("400 for a missing or too-short device id", async () => {
    expect((await post(["hr_admin"], {})).statusCode).toBe(400);
    expect((await post(["hr_admin"], { deviceId: "ab" })).statusCode).toBe(400);
  });

  it("404 and no audit command for a device this tenant never registered", async () => {
    deviceRows.rows = [];
    const spy = vi.spyOn(queue, "publish");
    spy.mockClear();
    const r = await post(["super_admin"], { deviceId: "unknown-device-00000" });
    expect(r.statusCode).toBe(404);
    expect(spy.mock.calls.find((c) => c[0] === COMMANDS.deviceIpRevealed)).toBeUndefined();
  });
});

describe("device IP reveal consumer", () => {
  it("writes an audit.event.record outbox row naming the device", async () => {
    enqueueMock.mockClear();
    const handlers = new Map<string, (msg: unknown) => Promise<void>>();
    const q = { subscribe: (t: string, h: (msg: unknown) => Promise<void>) => { handlers.set(t, h); } } as unknown as Queue;
    registerDeviceTrustConsumers(q);
    await handlers.get(COMMANDS.deviceIpRevealed)!({
      messageId: "m-dev-reveal-1", type: COMMANDS.deviceIpRevealed, tenantId: TENANT, actorId: "a1",
      correlationId: "c1", schemaVersion: "1.0", payload: { deviceId: DEVICE },
    });
    expect(enqueueMock).toHaveBeenCalledTimes(1);
    const arg = enqueueMock.mock.calls[0] as unknown as [unknown, { topic: string; payload: Record<string, unknown> }];
    expect(arg[1].topic).toBe("audit.event.record");
    expect(arg[1].payload).toMatchObject({ action: "reveal_ip", resourceType: "device", resourceId: DEVICE });
  });
});
