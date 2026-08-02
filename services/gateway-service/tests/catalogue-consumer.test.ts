/**
 * Catalogue CQRS consumer — applies writes under tenant GUC + inbox idempotency.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { withTenantScope } from "@civitasone/db";
import { COMMANDS } from "../src/topics.js";
import { registerCatalogueConsumers } from "../src/modules/catalogue/consumer.js";
import { db } from "../src/modules/catalogue/db.js";
import { apiEntry, apiChangelog } from "../src/modules/catalogue/schema.js";

const TENANT = "ca7a1041-0000-4000-8000-0000000000c1";
const ACTOR = "ac70b111-0000-4000-8000-0000000000c9";

async function wipe(tenantId: string) {
  await withTenantScope(db as any, tenantId, async (tx: any) => {
    await tx.delete(apiChangelog).where(eq(apiChangelog.tenantId, tenantId));
    await tx.delete(apiEntry).where(eq(apiEntry.tenantId, tenantId));
  });
}

describe("catalogue consumers", () => {
  let queue: MemoryQueue;

  beforeAll(async () => {
    process.env.QUEUE_DRIVER = "memory";
    await wipe(TENANT);
    queue = new MemoryQueue();
    registerCatalogueConsumers(queue);
    await queue.start();
  });

  afterAll(async () => {
    await queue.stop();
    await wipe(TENANT);
  });

  it("applies register + activate lifecycle; inbox blocks duplicate messageId", async () => {
    const id = randomUUID();
    const messageId = randomUUID();
    const payload = {
      id,
      tenantId: TENANT,
      name: "consumer-api",
      module: "gateway",
      version: "v1",
      path: `/api/v1/consumer-api-${id}`,
      method: "GET",
      status: "draft" as const,
      source: "manual" as const,
    };
    await queue.publish(COMMANDS.registerApi, {
      messageId,
      type: COMMANDS.registerApi,
      tenantId: TENANT,
      actorId: ACTOR,
      correlationId: randomUUID(),
      schemaVersion: "1.0",
      payload,
    });
    await queue.drain();

    // Simulate inbox-level redelivery by invoking markProcessed path with a fresh
    // MemoryQueue delivery key but the same messageId (second MemoryQueue instance).
    const q2 = new MemoryQueue();
    registerCatalogueConsumers(q2);
    await q2.start();
    await q2.publish(COMMANDS.registerApi, {
      messageId,
      type: COMMANDS.registerApi,
      tenantId: TENANT,
      actorId: ACTOR,
      correlationId: randomUUID(),
      schemaVersion: "1.0",
      payload,
    });
    await q2.drain();
    await q2.stop();

    const rows = await withTenantScope(db as any, TENANT, (tx: any) =>
      tx.select().from(apiEntry).where(eq(apiEntry.id, id)),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("draft");

    await queue.publish(COMMANDS.lifecycleApi, {
      messageId: randomUUID(),
      type: COMMANDS.lifecycleApi,
      tenantId: TENANT,
      actorId: ACTOR,
      correlationId: randomUUID(),
      schemaVersion: "1.0",
      payload: { id, action: "activate" },
    });
    await queue.drain();

    const after = await withTenantScope(db as any, TENANT, (tx: any) =>
      tx.select().from(apiEntry).where(eq(apiEntry.id, id)).limit(1),
    );
    expect(after[0]?.status).toBe("active");
  });

  it("failure path: invalid lifecycle is a no-op (no throw)", async () => {
    const id = randomUUID();
    await queue.publish(COMMANDS.registerApi, {
      messageId: randomUUID(),
      type: COMMANDS.registerApi,
      tenantId: TENANT,
      actorId: ACTOR,
      correlationId: randomUUID(),
      schemaVersion: "1.0",
      payload: {
        id,
        tenantId: TENANT,
        name: "term-api",
        module: "gateway",
        version: "v1",
        path: `/api/v1/term-api-${id}`,
        method: "GET",
        status: "draft",
        source: "manual",
      },
    });
    await queue.drain();
    // draft → retire is invalid
    await queue.publish(COMMANDS.lifecycleApi, {
      messageId: randomUUID(),
      type: COMMANDS.lifecycleApi,
      tenantId: TENANT,
      actorId: ACTOR,
      correlationId: randomUUID(),
      schemaVersion: "1.0",
      payload: { id, action: "retire" },
    });
    await queue.drain();
    const row = await withTenantScope(db as any, TENANT, (tx: any) =>
      tx.select().from(apiEntry).where(eq(apiEntry.id, id)).limit(1),
    );
    expect(row[0]?.status).toBe("draft");
  });
});
