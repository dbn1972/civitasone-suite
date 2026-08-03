/**
 * Routing module CQRS — command publish + consumer persistence + idempotency.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { MemoryQueue, type Queue, type Handler } from "@civitasone/queue";
import { db, sqlClient } from "../src/shared/db.js";
import { routingRules } from "../src/modules/routing/schema.js";
import { agentCapacity } from "../src/modules/routing/capacity-schema.js";
import { holdQueue } from "../src/modules/routing/queue-schema.js";
import { outboxSchema } from "../src/shared/outbox.js";
import { registerRoutingConsumers } from "../src/modules/routing/consumer.js";
import { COMMANDS } from "../src/topics.js";

const { outboxMessages } = outboxSchema;
const TENANT = "aaaaaaaa-0000-4000-8000-00000000rt01";
const ACTOR = "00000000-aaaa-4000-8000-00000000rt99";

const publish = vi.fn().mockResolvedValue(undefined);
vi.mock("../src/shared/infra.js", () => ({
  queue: { publish: (...args: unknown[]) => publish(...args) },
  cache: { invalidate: vi.fn(), makeKey: (...parts: string[]) => parts.join(":") },
}));

const ctx = {
  tenantId: TENANT,
  actorId: ACTOR,
  correlationId: "corr-routing-cqrs",
  roles: ["helpdesk_admin"],
};

function wireTenantAwareQueue(q: Queue): Queue {
  const rawSubscribe = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    rawSubscribe(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  return q;
}

function wired() {
  const q = wireTenantAwareQueue(new MemoryQueue());
  registerRoutingConsumers(q);
  return q;
}

async function cleanup() {
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.delete(holdQueue).where(eq(holdQueue.tenantId, TENANT));
      await tx.delete(agentCapacity).where(eq(agentCapacity.tenantId, TENANT));
      await tx.delete(routingRules).where(eq(routingRules.tenantId, TENANT));
      await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
    }),
  );
}

beforeEach(async () => {
  publish.mockClear();
  await cleanup();
});
afterAll(async () => {
  await cleanup();
  await sqlClient.end();
});

describe("routing routes CQRS wiring", () => {
  it("routing routes have zero db.transaction on mutating handlers", () => {
    const src = readFileSync(resolve(__dirname, "../src/modules/routing/routes.ts"), "utf8");
    expect(src).toMatch(/commands\./);
    expect(src).toMatch(/reply\.code\(202\)/);
    expect(src).not.toMatch(/tx\.insert\(routingRules\)/);
    expect(src).not.toMatch(/tx\.insert\(holdQueue\)/);
  });

  it("worker registers routing consumers", () => {
    const src = readFileSync(resolve(__dirname, "../src/worker.ts"), "utf8");
    expect(src).toMatch(/registerRoutingConsumers/);
  });
});

describe("routing commands publish", () => {
  it("createRule publishes routingRuleCreate", async () => {
    const { createRule } = await import("../src/modules/routing/commands.js");
    const res = await createRule(ctx as never, {
      name: "Default",
      strategy: "round_robin",
      weight: 1,
      enabled: true,
      ordinal: 0,
    });
    expect(res.status).toBe("accepted");
    expect(publish).toHaveBeenCalledWith(
      COMMANDS.routingRuleCreate,
      expect.objectContaining({ type: COMMANDS.routingRuleCreate, tenantId: TENANT }),
    );
  });
});

describe("routing consumer persistence", () => {
  it("creates a routing rule", async () => {
    const q = wired();
    const id = randomUUID();
    await q.publish(COMMANDS.routingRuleCreate, {
      messageId: id,
      type: COMMANDS.routingRuleCreate,
      tenantId: TENANT,
      actorId: ACTOR,
      correlationId: randomUUID(),
      schemaVersion: "1.0",
      payload: {
        id,
        tenantId: TENANT,
        name: "Skill route",
        strategy: "skill_based",
        criteria: { requiredSkills: ["networking"] },
        weight: 1,
        enabled: true,
        ordinal: 0,
      },
    });
    await new Promise((r) => setTimeout(r, 150));

    const rows = await runWithTenant(TENANT, () =>
      db.transaction((tx) => tx.select().from(routingRules).where(eq(routingRules.id, id))),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe("Skill route");
  });

  it("createRule is idempotent on messageId redelivery", async () => {
    const q = wired();
    const id = randomUUID();
    const msg = {
      messageId: id,
      type: COMMANDS.routingRuleCreate,
      tenantId: TENANT,
      actorId: ACTOR,
      correlationId: randomUUID(),
      schemaVersion: "1.0",
      payload: {
        id,
        tenantId: TENANT,
        name: "Once",
        strategy: "least_busy",
        criteria: null,
        weight: 1,
        enabled: true,
        ordinal: 0,
      },
    };
    await q.publish(COMMANDS.routingRuleCreate, msg);
    await q.publish(COMMANDS.routingRuleCreate, msg);
    await new Promise((r) => setTimeout(r, 200));

    const rows = await runWithTenant(TENANT, () =>
      db.transaction((tx) => tx.select().from(routingRules).where(eq(routingRules.id, id))),
    );
    expect(rows).toHaveLength(1);
  });

  it("upserts agent capacity", async () => {
    const q = wired();
    const agentId = randomUUID();
    await q.publish(COMMANDS.routingCapacityUpsert, {
      messageId: randomUUID(),
      type: COMMANDS.routingCapacityUpsert,
      tenantId: TENANT,
      actorId: ACTOR,
      correlationId: randomUUID(),
      schemaVersion: "1.0",
      payload: { tenantId: TENANT, agentId, maxTickets: 5, skills: ["java"], available: true },
    });
    await new Promise((r) => setTimeout(r, 150));

    const rows = await runWithTenant(TENANT, () =>
      db.transaction((tx) =>
        tx.select().from(agentCapacity).where(and(eq(agentCapacity.agentId, agentId), eq(agentCapacity.tenantId, TENANT))),
      ),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.maxTickets).toBe(5);
  });

  it("enqueues and dequeues a ticket", async () => {
    const q = wired();
    const ticketId = randomUUID();
    const entryId = randomUUID();
    await q.publish(COMMANDS.routingQueueEnqueue, {
      messageId: entryId,
      type: COMMANDS.routingQueueEnqueue,
      tenantId: TENANT,
      actorId: ACTOR,
      correlationId: randomUUID(),
      schemaVersion: "1.0",
      payload: { id: entryId, tenantId: TENANT, ticketId, queueName: "default", priority: 3 },
    });
    await new Promise((r) => setTimeout(r, 150));

    let rows = await runWithTenant(TENANT, () =>
      db.transaction((tx) => tx.select().from(holdQueue).where(eq(holdQueue.ticketId, ticketId))),
    );
    expect(rows).toHaveLength(1);

    await q.publish(COMMANDS.routingQueueDequeue, {
      messageId: randomUUID(),
      type: COMMANDS.routingQueueDequeue,
      tenantId: TENANT,
      actorId: ACTOR,
      correlationId: randomUUID(),
      schemaVersion: "1.0",
      payload: { tenantId: TENANT, queueName: "default" },
    });
    await new Promise((r) => setTimeout(r, 150));

    rows = await runWithTenant(TENANT, () =>
      db.transaction((tx) => tx.select().from(holdQueue).where(eq(holdQueue.ticketId, ticketId))),
    );
    expect(rows).toHaveLength(0);
  });
});
