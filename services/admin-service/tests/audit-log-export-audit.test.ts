/**
 * GAP-ADMIN-AUDIT-LOG-03: audit-on-export for the platform audit-log CSV.
 *  - POST /v1/admin/audit-logs/export-audit is limited to audit-log readers and
 *    publishes a command (routes never write Postgres).
 *  - The consumer turns that command into an audit.event.record outbox row.
 * Only the DB layer is mocked, so no Postgres is needed.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import type { Queue } from "@civitasone/queue";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "bbbbbbbb-cccc-4000-8000-0000000000e1";
const tok = (roles: string[]) => signToken({ sub: "audit-export-user", tid: TENANT, roles, sid: "sess-audit-export" }, SECRET, 3600);

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

const enqueueMock = vi.fn(async () => {});
vi.mock("../src/shared/outbox.js", () => ({
  markProcessed: vi.fn(async () => true),
  enqueue: (...a: unknown[]) => (enqueueMock as (...x: unknown[]) => Promise<void>)(...a),
}));

import { buildApp } from "../src/app.js";
import { queue } from "../src/shared/infra.js";
import { sqlClient } from "../src/shared/db.js";
import { registerAuditLogExportConsumers } from "../src/modules/audit-log-export/consumer.js";
import { COMMANDS } from "../src/topics.js";

let app: FastifyInstance;
beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); await sqlClient.end(); });

const post = (roles: string[], payload: unknown) =>
  app.inject({ method: "POST", url: "/v1/admin/audit-logs/export-audit", headers: { authorization: `Bearer ${tok(roles)}` }, payload: payload as object });

describe("POST /v1/admin/audit-logs/export-audit", () => {
  it("202 for an audit officer and publishes the export command", async () => {
    const spy = vi.spyOn(queue, "publish");
    const r = await post(["audit_officer"], { rowCount: 200, filtered: true, filter: "secret-search" });
    expect(r.statusCode).toBe(202);
    const call = spy.mock.calls.find((c) => c[0] === COMMANDS.auditLogExportRecorded);
    expect(call).toBeTruthy();
    expect((call![1] as { payload: Record<string, unknown> }).payload).toMatchObject({ rowCount: 200, filtered: true });
    expect(JSON.stringify(call![1])).not.toContain("secret-search");
  });

  it("403 for a tenant_admin (not an audit-log reader)", async () => {
    expect((await post(["tenant_admin"], { rowCount: 1 })).statusCode).toBe(403);
  });

  it("400 for a negative or missing rowCount", async () => {
    expect((await post(["super_admin"], { rowCount: -1 })).statusCode).toBe(400);
    expect((await post(["super_admin"], {})).statusCode).toBe(400);
  });
});

describe("audit-log export consumer", () => {
  it("writes an audit.event.record outbox row with rowCount and filter", async () => {
    enqueueMock.mockClear();
    const handlers = new Map<string, (msg: unknown) => Promise<void>>();
    const q = { subscribe: (t: string, h: (msg: unknown) => Promise<void>) => { handlers.set(t, h); } } as unknown as Queue;
    registerAuditLogExportConsumers(q);
    await handlers.get(COMMANDS.auditLogExportRecorded)!({
      messageId: "m-audit-export-1", type: COMMANDS.auditLogExportRecorded, tenantId: TENANT, actorId: "a1",
      correlationId: "c1", schemaVersion: "1.0", payload: { rowCount: 7, filtered: true },
    });
    expect(enqueueMock).toHaveBeenCalledTimes(1);
    const arg = enqueueMock.mock.calls[0] as unknown as [unknown, { topic: string; payload: Record<string, unknown> }];
    expect(arg[1].topic).toBe("audit.event.record");
    expect(arg[1].payload).toMatchObject({ action: "export", resourceType: "audit_log", rowCount: 7, filtered: true });
  });

  it("does not swallow a failed audit write (the message must fail so it is redelivered)", async () => {
    enqueueMock.mockRejectedValueOnce(new Error("outbox down"));
    const handlers = new Map<string, (msg: unknown) => Promise<void>>();
    const q = { subscribe: (t: string, h: (msg: unknown) => Promise<void>) => { handlers.set(t, h); } } as unknown as Queue;
    registerAuditLogExportConsumers(q);
    await expect(handlers.get(COMMANDS.auditLogExportRecorded)!({
      messageId: "m-audit-export-2", type: COMMANDS.auditLogExportRecorded, tenantId: TENANT, actorId: "a1",
      correlationId: "c1", schemaVersion: "1.0", payload: { rowCount: 1 },
    })).rejects.toThrow("outbox down");
  });
});
