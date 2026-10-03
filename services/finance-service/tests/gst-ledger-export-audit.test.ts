/**
 * GAP-FINANCE-GST-05: audit-on-export for the GST ledger CSV.
 *  - POST /v1/finance/gst/ledger/export-audit is finance-roles only and publishes a command
 *    (routes never write the DB).
 *  - The consumer turns that command into an audit.event.record outbox row.
 * Only the DB layer is mocked (same shape as the hrms loans-export-audit test).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import type { Queue } from "@civitasone/queue";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-0003-4000-8000-0000000000b7";
const tok = (roles: string[]) => signToken({ sub: "gst-export-user", tid: TENANT, roles, sid: "sess-gst-export" }, SECRET);

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
import { registerGstConsumers } from "../src/modules/gst/consumer.js";
import { GST_LEDGER_EXPORT_TOPIC } from "../src/modules/gst/commands.js";

let app: FastifyInstance;
beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); await sqlClient.end(); });

const post = (roles: string[], payload: unknown) =>
  app.inject({ method: "POST", url: "/v1/finance/gst/ledger/export-audit", headers: { authorization: `Bearer ${tok(roles)}` }, payload: payload as object });

describe("POST /v1/finance/gst/ledger/export-audit", () => {
  it("202 for finance and publishes the export command", async () => {
    const spy = vi.spyOn(queue, "publish");
    const r = await post(["finance_officer"], { period: "2026-06", rowCount: 12, filtered: true });
    expect(r.statusCode).toBe(202);
    const call = spy.mock.calls.find((c) => c[0] === GST_LEDGER_EXPORT_TOPIC);
    expect(call).toBeTruthy();
    expect((call![1] as { payload: Record<string, unknown> }).payload).toMatchObject({ period: "2026-06", rowCount: 12, filtered: true });
  });

  it("never carries the typed filter text (it can contain a GSTIN or party name)", async () => {
    const spy = vi.spyOn(queue, "publish");
    await post(["finance_officer"], { period: "2026-06", rowCount: 1, filtered: true, filter: "27AAAAA0000A1Z5" });
    const call = spy.mock.calls.filter((c) => c[0] === GST_LEDGER_EXPORT_TOPIC).pop();
    expect(JSON.stringify(call![1])).not.toContain("27AAAAA0000A1Z5");
  });

  it("403 for a role outside the finance roles", async () => {
    expect((await post(["employee"], { period: "2026-06", rowCount: 1 })).statusCode).toBe(403);
  });

  it("400 for a bad period or a negative rowCount", async () => {
    expect((await post(["finance_admin"], { period: "2026-13", rowCount: 1 })).statusCode).toBe(400);
    expect((await post(["finance_admin"], { period: "2026-06", rowCount: -1 })).statusCode).toBe(400);
  });
});

describe("gst ledger export consumer", () => {
  it("writes an audit.event.record outbox row with the period, rowCount and filtered flag", async () => {
    const handlers = new Map<string, (msg: unknown) => Promise<void>>();
    const q = { subscribe: (t: string, h: (msg: unknown) => Promise<void>) => { handlers.set(t, h); } } as unknown as Queue;
    registerGstConsumers(q);
    await handlers.get(GST_LEDGER_EXPORT_TOPIC)!({
      messageId: "m-gst-export-1", type: GST_LEDGER_EXPORT_TOPIC, tenantId: TENANT, actorId: "a1",
      correlationId: "c1", schemaVersion: "1.0", payload: { id: "x", period: "2026-06", rowCount: 7, filtered: true },
    });
    expect(enqueueMock).toHaveBeenCalledTimes(1);
    const arg = enqueueMock.mock.calls[0] as unknown as [unknown, { topic: string; payload: Record<string, unknown> }];
    expect(arg[1].topic).toBe("audit.event.record");
    expect(arg[1].payload).toMatchObject({ service: "finance", action: "export", resourceType: "gst_ledger", resourceId: "2026-06", rowCount: 7, filtered: true });
  });
});
