/**
 * GAP-HR-LOANS-02: audit-on-export for the HR loans CSV.
 *  - POST /v1/hrms/loans/export-audit is HR-roles only and publishes a command.
 *  - The consumer turns that command into an audit.event.record outbox row.
 * Pattern: buildApp() + app.inject() with only the DB layer mocked, like
 * employee-directory-role-gate.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import type { Queue } from "@civitasone/queue";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-0002-4000-8000-0000000000b6";
const tok = (roles: string[]) => signToken({ sub: "loans-export-user", tid: TENANT, roles, sid: "sess-loans-export" }, SECRET);

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
import { registerLoanConsumers } from "../modules/employee/loans-consumer.js";
import { COMMANDS } from "../topics.js";

let app: FastifyInstance;
beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); await sqlClient.end(); });

const post = (roles: string[], payload: unknown) =>
  app.inject({ method: "POST", url: "/v1/hrms/loans/export-audit", headers: { authorization: `Bearer ${tok(roles)}` }, payload: payload as object });

describe("POST /v1/hrms/loans/export-audit", () => {
  it("202 for HR and publishes the export command", async () => {
    const spy = vi.spyOn(queue, "publish");
    const r = await post(["hr_officer"], { rowCount: 12, filter: "emp" });
    expect(r.statusCode).toBe(202);
    const call = spy.mock.calls.find((c) => c[0] === COMMANDS.loanExportRecorded);
    expect(call).toBeTruthy();
    expect((call![1] as { payload: Record<string, unknown> }).payload).toMatchObject({ rowCount: 12, filter: "emp" });
  });

  it("403 for a manager (can view loans, cannot export)", async () => {
    expect((await post(["manager"], { rowCount: 1 })).statusCode).toBe(403);
  });

  it("400 for a negative or missing rowCount", async () => {
    expect((await post(["hr_admin"], { rowCount: -1 })).statusCode).toBe(400);
    expect((await post(["hr_admin"], {})).statusCode).toBe(400);
  });
});

describe("loan export consumer", () => {
  it("writes an audit.event.record outbox row with rowCount and filter", async () => {
    const handlers = new Map<string, (msg: unknown) => Promise<void>>();
    const q = { subscribe: (t: string, h: (msg: unknown) => Promise<void>) => { handlers.set(t, h); } } as unknown as Queue;
    registerLoanConsumers(q);
    await handlers.get(COMMANDS.loanExportRecorded)!({
      messageId: "m-export-1", type: COMMANDS.loanExportRecorded, tenantId: TENANT, actorId: "a1",
      correlationId: "c1", schemaVersion: "1.0", payload: { rowCount: 7, filter: "x" },
    });
    expect(enqueueMock).toHaveBeenCalledTimes(1);
    const arg = enqueueMock.mock.calls[0] as unknown as [unknown, { topic: string; payload: Record<string, unknown> }];
    expect(arg[1].topic).toBe("audit.event.record");
    expect(arg[1].payload).toMatchObject({ action: "export", resourceType: "loan", rowCount: 7, filter: "x" });
  });
});
