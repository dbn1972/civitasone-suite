/**
 * The dashboard cache holds one entry per fiscal year (dashboard:summary:<fy|all>).
 * finance.dashboard.refresh must drop ALL of them, not just one exact key.
 */
import { describe, it, expect, vi } from "vitest";

const { handlers } = vi.hoisted(() => ({ handlers: new Map<string, (msg: unknown) => Promise<void>>() }));
vi.mock("../src/shared/db.js", () => ({
  db: { transaction: async (fn: (tx: unknown) => Promise<void>) => { await fn({}); } },
  scopedRead: async (fn: (tx: unknown) => unknown) => fn({}),
}));
vi.mock("../src/shared/outbox.js", () => ({
  enqueue: vi.fn(async () => undefined),
  markProcessed: vi.fn(async () => true),
}));

import { cache } from "../src/shared/infra.js";
import { registerDashboardConsumers } from "../src/modules/dashboard/consumer.js";

describe("finance.dashboard.refresh cache invalidation", () => {
  it("drops every per-FY dashboard entry for the tenant, and only that tenant", async () => {
    const T = "aaaaaaaa-0000-4000-8000-0000000000d1";
    const OTHER = "aaaaaaaa-0000-4000-8000-0000000000d2";
    const keys = ["summary:all", "summary:2025-26", "summary:2026-27"].map((k) => cache.makeKey(T, "dashboard", k));
    const otherKey = cache.makeKey(OTHER, "dashboard", "summary:2026-27");
    for (const k of [...keys, otherKey]) await cache.put(k, { v: 1 }, 60);

    registerDashboardConsumers({ subscribe: (topic: string, h: (m: unknown) => Promise<void>) => { handlers.set(topic, h); } } as never);
    await handlers.get("finance.dashboard.refresh")!({ messageId: "m1", tenantId: T, actorId: "a", correlationId: "c", payload: { tenantId: T } });

    for (const k of keys) expect(await cache.getOrLoad(k, async () => null)).toBeNull();
    expect(await cache.getOrLoad(otherKey, async () => null)).toEqual({ v: 1 });
  });
});
