/**
 * GAP-ADMIN-DEVICES-04: audit-on-export for the admin device-trust CSV.
 *  - POST /v1/hrms/devices/export-audit is admin-only and publishes a command.
 *  - The consumer turns that command into an audit.event.record outbox row.
 * Same shape as loans-export-audit.test.ts (only the DB layer mocked).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import type { Queue } from "@civitasone/queue";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-0002-4000-8000-0000000000d7";
const tok = (roles: string[]) => signToken({ sub: "device-export-user", tid: TENANT, roles, sid: "sess-device-export" }, SECRET);

vi.mock("../shared/db.js", () => {
  const sqlClientFn = (..._a: unknown[]) => Promise.resolve([]);
  sqlClientFn.end = vi.fn(async () => {});
  sqlClientFn.unsafe = vi.fn((..._a: unknown[]) => Promise.resolve([]));
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

const post = (roles: string[], payload: unknown) =>
  app.inject({ method: "POST", url: "/v1/hrms/devices/export-audit", headers: { authorization: `Bearer ${tok(roles)}` }, payload: payload as object });

describe("POST /v1/hrms/devices/export-audit", () => {
  it("202 for an IT admin and publishes the export command", async () => {
    const spy = vi.spyOn(queue, "publish");
    const r = await post(["it_admin"], { rowCount: 12, filtered: true, filter: "pixel-secret" });
    expect(r.statusCode).toBe(202);
    const call = spy.mock.calls.find((c) => c[0] === COMMANDS.deviceExportRecorded);
    expect(call).toBeTruthy();
    expect((call![1] as { payload: Record<string, unknown> }).payload).toMatchObject({ rowCount: 12, filtered: true });
    expect(JSON.stringify(call![1])).not.toContain("pixel-secret");
  });

  it("403 for an ordinary employee", async () => {
    expect((await post(["employee"], { rowCount: 1 })).statusCode).toBe(403);
  });

  it("400 for a negative or missing rowCount", async () => {
    expect((await post(["hr_admin"], { rowCount: -1 })).statusCode).toBe(400);
    expect((await post(["hr_admin"], {})).statusCode).toBe(400);
  });
});

describe("device export consumer", () => {
  it("writes an audit.event.record outbox row with rowCount and filter", async () => {
    enqueueMock.mockClear();
    const handlers = new Map<string, (msg: unknown) => Promise<void>>();
    const q = { subscribe: (t: string, h: (msg: unknown) => Promise<void>) => { handlers.set(t, h); } } as unknown as Queue;
    registerDeviceTrustConsumers(q);
    await handlers.get(COMMANDS.deviceExportRecorded)!({
      messageId: "m-dev-export-1", type: COMMANDS.deviceExportRecorded, tenantId: TENANT, actorId: "a1",
      correlationId: "c1", schemaVersion: "1.0", payload: { rowCount: 7, filtered: true },
    });
    expect(enqueueMock).toHaveBeenCalledTimes(1);
    const arg = enqueueMock.mock.calls[0] as unknown as [unknown, { topic: string; payload: Record<string, unknown> }];
    expect(arg[1].topic).toBe("audit.event.record");
    expect(arg[1].payload).toMatchObject({ action: "export", resourceType: "device", rowCount: 7, filtered: true });
  });
});
