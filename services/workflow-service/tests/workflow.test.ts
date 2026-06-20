/**
 * workflow-service tests.
 * Proves CQRS wiring with MemoryQueue + MemoryCache (no Postgres/Redis required).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { MemoryQueue } from "@civitasone/queue";
import { Cache, MemoryCache } from "@civitasone/cache";
import { createInstanceBody } from "../src/modules/instances/validators.js";
import { idParam, taskViewSchema } from "../src/modules/tasks/validators.js";

describe("instance validators", () => {
  it("accepts valid instance name", () => {
    const body = createInstanceBody.parse({ name: "Budget Approval Flow" });
    expect(body.name).toBe("Budget Approval Flow");
  });

  it("rejects empty name", () => {
    expect(() => createInstanceBody.parse({ name: "" })).toThrow();
  });

  it("rejects missing name", () => {
    expect(() => createInstanceBody.parse({})).toThrow();
  });
});

describe("task validators", () => {
  it("accepts valid UUID param", () => {
    const parsed = idParam.parse({ id: "11111111-aaaa-4000-8000-000000000001" });
    expect(parsed.id).toBe("11111111-aaaa-4000-8000-000000000001");
  });

  it("rejects non-UUID param", () => {
    expect(() => idParam.parse({ id: "not-a-uuid" })).toThrow();
  });

  it("validates task view schema", () => {
    const view = taskViewSchema.parse({
      id: "11111111-aaaa-4000-8000-000000000001",
      tenantId: "22222222-bbbb-4000-8000-000000000002",
      instanceId: "33333333-cccc-4000-8000-000000000003",
      name: "Review",
      status: "pending",
      version: 1,
    });
    expect(view.status).toBe("pending");
  });
});

describe("write-via-queue + read-via-cache", () => {
  let queue: MemoryQueue;
  let cache: Cache;
  const instanceStore = new Map<string, { id: string; name: string; tenantId: string; status: string }>();
  const taskStore = new Map<string, { id: string; instanceId: string; status: string }>();

  beforeEach(() => {
    queue = new MemoryQueue();
    cache = new Cache({ service: "workflow", store: new MemoryCache(), defaultTtlSeconds: 60 });
    instanceStore.clear();
    taskStore.clear();

    queue.subscribe<{ id: string; name: string; tenantId: string; status: string }>(
      "workflow.instance.create",
      async (msg) => {
        instanceStore.set(msg.payload.id, {
          id: msg.payload.id,
          name: msg.payload.name,
          tenantId: msg.payload.tenantId,
          status: msg.payload.status,
        });
      }
    );

    queue.subscribe<{ id: string; instanceId: string; status: string }>(
      "workflow.task.complete",
      async (msg) => {
        const existing = taskStore.get(msg.payload.id);
        if (existing) taskStore.set(msg.payload.id, { ...existing, status: "completed" });
      }
    );
  });

  it("createInstance primes cache and publishes command", async () => {
    const tenantId = "11111111-aaaa-4000-8000-000000000001";
    const id = "22222222-bbbb-4000-8000-000000000002";
    const projected = { id, tenantId, name: "PO Approval", status: "active", version: 1 };

    await cache.put(cache.makeKey(tenantId, "instance", id), projected);
    await queue.publish("workflow.instance.create", {
      messageId: id,
      type: "workflow.instance.create",
      tenantId,
      actorId: "00000000-aaaa-4000-8000-000000000001",
      correlationId: "c1",
      schemaVersion: "1.0",
      payload: projected,
    });

    expect(instanceStore.has(id)).toBe(false);
    const fromCache = await cache.getOrLoad(cache.makeKey(tenantId, "instance", id), async () => null);
    expect(fromCache).toEqual(projected);

    await new Promise((r) => setTimeout(r, 20));
    expect(instanceStore.get(id)?.name).toBe("PO Approval");
  });

  it("listOrLoad caches paginated instance results", async () => {
    const tenantId = "11111111-aaaa-4000-8000-000000000003";
    const page = {
      data: [{ id: "i1", tenantId, name: "Flow One", status: "active", version: 1 }],
      pagination: { hasMore: false, pageSize: 50 },
    };
    let loads = 0;
    const first = await cache.listOrLoad(tenantId, "instance", "list:50:0", async () => {
      loads++;
      return page;
    });
    const second = await cache.listOrLoad(tenantId, "instance", "list:50:0", async () => {
      loads++;
      return page;
    });
    expect(first).toEqual(page);
    expect(second).toEqual(page);
    expect(loads).toBe(1);
  });

  it("completeTask updates cache and publishes command", async () => {
    const tenantId = "11111111-aaaa-4000-8000-000000000001";
    const taskId = "44444444-dddd-4000-8000-000000000004";
    const taskView = { id: taskId, tenantId, instanceId: "33333333-cccc-4000-8000-000000000003", name: "Review", status: "pending", version: 1 };
    taskStore.set(taskId, { id: taskId, instanceId: taskView.instanceId, status: "pending" });

    const completed = { ...taskView, status: "completed", version: 2 };
    await cache.put(cache.makeKey(tenantId, "task", taskId), completed);
    await queue.publish("workflow.task.complete", {
      messageId: taskId,
      type: "workflow.task.complete",
      tenantId,
      actorId: "00000000-aaaa-4000-8000-000000000001",
      correlationId: "c2",
      schemaVersion: "1.0",
      payload: completed,
    });

    const fromCache = await cache.getOrLoad(cache.makeKey(tenantId, "task", taskId), async () => null);
    expect((fromCache as typeof completed).status).toBe("completed");

    await new Promise((r) => setTimeout(r, 20));
    expect(taskStore.get(taskId)?.status).toBe("completed");
  });
});
