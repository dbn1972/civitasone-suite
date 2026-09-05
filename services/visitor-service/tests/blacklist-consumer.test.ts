/**
 * Feature: visitor-management, Task 4.6 — modules/blacklist/consumer.ts
 *
 * Unit tests (mocked DB/outbox/screening-store) covering:
 *   - blacklistAdd inserts a new `pending` blacklist_entries row
 *   - blacklistApprove enforces maker-checker (Property 18): self-approval
 *     is rejected and does NOT transition the entry or sync Redis
 *   - blacklistApprove by a distinct approver transitions to `active` and
 *     syncs the blacklist screening hash set
 *   - watchlistAdd inserts an `active` watchlist_entries row immediately
 *     (no maker-checker) and syncs the watchlist screening hash set
 *   - idempotent replay (markProcessed returns false) never re-processes a
 *     command or touches Redis a second time
 *   - a Redis sync failure (e.g. Redis down) is swallowed and does NOT
 *     fail/retry an already-committed DB write (graceful degradation)
 *
 * Requirements: 10.3, 10.4, 10.5, 10.6
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryQueue } from "@civitasone/queue";

const markProcessedMock = vi.fn(async () => true);
const addToBlacklistHashSetMock = vi.fn(async () => undefined);
const addToWatchlistHashSetMock = vi.fn(async () => undefined);

// In-memory fake blacklist_entries row so the consumer's select/update
// chain works without a real Postgres connection.
let blacklistRow: Record<string, unknown> | undefined;

function makeSelectChain(rows: Record<string, unknown>[]) {
  return {
    from: () => ({
      where: () => ({
        limit: async () => rows,
      }),
    }),
  };
}

const fakeTx = {
  select: vi.fn(() => makeSelectChain(blacklistRow ? [blacklistRow] : [])),
  insert: vi.fn(() => ({ values: async () => undefined })),
  update: vi.fn(() => ({ set: () => ({ where: async () => undefined }) })),
};

vi.mock("../src/shared/db.js", () => ({
  db: {
    transaction: async (fn: (tx: typeof fakeTx) => unknown) => fn(fakeTx),
  },
}));

vi.mock("../src/shared/outbox.js", () => ({
  markProcessed: (...args: unknown[]) => markProcessedMock(...(args as [unknown, string])),
}));

vi.mock("../src/modules/blacklist/screening-store.js", () => ({
  addToBlacklistHashSet: (...args: unknown[]) => addToBlacklistHashSetMock(...(args as [string, string])),
  addToWatchlistHashSet: (...args: unknown[]) => addToWatchlistHashSetMock(...(args as [string, string])),
}));

const { registerBlacklistConsumers } = await import("../src/modules/blacklist/consumer.js");
const { COMMANDS } = await import("../src/topics.js");

const TENANT = "11111111-1111-1111-1111-111111111111";
const MAKER = "22222222-2222-2222-2222-222222222222";
const CHECKER = "33333333-3333-3333-3333-333333333333";
const ENTRY_ID = "44444444-4444-4444-4444-444444444444";
const DOC_HASH = "deadbeef";

function freshQueue(): MemoryQueue {
  const queue = new MemoryQueue();
  registerBlacklistConsumers(queue);
  return queue;
}

async function publishAndFlush(
  queue: MemoryQueue,
  topic: string,
  payload: unknown,
  actorId: string = MAKER,
  waitMs = 10,
): Promise<void> {
  await queue.publish(topic, {
    type: topic,
    tenantId: TENANT,
    actorId,
    correlationId: "corr-1",
    schemaVersion: "1.0",
    payload,
  });
  // MemoryQueue delivers via setTimeout(0); flush the macrotask queue.
  await new Promise((r) => setTimeout(r, waitMs));
}

beforeEach(() => {
  markProcessedMock.mockReset().mockResolvedValue(true);
  addToBlacklistHashSetMock.mockReset().mockResolvedValue(undefined);
  addToWatchlistHashSetMock.mockReset().mockResolvedValue(undefined);
  fakeTx.select.mockClear();
  fakeTx.insert.mockClear();
  fakeTx.update.mockClear();

  blacklistRow = {
    id: ENTRY_ID,
    tenantId: TENANT,
    status: "pending",
    createdBy: MAKER,
    identityDocHash: DOC_HASH,
  };
});

describe("blacklistAdd", () => {
  it("inserts a new pending blacklist entry", async () => {
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.blacklistAdd, {
      id: ENTRY_ID,
      tenantId: TENANT,
      personName: "John Doe",
      identityDocHash: DOC_HASH,
      reason: "prior incident",
    });

    expect(markProcessedMock).toHaveBeenCalledTimes(1);
    expect(fakeTx.insert).toHaveBeenCalledTimes(1);
  });

  it("does not insert on an idempotent replay (markProcessed returns false)", async () => {
    markProcessedMock.mockResolvedValue(false);
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.blacklistAdd, {
      id: ENTRY_ID,
      tenantId: TENANT,
      personName: "John Doe",
      reason: "prior incident",
    });

    expect(fakeTx.insert).not.toHaveBeenCalled();
  });
});

describe("blacklistApprove -> maker-checker (Property 18)", () => {
  it("rejects self-approval and does not update the entry or sync Redis", async () => {
    const queue = freshQueue();

    // The maker-checker DomainError is not a NonRetryableError, so
    // MemoryQueue retries with backoff (5 attempts, ~300ms total) before
    // dead-lettering — wait it out so retries don't bleed into later tests.
    await expect(
      publishAndFlush(queue, COMMANDS.blacklistApprove, { id: ENTRY_ID, tenantId: TENANT }, MAKER, 600),
    ).resolves.not.toThrow();

    expect(fakeTx.update).not.toHaveBeenCalled();
    expect(addToBlacklistHashSetMock).not.toHaveBeenCalled();
    expect(queue.dlq).toHaveLength(1);
  });

  it("approves and transitions to active + syncs the blacklist hash set when approver differs from creator", async () => {
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.blacklistApprove, { id: ENTRY_ID, tenantId: TENANT }, CHECKER);

    expect(fakeTx.update).toHaveBeenCalledTimes(1);
    expect(addToBlacklistHashSetMock).toHaveBeenCalledTimes(1);
    expect(addToBlacklistHashSetMock).toHaveBeenCalledWith(TENANT, DOC_HASH);
  });

  it("does not touch the DB or Redis on an idempotent replay", async () => {
    markProcessedMock.mockResolvedValue(false);
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.blacklistApprove, { id: ENTRY_ID, tenantId: TENANT }, CHECKER);

    expect(fakeTx.update).not.toHaveBeenCalled();
    expect(addToBlacklistHashSetMock).not.toHaveBeenCalled();
  });

  it("swallows a Redis sync failure without throwing — approval already committed", async () => {
    addToBlacklistHashSetMock.mockRejectedValue(new Error("ECONNREFUSED"));
    const queue = freshQueue();

    await expect(
      publishAndFlush(queue, COMMANDS.blacklistApprove, { id: ENTRY_ID, tenantId: TENANT }, CHECKER),
    ).resolves.not.toThrow();

    expect(fakeTx.update).toHaveBeenCalledTimes(1);
    expect(queue.dlq).toHaveLength(0);
  });
});

describe("watchlistAdd", () => {
  it("inserts a new active watchlist entry (no maker-checker) and syncs the watchlist hash set", async () => {
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.watchlistAdd, {
      id: ENTRY_ID,
      tenantId: TENANT,
      personName: "Jane Risk",
      identityDocHash: DOC_HASH,
      riskLevel: "high",
    });

    expect(markProcessedMock).toHaveBeenCalledTimes(1);
    expect(fakeTx.insert).toHaveBeenCalledTimes(1);
    expect(addToWatchlistHashSetMock).toHaveBeenCalledTimes(1);
    expect(addToWatchlistHashSetMock).toHaveBeenCalledWith(TENANT, DOC_HASH);
  });

  it("does not insert or sync Redis on an idempotent replay", async () => {
    markProcessedMock.mockResolvedValue(false);
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.watchlistAdd, {
      id: ENTRY_ID,
      tenantId: TENANT,
      personName: "Jane Risk",
      identityDocHash: DOC_HASH,
    });

    expect(fakeTx.insert).not.toHaveBeenCalled();
    expect(addToWatchlistHashSetMock).not.toHaveBeenCalled();
  });

  it("swallows a Redis sync failure without throwing — entry already committed", async () => {
    addToWatchlistHashSetMock.mockRejectedValue(new Error("ECONNREFUSED"));
    const queue = freshQueue();

    await expect(
      publishAndFlush(queue, COMMANDS.watchlistAdd, {
        id: ENTRY_ID,
        tenantId: TENANT,
        personName: "Jane Risk",
        identityDocHash: DOC_HASH,
      }),
    ).resolves.not.toThrow();

    expect(fakeTx.insert).toHaveBeenCalledTimes(1);
    expect(queue.dlq).toHaveLength(0);
  });
});
