/**
 * Owner decision D4c #34 (GAP-PROJECTS-DPR-TRACKING-02): a DPR estimated cost is
 * stored as whole paise (bigint) like every other money field. The list route
 * used to return the placeholder string "—" for every row.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import { MemoryQueue } from "@civitasone/queue";

const H = vi.hoisted(() => ({
  dprs: [] as Array<Record<string, unknown>>,
  publish: vi.fn(async () => undefined),
  insertDpr: vi.fn(async () => undefined),
}));

vi.mock("../src/shared/context.js", () => ({
  resolveContext: () => ({ tenantId: "t1", roles: ["project_manager"] }),
  requireRole: () => undefined,
}));
vi.mock("../src/shared/infra.js", () => ({
  cache: {
    makeKey: (...p: string[]) => p.join(":"),
    getOrLoad: async (_k: string, loader: () => Promise<unknown>) => loader(),
    invalidate: vi.fn(async () => undefined),
  },
  queue: { publish: (...a: unknown[]) => (H.publish as any)(...a) },
}));
vi.mock("../src/modules/escalation/repo.js", () => ({}));
vi.mock("../src/shared/outbox.js", () => ({
  enqueue: vi.fn(async () => undefined),
  markProcessed: vi.fn(async () => true),
}));
vi.mock("../src/modules/progress/repo.js", () => ({
  findDprByProjectAndDate: vi.fn(async () => null),
  insertDpr: (...a: unknown[]) => (H.insertDpr as any)(...a),
}));
vi.mock("@civitasone/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@civitasone/db")>();
  return {
    ...actual,
    runWithTenant: async (_t: string, fn: () => Promise<unknown>) => fn(),
    withTenantConsumer: (handler: (msg: unknown) => Promise<void>) => handler,
  };
});
vi.mock("../src/shared/db.js", () => {
  const chain = (rows: unknown[]) => {
    const c: Record<string, unknown> = {};
    for (const m of ["from", "where", "orderBy", "limit"]) c[m] = () => c;
    c.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(rows).then(res, rej);
    return c;
  };
  const tx = {
    select: (fields: Record<string, unknown>) => ("dprNo" in fields ? chain(H.dprs) : chain([])),
  };
  return {
    db: { transaction: async (cb: (t: unknown) => Promise<unknown>) => cb(tx) },
  };
});

import { dprBody } from "../src/modules/progress/validators.js";
import { submitDpr } from "../src/modules/progress/commands.js";
import { registerProgressConsumers } from "../src/modules/progress/consumer.js";
import { mockEliminationRoutes } from "../src/modules/project/mock-elimination-routes.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "10000000-aaaa-4000-8000-000000000001";
const ACTOR = "20000000-bbbb-4000-8000-000000000001";

describe("DPR estimated cost (whole paise)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    H.dprs = [];
  });

  it("validator: accepts a non-negative whole number of paise, rejects negatives and fractions", () => {
    const base = { dprNo: "DPR-1", dprDate: "2026-10-01" };
    expect(dprBody.parse({ ...base, estimatedCostMinor: 12_500_000_000 }).estimatedCostMinor).toBe(12_500_000_000);
    expect(dprBody.parse(base).estimatedCostMinor).toBeUndefined();
    expect(dprBody.safeParse({ ...base, estimatedCostMinor: -1 }).success).toBe(false);
    expect(dprBody.safeParse({ ...base, estimatedCostMinor: 1.5 }).success).toBe(false);
  });

  it("command: carries the paise amount into the payload", async () => {
    const ctx = { tenantId: TENANT, actorId: ACTOR, correlationId: "c", roles: [] };
    await submitDpr(ctx as never, randomUUID(), { dprNo: "D", dprDate: "2026-10-01", content: {}, estimatedCostMinor: 5000 });
    const msg = (H.publish.mock.calls[0] as unknown as [string, { payload: Record<string, unknown> }])[1];
    expect(msg.payload.estimatedCostMinor).toBe(5000);
  });

  it("consumer: stores it as a bigint in the same insert, and null when none was given", async () => {
    const q = new MemoryQueue();
    registerProgressConsumers(q);
    await q.start();
    const send = (cost?: number) =>
      q.publish(COMMANDS.dprSubmit, {
        messageId: randomUUID(), type: COMMANDS.dprSubmit, tenantId: TENANT, actorId: ACTOR,
        correlationId: "c", schemaVersion: "1.0",
        payload: { id: randomUUID(), tenantId: TENANT, projectId: randomUUID(), dprNo: "D", dprDate: "2026-10-01", submittedBy: ACTOR, estimatedCostMinor: cost },
      });
    await send(12_500_000_000);
    await send(undefined);
    await new Promise((r) => setTimeout(r, 100));
    const rows = H.insertDpr.mock.calls.map((c) => (c as unknown as [unknown, Record<string, unknown>])[1]);
    expect(rows[0]!.estimatedCostMinor).toBe(12_500_000_000n);
    expect(rows[1]!.estimatedCostMinor).toBeNull();
    await q.stop();
  });

  it("list route: returns whole paise as a string, null when not recorded, and no placeholder", async () => {
    H.dprs = [
      { id: "d1", dprNo: "A", projectId: "p1", dprDate: "2026-10-01", status: "submitted", submittedBy: "u", estimatedCostMinor: 12_500_000_000n },
      { id: "d2", dprNo: "B", projectId: "p1", dprDate: "2026-10-02", status: "submitted", submittedBy: "u", estimatedCostMinor: null },
    ];
    const app = Fastify();
    await mockEliminationRoutes(app);
    const res = await app.inject({ method: "GET", url: "/v1/projects/dprs" });
    await app.close();
    const data = (res.json() as { data: Array<Record<string, unknown>> }).data;
    expect(data[0]!.estimatedCostMinor).toBe("12500000000");
    expect(data[1]!.estimatedCostMinor).toBeNull();
    expect(data[0]).not.toHaveProperty("estimatedCost");
  });
});
