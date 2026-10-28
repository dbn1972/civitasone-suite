/**
 * UAT G2 #23 + #29 regressions (knowledge-service).
 *  - shares: expiresAt crosses the queue as an ISO string and must be parsed to a Date before insert
 *    (a string made the timestamp column throw, dead-lettering every share that had an expiry).
 *  - categories / retention-policies PUT must bump `version` (it stayed at 1 forever).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { COMMANDS } from "../src/topics.js";

const H = vi.hoisted(() => ({ shareInsert: vi.fn() }));

vi.mock("../src/shared/db.js", () => ({
  db: { transaction: vi.fn(async (fn: (tx: unknown) => Promise<void>) => fn({})) },
  sqlClient: { end: vi.fn() },
  scopedRead: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({})),
}));
vi.mock("../src/shared/outbox.js", () => ({
  markProcessed: vi.fn().mockResolvedValue(true),
  enqueue: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../src/shared/infra.js", () => ({
  cache: {
    put: vi.fn().mockResolvedValue(undefined),
    invalidate: vi.fn().mockResolvedValue(undefined),
    invalidateResource: vi.fn().mockResolvedValue(undefined),
    makeKey: (...a: string[]) => a.join(":"),
    listOrLoad: vi.fn(),
    getOrLoad: vi.fn(),
  },
  queue: { publish: vi.fn(), subscribe: vi.fn() },
}));
vi.mock("../src/modules/sharing/repo.js", () => ({
  insert: (...a: unknown[]) => H.shareInsert(...a),
  remove: vi.fn().mockResolvedValue(undefined),
  toView: (r: unknown) => r,
}));

import { registerSharingConsumers } from "../src/modules/sharing/consumer.js";
import * as categoriesRepo from "../src/modules/categories/repo.js";
import * as retentionRepo from "../src/modules/retention/repo.js";

function deliver(register: (q: never) => void, topic: string, payload: Record<string, unknown>) {
  const handlers = new Map<string, (m: unknown) => Promise<void>>();
  register({ subscribe: (t: string, h: (m: unknown) => Promise<void>) => handlers.set(t, h) } as never);
  return handlers.get(topic)!({
    messageId: randomUUID(), type: topic, tenantId: "t1", actorId: "a1", correlationId: "c1", schemaVersion: "1.0", payload,
  });
}

describe("sharing consumer expiresAt (UAT #23)", () => {
  beforeEach(() => H.shareInsert.mockReset().mockResolvedValue(undefined));

  const base = { id: "s1", tenantId: "t1", documentId: "d1", sharedWith: "u2", permission: "view" };

  it("parses an ISO-string expiresAt (as delivered over the queue) into a Date", async () => {
    const iso = "2027-01-01T00:00:00.000Z";
    await deliver(registerSharingConsumers as never, COMMANDS.shareCreate, { ...base, expiresAt: iso });
    const row = H.shareInsert.mock.calls[0]![1] as { expiresAt: unknown };
    expect(row.expiresAt).toBeInstanceOf(Date);
    expect((row.expiresAt as Date).toISOString()).toBe(iso);
  });

  it("keeps a missing/null expiresAt as null", async () => {
    await deliver(registerSharingConsumers as never, COMMANDS.shareCreate, { ...base, expiresAt: null });
    expect((H.shareInsert.mock.calls[0]![1] as { expiresAt: unknown }).expiresAt).toBeNull();
    await deliver(registerSharingConsumers as never, COMMANDS.shareCreate, { ...base });
    expect((H.shareInsert.mock.calls[1]![1] as { expiresAt: unknown }).expiresAt).toBeNull();
  });
});

describe("PUT bumps version (UAT #29)", () => {
  function fakeTx() {
    const set = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
    return { tx: { update: vi.fn().mockReturnValue({ set }) }, set };
  }
  const bump = (v: unknown) => new PgDialect().sqlToQuery(v as SQL).sql;

  it("categories.update increments version in SQL and still applies the patch", async () => {
    const { tx, set } = fakeTx();
    await categoriesRepo.update(tx as never, "c1", { name: "New", version: 1 } as never);
    const arg = set.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg.name).toBe("New");
    expect(bump(arg.version)).toMatch(/"version" \+ 1/);
  });

  it("retentionPolicies.update increments version in SQL and still applies the patch", async () => {
    const { tx, set } = fakeTx();
    await retentionRepo.update(tx as never, "r1", { name: "New", version: 1 } as never);
    const arg = set.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg.name).toBe("New");
    expect(bump(arg.version)).toMatch(/"version" \+ 1/);
  });
});
