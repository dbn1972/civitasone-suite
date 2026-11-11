import { describe, it, expect, beforeEach, vi } from "vitest";
import type { CommandEnvelope } from "@civitasone/queue";

const H = vi.hoisted(() => ({
  wheres: [] as unknown[],
  sets: [] as Array<Record<string, unknown>>,
  enqueued: [] as Array<{ tenantId: unknown; payload: Record<string, unknown> }>,
  selectQueue: [] as unknown[][],
}));

vi.mock("../src/shared/db.js", () => {
  const chain = (rows: () => unknown[]) => {
    const c: Record<string, unknown> = {};
    c.from = () => c;
    c.where = (w: unknown) => { H.wheres.push(w); return c; };
    c.orderBy = async () => rows();
    return c;
  };
  const tx = {
    select: () => chain(() => H.selectQueue.shift() ?? []),
    update: () => ({ set: (v: Record<string, unknown>) => { H.sets.push(v); return { where: async (w: unknown) => { H.wheres.push(w); } }; } }),
  };
  return { db: { transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx) } };
});
vi.mock("../src/shared/infra.js", () => ({
  cache: { invalidateResource: vi.fn(async () => undefined), invalidate: vi.fn(async () => undefined), makeKey: () => "k" },
}));
vi.mock("../src/shared/outbox.js", () => ({
  markProcessed: vi.fn(async () => true),
  versionedUpdate: vi.fn(),
  enqueue: vi.fn(async (_tx: unknown, e: { tenantId: unknown; payload: Record<string, unknown> }) => { H.enqueued.push(e); }),
}));

import { registerIntegrationConsumers } from "../src/modules/integration/consumer.js";
import { CONSUMED_EVENTS } from "../src/topics.js";

function boundValues(q: unknown): unknown[] {
  const out: unknown[] = [];
  const walk = (c: unknown): void => {
    if (typeof c === "string") out.push(c);
    else if (c && typeof c === "object") {
      const o = c as { queryChunks?: unknown[]; value?: unknown; constructor?: { name?: string } };
      if (Array.isArray(o.queryChunks)) o.queryChunks.forEach(walk);
      else if (o.constructor?.name === "Param") out.push(o.value);
    }
  };
  walk(q);
  return out;
}

const TENANT = "8dcb509d-1a2e-41dc-8dbd-61a3a11b9d93";
const EMP = "5f0c2b6e-3a41-4d0e-9a52-7c1d8e4b9a10";
const handlers = new Map<string, (m: CommandEnvelope<any>) => Promise<void>>();
registerIntegrationConsumers((t, h) => handlers.set(t, h as never));

const envelope = (payload: Record<string, unknown>) =>
  ({ messageId: "m-1", type: CONSUMED_EVENTS.hrmsEmployeeSeparated, tenantId: TENANT, actorId: "a", correlationId: "c", schemaVersion: "1.0", payload }) as CommandEnvelope<any>;

/**
 * REGRESSION (UAT 9 Nov): hrms-service publishes hrms.employee.separated with the tenant on the ENVELOPE
 * and the date as `effectiveDate`; the payload has no tenantId/separationDate. The handler read
 * p.tenantId (undefined -> drizzle UNDEFINED_VALUE) so committee memberships never ended.
 */
describe("meeting: hrms.employee.separated honours the real hrms payload contract", () => {
  beforeEach(() => { H.wheres.length = 0; H.sets.length = 0; H.enqueued.length = 0; H.selectQueue.length = 0; });

  it("uses the envelope tenant and payload.effectiveDate", async () => {
    H.selectQueue.push([{ id: "7a1b2c3d-0000-4000-8000-000000000001", committeeId: "7a1b2c3d-0000-4000-8000-0000000000c1" }], []);
    await handlers.get(CONSUMED_EVENTS.hrmsEmployeeSeparated)!(
      envelope({ employeeId: EMP, separationType: "retirement", effectiveDate: "2026-10-31" }),
    );

    for (const w of H.wheres) expect(boundValues(w)).not.toContain(undefined);
    expect(boundValues(H.wheres[0])).toContain(TENANT);
    expect(H.sets).toHaveLength(1);
    expect(H.sets[0]).toMatchObject({ status: "expired", tenureEnd: "2026-10-31" });
    expect(H.enqueued[0]!.tenantId).toBe(TENANT);
    expect(H.enqueued[0]!.payload).toMatchObject({ memberId: EMP, expiredOn: "2026-10-31" });
  });

  it("prefers separationDate when present", async () => {
    H.selectQueue.push([{ id: "7a1b2c3d-0000-4000-8000-000000000001", committeeId: "7a1b2c3d-0000-4000-8000-0000000000c1" }], []);
    await handlers.get(CONSUMED_EVENTS.hrmsEmployeeSeparated)!(
      envelope({ employeeId: EMP, separationDate: "2026-11-02", effectiveDate: "2026-10-31" }),
    );
    expect(H.sets[0]).toMatchObject({ tenureEnd: "2026-11-02" });
  });
});
