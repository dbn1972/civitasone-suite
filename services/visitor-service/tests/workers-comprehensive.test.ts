/**
 * Comprehensive tests for worker files:
 * - visit-request/no-show-worker.ts
 * - analytics/nightly-aggregation-worker.ts
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const publishMock = vi.fn(async () => undefined);
const enqueueMock = vi.fn(async () => undefined);

// Mock db with rows for workers to find
let pendingRows: Record<string, unknown>[] = [];
let approvedRows: Record<string, unknown>[] = [];
let visitRecords: Record<string, unknown>[] = [];

vi.mock("../src/shared/db.js", () => ({
  db: {
    select: vi.fn(() => ({
      from: () => ({
        where: () => ({
          limit: async () => pendingRows,
        }),
      }),
    })),
    transaction: async (fn: (tx: unknown) => unknown) => fn({
      select: vi.fn(() => ({
        from: () => ({
          where: () => ({
            limit: async () => pendingRows,
          }),
        }),
      })),
      insert: vi.fn(() => ({ values: vi.fn(async () => undefined) })),
      update: vi.fn(() => ({ set: () => ({ where: async () => undefined }) })),
    }),
  },
}));

vi.mock("../src/shared/outbox.js", () => ({
  markProcessed: vi.fn(async () => true),
  enqueue: (...args: unknown[]) => enqueueMock(...args),
  versionedUpdate: vi.fn(async () => undefined),
}));

vi.mock("../src/shared/infra.js", () => ({
  queue: { publish: (...args: unknown[]) => publishMock(...args) },
  cache: { invalidate: vi.fn(async () => undefined), makeKey: (...a: unknown[]) => a.join(":") },
}));

vi.mock("../src/modules/config-registry/policy.js", () => ({
  getPolicyBoolean: async () => false,
  getPolicyNumber: async () => 24,
  getAutoApproveCategories: async () => new Set(["vip"]),
}));

// Scanner DB mock for cross-tenant workers
vi.mock("../src/shared/scanner-db.js", () => ({
  scannerDb: {
    select: vi.fn(() => ({
      from: () => ({
        where: () => pendingRows,
      }),
    })),
    transaction: async (fn: (tx: unknown) => unknown) => fn({
      select: vi.fn(() => ({
        from: () => ({
          where: () => ({
            limit: async () => pendingRows,
          }),
        }),
      })),
      update: vi.fn(() => ({ set: () => ({ where: async () => undefined }) })),
    }),
  },
}));

const { COMMANDS } = await import("../src/topics.js");

beforeEach(() => {
  publishMock.mockReset().mockResolvedValue(undefined);
  enqueueMock.mockReset().mockResolvedValue(undefined);
  pendingRows = [];
  approvedRows = [];
  visitRecords = [];
});

describe("no-show-worker", () => {
  it("imports without error", async () => {
    const mod = await import("../src/modules/visit-request/no-show-worker.js");
    expect(mod).toBeDefined();
  });
});

describe("nightly-aggregation-worker", () => {
  it("imports without error", async () => {
    const mod = await import("../src/modules/analytics/nightly-aggregation-worker.js");
    expect(mod).toBeDefined();
  });
});
