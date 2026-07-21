/**
 * Consumer integration tests — verifies CQRS consumer handlers
 * with mocked DB transaction + outbox for all modules.
 *
 * Uses a harness pattern: intercepts queue.subscribe calls, then directly
 * invokes handlers to test consumer logic without needing real queue delivery.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { COMMANDS, EVENTS } from "../src/topics.js";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockMarkProcessed = vi.fn().mockResolvedValue(true);
const mockEnqueue = vi.fn().mockResolvedValue(undefined);
const mockCachePut = vi.fn().mockResolvedValue(undefined);
const mockCacheInvalidate = vi.fn().mockResolvedValue(undefined);
const mockCacheInvalidateResource = vi.fn().mockResolvedValue(undefined);
const mockCacheMakeKey = vi.fn((...args: string[]) => args.join(":"));

vi.mock("../src/shared/db.js", () => ({
  db: { transaction: vi.fn(async (fn: (tx: unknown) => Promise<void>) => fn({})) },
  sqlClient: { end: vi.fn() },
  scopedRead: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({})),
}));

vi.mock("../src/shared/outbox.js", () => ({
  markProcessed: (...args: unknown[]) => mockMarkProcessed(...args),
  enqueue: (...args: unknown[]) => mockEnqueue(...args),
}));

vi.mock("../src/shared/infra.js", () => ({
  cache: {
    put: (...args: unknown[]) => mockCachePut(...args),
    invalidate: (...args: unknown[]) => mockCacheInvalidate(...args),
    invalidateResource: (...args: unknown[]) => mockCacheInvalidateResource(...args),
    makeKey: (...args: string[]) => mockCacheMakeKey(...args),
  },
  queue: { publish: vi.fn().mockResolvedValue(undefined), subscribe: vi.fn() },
}));

vi.mock("../src/modules/documents/repo.js", () => ({
  insert: vi.fn().mockResolvedValue(undefined),
  toView: vi.fn((r: unknown) => r),
}));

vi.mock("../src/modules/categories/repo.js", () => ({
  insert: vi.fn().mockResolvedValue(undefined),
  update: vi.fn().mockResolvedValue(undefined),
  remove: vi.fn().mockResolvedValue(undefined),
  toView: vi.fn((r: unknown) => r),
}));

vi.mock("../src/modules/sharing/repo.js", () => ({
  insert: vi.fn().mockResolvedValue(undefined),
  remove: vi.fn().mockResolvedValue(undefined),
  toView: vi.fn((r: unknown) => r),
}));

vi.mock("../src/modules/retention/repo.js", () => ({
  insert: vi.fn().mockResolvedValue(undefined),
  update: vi.fn().mockResolvedValue(undefined),
  toView: vi.fn((r: unknown) => r),
}));

vi.mock("../src/modules/versions/repo.js", () => ({
  insert: vi.fn().mockResolvedValue(undefined),
  getById: vi.fn().mockResolvedValue({ id: "v1", tenantId: "t1", documentId: "d1", versionNo: 1, s3Key: "key.pdf", sizeBytes: 100, changeNote: "", createdBy: "a", createdAt: new Date() }),
  getLatestVersionNo: vi.fn().mockResolvedValue(1),
  toView: vi.fn((r: unknown) => r),
}));

vi.mock("../src/modules/search/repo.js", () => ({
  indexDocument: vi.fn().mockResolvedValue(undefined),
  removeDocument: vi.fn().mockResolvedValue(undefined),
  search: vi.fn().mockResolvedValue([]),
  listAllForTenant: vi.fn().mockResolvedValue([]),
  toView: vi.fn((r: unknown) => r),
  initializeSearch: vi.fn(),
  closeSearch: vi.fn(),
}));

import { registerDocumentsConsumers } from "../src/modules/documents/consumer.js";
import { registerCategoriesConsumers } from "../src/modules/categories/consumer.js";
import { registerSharingConsumers } from "../src/modules/sharing/consumer.js";
import { registerRetentionConsumers } from "../src/modules/retention/consumer.js";
import { registerVersionsConsumers } from "../src/modules/versions/consumer.js";
import { registerSearchConsumers } from "../src/modules/search/consumer.js";
import * as searchRepo from "../src/modules/search/repo.js";

// ─── Test harness ────────────────────────────────────────────────────────────

function makeHarness() {
  const handlers = new Map<string, (msg: unknown) => Promise<void>>();
  const register = { subscribe: (topic: string, h: (msg: unknown) => Promise<void>) => { handlers.set(topic, h); } };
  return {
    queue: register as never,
    deliver: async (topic: string, msg: unknown) => {
      const handler = handlers.get(topic);
      if (!handler) throw new Error(`No handler for topic: ${topic}`);
      await handler(msg);
    },
  };
}

function msg(topic: string, tenantId: string, payload: unknown, messageId = randomUUID()) {
  return { messageId, type: topic, tenantId, actorId: "actor-1", correlationId: "corr-1", schemaVersion: "1.0", payload };
}

// ─── Documents consumer ──────────────────────────────────────────────────────

describe("documents consumer", () => {
  beforeEach(() => { vi.clearAllMocks(); mockMarkProcessed.mockResolvedValue(true); });

  it("processes createDocument command", async () => {
    const h = makeHarness();
    registerDocumentsConsumers(h.queue);
    await h.deliver(COMMANDS.createDocument, msg(COMMANDS.createDocument, "t1", {
      id: "doc-1", tenantId: "t1", title: "Test Doc", category: "general", status: "draft", tags: [],
    }));
    expect(mockMarkProcessed).toHaveBeenCalled();
    expect(mockEnqueue).toHaveBeenCalled();
    expect(mockCachePut).toHaveBeenCalled();
    expect(mockCacheInvalidateResource).toHaveBeenCalledWith("t1", "document");
  });

  it("skips if already processed (idempotency)", async () => {
    mockMarkProcessed.mockResolvedValueOnce(false);
    const h = makeHarness();
    registerDocumentsConsumers(h.queue);
    await h.deliver(COMMANDS.createDocument, msg(COMMANDS.createDocument, "t1", {
      id: "doc-dup", tenantId: "t1", title: "Dup", category: "x", status: "draft",
    }));
    expect(mockEnqueue).not.toHaveBeenCalled();
  });
});

// ─── Categories consumer ─────────────────────────────────────────────────────

describe("categories consumer", () => {
  beforeEach(() => { vi.clearAllMocks(); mockMarkProcessed.mockResolvedValue(true); });

  it("processes categoryCreate command", async () => {
    const h = makeHarness();
    registerCategoriesConsumers(h.queue);
    await h.deliver(COMMANDS.categoryCreate, msg(COMMANDS.categoryCreate, "t1", {
      id: "cat-1", tenantId: "t1", parentId: null, name: "Finance", slug: "finance", description: "", icon: null, sortOrder: 0,
    }));
    expect(mockMarkProcessed).toHaveBeenCalled();
    expect(mockEnqueue).toHaveBeenCalled();
    expect(mockCachePut).toHaveBeenCalled();
    expect(mockCacheInvalidateResource).toHaveBeenCalledWith("t1", "category");
  });

  it("processes categoryUpdate command", async () => {
    const h = makeHarness();
    registerCategoriesConsumers(h.queue);
    await h.deliver(COMMANDS.categoryUpdate, msg(COMMANDS.categoryUpdate, "t1", { id: "cat-1", name: "Updated" }));
    expect(mockMarkProcessed).toHaveBeenCalled();
    expect(mockCacheInvalidate).toHaveBeenCalled();
    expect(mockCacheInvalidateResource).toHaveBeenCalledWith("t1", "category");
  });

  it("processes categoryDelete command", async () => {
    const h = makeHarness();
    registerCategoriesConsumers(h.queue);
    await h.deliver(COMMANDS.categoryDelete, msg(COMMANDS.categoryDelete, "t1", { id: "cat-1" }));
    expect(mockMarkProcessed).toHaveBeenCalled();
    expect(mockCacheInvalidate).toHaveBeenCalled();
  });

  it("processes categoryReorder command", async () => {
    const h = makeHarness();
    registerCategoriesConsumers(h.queue);
    await h.deliver(COMMANDS.categoryReorder, msg(COMMANDS.categoryReorder, "t1", {
      items: [{ id: "cat-1", sortOrder: 0 }, { id: "cat-2", sortOrder: 1 }],
    }));
    expect(mockMarkProcessed).toHaveBeenCalled();
    expect(mockCacheInvalidateResource).toHaveBeenCalledWith("t1", "category");
  });
});

// ─── Sharing consumer ────────────────────────────────────────────────────────

describe("sharing consumer", () => {
  beforeEach(() => { vi.clearAllMocks(); mockMarkProcessed.mockResolvedValue(true); });

  it("processes shareCreate command", async () => {
    const h = makeHarness();
    registerSharingConsumers(h.queue);
    await h.deliver(COMMANDS.shareCreate, msg(COMMANDS.shareCreate, "t1", {
      id: "share-1", tenantId: "t1", documentId: "doc-1", sharedWith: "user-2", permission: "view", expiresAt: null,
    }));
    expect(mockMarkProcessed).toHaveBeenCalled();
    expect(mockEnqueue).toHaveBeenCalled();
    expect(mockCachePut).toHaveBeenCalled();
    expect(mockCacheInvalidateResource).toHaveBeenCalledWith("t1", "share");
  });

  it("processes shareRevoke command", async () => {
    const h = makeHarness();
    registerSharingConsumers(h.queue);
    await h.deliver(COMMANDS.shareRevoke, msg(COMMANDS.shareRevoke, "t1", { id: "share-1" }));
    expect(mockMarkProcessed).toHaveBeenCalled();
    expect(mockCacheInvalidate).toHaveBeenCalled();
    expect(mockCacheInvalidateResource).toHaveBeenCalledWith("t1", "share");
  });
});

// ─── Retention consumer ──────────────────────────────────────────────────────

describe("retention consumer", () => {
  beforeEach(() => { vi.clearAllMocks(); mockMarkProcessed.mockResolvedValue(true); });

  it("processes retentionPolicyCreate command", async () => {
    const h = makeHarness();
    registerRetentionConsumers(h.queue);
    await h.deliver(COMMANDS.retentionPolicyCreate, msg(COMMANDS.retentionPolicyCreate, "t1", {
      id: "ret-1", tenantId: "t1", name: "7-Year", categoryId: null, retentionYears: 7, retentionDays: 0, action: "archive", notifyBefore: 90, reminderMonths: 6,
    }));
    expect(mockMarkProcessed).toHaveBeenCalled();
    expect(mockEnqueue).toHaveBeenCalled();
    expect(mockCachePut).toHaveBeenCalled();
    expect(mockCacheInvalidateResource).toHaveBeenCalledWith("t1", "retention-policy");
  });

  it("processes retentionPolicyUpdate command", async () => {
    const h = makeHarness();
    registerRetentionConsumers(h.queue);
    await h.deliver(COMMANDS.retentionPolicyUpdate, msg(COMMANDS.retentionPolicyUpdate, "t1", { id: "ret-1", retentionYears: 10 }));
    expect(mockMarkProcessed).toHaveBeenCalled();
    expect(mockCacheInvalidate).toHaveBeenCalled();
    expect(mockCacheInvalidateResource).toHaveBeenCalledWith("t1", "retention-policy");
  });

  it("processes retentionPolicyApply command", async () => {
    const h = makeHarness();
    registerRetentionConsumers(h.queue);
    await h.deliver(COMMANDS.retentionPolicyApply, msg(COMMANDS.retentionPolicyApply, "t1", { policyId: "ret-1", tenantId: "t1" }));
    expect(mockMarkProcessed).toHaveBeenCalled();
    expect(mockCacheInvalidateResource).toHaveBeenCalledWith("t1", "retention-policy");
  });
});

// ─── Versions consumer ───────────────────────────────────────────────────────

describe("versions consumer", () => {
  beforeEach(() => { vi.clearAllMocks(); mockMarkProcessed.mockResolvedValue(true); });

  it("processes versionCreate command", async () => {
    const h = makeHarness();
    registerVersionsConsumers(h.queue);
    await h.deliver(COMMANDS.versionCreate, msg(COMMANDS.versionCreate, "t1", {
      id: "ver-1", tenantId: "t1", documentId: "doc-1", versionNo: 2, s3Key: "docs/v2.pdf", sizeBytes: 1024, changeNote: "Updated",
    }));
    expect(mockMarkProcessed).toHaveBeenCalled();
    expect(mockEnqueue).toHaveBeenCalled();
    expect(mockCachePut).toHaveBeenCalled();
    expect(mockCacheInvalidateResource).toHaveBeenCalledWith("t1", "document-version");
  });

  it("processes versionRestore command", async () => {
    const h = makeHarness();
    registerVersionsConsumers(h.queue);
    await h.deliver(COMMANDS.versionRestore, msg(COMMANDS.versionRestore, "t1", {
      id: "ver-new", tenantId: "t1", documentId: "doc-1", versionId: "v1", changeNote: "Restoring",
    }));
    expect(mockMarkProcessed).toHaveBeenCalled();
    expect(mockCacheInvalidateResource).toHaveBeenCalledWith("t1", "document-version");
  });
});

// ─── Search consumer ─────────────────────────────────────────────────────────

describe("search consumer", () => {
  beforeEach(() => { vi.clearAllMocks(); mockMarkProcessed.mockResolvedValue(true); });

  it("processes searchIndex command", async () => {
    const h = makeHarness();
    registerSearchConsumers(h.queue);
    await h.deliver(COMMANDS.searchIndex, msg(COMMANDS.searchIndex, "t1", {
      id: "idx-1", tenantId: "t1", documentId: "doc-1", title: "Budget Report", content: "Annual...", tags: ["finance"],
    }));
    expect(mockMarkProcessed).toHaveBeenCalled();
    expect(mockEnqueue).toHaveBeenCalled();
    expect(searchRepo.indexDocument).toHaveBeenCalledWith("t1", expect.objectContaining({ documentId: "doc-1" }));
  });

  it("processes searchReindex command", async () => {
    const h = makeHarness();
    registerSearchConsumers(h.queue);
    await h.deliver(COMMANDS.searchReindex, msg(COMMANDS.searchReindex, "t1", { tenantId: "t1" }));
    expect(mockMarkProcessed).toHaveBeenCalled();
    expect(mockEnqueue).toHaveBeenCalled();
  });

  it("processes searchRemoveDocument command", async () => {
    const h = makeHarness();
    registerSearchConsumers(h.queue);
    await h.deliver(COMMANDS.searchRemoveDocument, msg(COMMANDS.searchRemoveDocument, "t1", { documentId: "doc-1" }));
    expect(mockMarkProcessed).toHaveBeenCalled();
    expect(searchRepo.removeDocument).toHaveBeenCalledWith("t1", "doc-1");
  });

  it("auto-indexes on document.created event", async () => {
    const h = makeHarness();
    registerSearchConsumers(h.queue);
    await h.deliver(EVENTS.documentCreated, msg(EVENTS.documentCreated, "t1", { documentId: "doc-new", title: "New" }));
    expect(searchRepo.indexDocument).toHaveBeenCalledWith("t1", expect.objectContaining({ documentId: "doc-new" }));
  });

  it("skips auto-index if payload incomplete", async () => {
    const h = makeHarness();
    registerSearchConsumers(h.queue);
    await h.deliver(EVENTS.documentCreated, msg(EVENTS.documentCreated, "t1", { someField: "no docId" }));
    expect(searchRepo.indexDocument).not.toHaveBeenCalled();
  });
});

// ─── Search commands (unit) ──────────────────────────────────────────────────

describe("search commands", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("searchIndex publishes to queue", async () => {
    const { searchIndex } = await import("../src/modules/search/commands.js");
    const infra = await import("../src/shared/infra.js");
    const ctx = { tenantId: "t1", actorId: "actor-1", correlationId: "corr-1" } as never;
    const result = await searchIndex(ctx, { documentId: "doc-1", title: "Test", content: "content", tags: ["tag1"] });
    expect(result.status).toBe("accepted");
    expect(infra.queue.publish).toHaveBeenCalledWith(COMMANDS.searchIndex, expect.objectContaining({ tenantId: "t1" }));
  });

  it("searchReindex publishes to queue", async () => {
    const { searchReindex } = await import("../src/modules/search/commands.js");
    const infra = await import("../src/shared/infra.js");
    const ctx = { tenantId: "t1", actorId: "actor-1", correlationId: "corr-2" } as never;
    const result = await searchReindex(ctx);
    expect(result.status).toBe("accepted");
    expect(infra.queue.publish).toHaveBeenCalledWith(COMMANDS.searchReindex, expect.objectContaining({ tenantId: "t1" }));
  });

  it("removeDocument publishes to queue", async () => {
    const { removeDocument } = await import("../src/modules/search/commands.js");
    const infra = await import("../src/shared/infra.js");
    const ctx = { tenantId: "t1", actorId: "actor-1", correlationId: "corr-3" } as never;
    const result = await removeDocument(ctx, "doc-1");
    expect(result.status).toBe("accepted");
    expect(infra.queue.publish).toHaveBeenCalledWith(COMMANDS.searchRemoveDocument, expect.objectContaining({ tenantId: "t1" }));
  });
});
