/**
 * @civitasone/search — Unit tests for the search indexing utility.
 *
 * Verifies that `publishSearchIndex` correctly enqueues outbox events
 * for both upsert and delete actions, and that the event payload matches
 * the SearchIndexDocument structure.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { publishSearchIndex, SEARCH_INDEX_TOPIC, SEARCH_INDEX_EVENT_TYPE } from "../src/indexing.js";
import type { PublishSearchIndexInput } from "../src/indexing.js";

// Mock @civitasone/outbox
const mockEnqueue = vi.fn().mockResolvedValue(undefined);
vi.mock("@civitasone/outbox", () => ({
  enqueue: (...args: unknown[]) => mockEnqueue(...args),
}));

describe("publishSearchIndex", () => {
  const fakeTx = {} as Parameters<typeof publishSearchIndex>[0];

  beforeEach(() => {
    mockEnqueue.mockClear();
  });

  it("publishes an upsert event with correct topic and payload", async () => {
    const input: PublishSearchIndexInput = {
      id: "entity-1",
      tenantId: "tenant-abc",
      module: "hrms",
      name: "John Doe",
      refNumber: "EMP-001",
      description: "Senior Engineer",
      status: "active",
      action: "upsert",
      actorId: "actor-1",
      correlationId: "corr-123",
    };

    await publishSearchIndex(fakeTx, input);

    expect(mockEnqueue).toHaveBeenCalledTimes(1);
    const [tx, envelope] = mockEnqueue.mock.calls[0]!;
    expect(tx).toBe(fakeTx);
    expect(envelope.topic).toBe(SEARCH_INDEX_TOPIC);
    expect(envelope.eventType).toBe(SEARCH_INDEX_EVENT_TYPE);
    expect(envelope.tenantId).toBe("tenant-abc");
    expect(envelope.actorId).toBe("actor-1");
    expect(envelope.correlationId).toBe("corr-123");
    expect(envelope.payload).toEqual({
      id: "entity-1",
      tenantId: "tenant-abc",
      module: "hrms",
      name: "John Doe",
      refNumber: "EMP-001",
      description: "Senior Engineer",
      status: "active",
      action: "upsert",
    });
  });

  it("publishes a delete event on soft-delete", async () => {
    const input: PublishSearchIndexInput = {
      id: "entity-2",
      tenantId: "tenant-xyz",
      module: "finance",
      name: "Budget FY26",
      status: "deleted",
      action: "delete",
      actorId: "actor-2",
      correlationId: "corr-456",
    };

    await publishSearchIndex(fakeTx, input);

    expect(mockEnqueue).toHaveBeenCalledTimes(1);
    const [, envelope] = mockEnqueue.mock.calls[0]!;
    expect(envelope.topic).toBe("search.index.update");
    expect(envelope.payload.action).toBe("delete");
    expect(envelope.payload.id).toBe("entity-2");
    expect(envelope.payload.module).toBe("finance");
  });

  it("sets refNumber and description to null when not provided", async () => {
    const input: PublishSearchIndexInput = {
      id: "entity-3",
      tenantId: "tenant-123",
      module: "project",
      name: "Highway Project",
      status: "active",
      action: "upsert",
      actorId: "actor-3",
      correlationId: "corr-789",
    };

    await publishSearchIndex(fakeTx, input);

    const [, envelope] = mockEnqueue.mock.calls[0]!;
    expect(envelope.payload.refNumber).toBeNull();
    expect(envelope.payload.description).toBeNull();
  });

  it("handles all 8 service modules correctly", async () => {
    const modules = ["hrms", "finance", "procurement", "project", "citizen", "legal", "crm", "helpdesk"];

    for (const mod of modules) {
      mockEnqueue.mockClear();
      await publishSearchIndex(fakeTx, {
        id: `id-${mod}`,
        tenantId: "t1",
        module: mod,
        name: `Entity from ${mod}`,
        status: "active",
        action: "upsert",
        actorId: "a1",
        correlationId: "c1",
      });

      const [, envelope] = mockEnqueue.mock.calls[0]!;
      expect(envelope.payload.module).toBe(mod);
    }
  });
});

describe("SEARCH_INDEX_TOPIC constant", () => {
  it("equals search.index.update", () => {
    expect(SEARCH_INDEX_TOPIC).toBe("search.index.update");
  });
});

describe("SEARCH_INDEX_EVENT_TYPE constant", () => {
  it("equals search.index.updated", () => {
    expect(SEARCH_INDEX_EVENT_TYPE).toBe("search.index.updated");
  });
});
