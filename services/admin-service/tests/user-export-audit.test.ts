/**
 * GAP-ADMIN-USERS-06: POST /v1/admin/user-exports/audit records a
 * user_directory.exported audit event, tenant_admin+ only. DB layer mocked
 * (same pattern as hrms-service loans-export-audit.test.ts).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-0002-4000-8000-0000000000b7";
const tok = (roles: string[]) => signToken({ sub: "export-user", tid: TENANT, roles, sid: "sess-user-export" }, SECRET);

vi.mock("../src/shared/db.js", () => {
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

const enqueueMock = vi.fn(async (..._a: unknown[]) => {});
vi.mock("../src/shared/outbox.js", () => ({
  markProcessed: vi.fn(async () => true),
  enqueue: (...a: unknown[]) => enqueueMock(...a),
}));

import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { COMMANDS } from "../src/topics.js";
import { registerUserExportConsumers } from "../src/modules/user-export/consumer.js";

let app: FastifyInstance;
beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); await sqlClient.end(); });

const post = (roles: string[], payload: unknown) =>
  app.inject({ method: "POST", url: "/v1/admin/user-exports/audit", headers: { authorization: `Bearer ${tok(roles)}` }, payload: payload as object });

describe("POST /v1/admin/user-exports/audit", () => {
  it("202 for a tenant admin and publishes the export command", async () => {
    const spy = vi.spyOn(queue, "publish");
    const r = await post(["tenant_admin"], { rowCount: 12, filter: "Active" });
    expect(r.statusCode).toBe(202);
    expect(r.json()).toMatchObject({ status: "accepted" });
    const call = spy.mock.calls.find((c) => c[0] === COMMANDS.userExportRecorded);
    expect(call).toBeTruthy();
    expect((call![1] as { payload: Record<string, unknown> }).payload).toMatchObject({ rowCount: 12, filter: "Active" });
  });

  it("403 for a non-admin and nothing is published", async () => {
    const spy = vi.spyOn(queue, "publish");
    spy.mockClear();
    expect((await post(["viewer"], { rowCount: 1 })).statusCode).toBe(403);
    expect(spy).not.toHaveBeenCalled();
  });

  it("400 for a negative or over-limit rowCount", async () => {
    expect((await post(["tenant_admin"], { rowCount: -1 })).statusCode).toBe(400);
    expect((await post(["tenant_admin"], { rowCount: 201 })).statusCode).toBe(400);
  });
});

describe("user export consumer", () => {
  it("turns the command into a user_directory.exported audit outbox row", async () => {
    let handler: ((m: unknown) => Promise<void>) | undefined;
    registerUserExportConsumers({ subscribe: (_t: string, h: (m: unknown) => Promise<void>) => { handler = h; } } as never);
    enqueueMock.mockClear();
    await handler!({ messageId: "m1", tenantId: TENANT, actorId: "a", correlationId: "c", payload: { id: "m1", tenantId: TENANT, rowCount: 5, filter: "All" } });
    const call = enqueueMock.mock.calls.find((c) => (c[1] as { topic?: string }).topic === "audit.event.record");
    expect((call![1] as { payload: Record<string, unknown> }).payload).toMatchObject({ action: "user_directory.exported", resourceType: "user_directory" });
  });
});
