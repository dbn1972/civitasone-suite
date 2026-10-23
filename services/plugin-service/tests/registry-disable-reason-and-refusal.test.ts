/**
 * Registry disable carries a mandatory audited reason; the consumer refuses an
 * unknown plugin id LOUDLY (failure audit event, no success event) instead of
 * silently returning. Real DB, real Fastify, MemoryQueue wired like worker.ts.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { registerRegistryConsumers } from "../src/modules/registry/consumer.js";
import { plugins } from "../src/modules/registry/schema.js";
import { queue as appQueue } from "../src/shared/infra.js";
import { COMMANDS, EVENTS } from "../src/topics.js";

const SECRET = process.env.JWT_SECRET as string;
const TENANT = randomUUID();
const ACTOR = randomUUID();
const hdr = () => ({
  authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles: ["plugin_admin"], sid: "s-pl" }, SECRET, 3600)}`,
  "content-type": "application/json",
});

function tenantScopedQueue(): MemoryQueue {
  const queue = new MemoryQueue();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q = queue as any;
  const raw = q.subscribe.bind(q);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  q.subscribe = (topic: string, handler: (msg: any) => Promise<void>) => raw(topic, (msg: any) => runWithTenant(msg.tenantId, () => handler(msg)));
  return queue;
}

async function seed(state: string): Promise<string> {
  const id = randomUUID();
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(plugins).values({ id, tenantId: TENANT, manifestJson: {}, state, installedAt: new Date(), createdBy: ACTOR, updatedBy: ACTOR, version: 1 });
  }));
  return id;
}
const stateOf = (id: string) => runWithTenant(TENANT, () => db.transaction(async (tx) => (await tx.select().from(plugins).where(eq(plugins.id, id)).limit(1))[0]?.state));
const outbox = (topic: string) => runWithTenant(TENANT, () => db.transaction((tx) =>
  tx.select().from(outboxMessages).where(and(eq(outboxMessages.topic, topic), eq(outboxMessages.tenantId, TENANT)))));

let app: FastifyInstance;
beforeAll(async () => { app = await buildApp(); });
afterAll(async () => {
  await app.close();
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(plugins).where(eq(plugins.tenantId, TENANT));
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
  }));
  await sqlClient.end();
});

describe("POST /v1/plugins/:id/disable requires a reason", () => {
  const url = `/v1/plugins/${randomUUID()}/disable`;
  it("400 without a body", async () => {
    const { authorization } = hdr();
    const r = await app.inject({ method: "POST", url, headers: { authorization } });
    expect(r.statusCode).toBe(400);
  });
  it("400 for a too-short or too-long reason", async () => {
    expect((await app.inject({ method: "POST", url, headers: hdr(), payload: { reason: "ab" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url, headers: hdr(), payload: { reason: "x".repeat(501) } })).statusCode).toBe(400);
  });
  it("202 with a reason, and the reason rides the command payload", async () => {
    const seen: unknown[] = [];
    const orig = appQueue.publish.bind(appQueue);
    (appQueue as { publish: unknown }).publish = async (topic: string, env: { payload: unknown }) => { if (topic === COMMANDS.pluginDisable) seen.push(env.payload); return orig(topic, env as never); };
    try {
      const r = await app.inject({ method: "POST", url, headers: hdr(), payload: { reason: "  vendor withdrew support  " } });
      expect(r.statusCode).toBe(202);
    } finally { (appQueue as { publish: unknown }).publish = orig; }
    expect(seen[0]).toMatchObject({ reason: "vendor withdrew support" });
  });
});

describe("registry consumer refuses loudly", () => {
  it.each([
    ["enable", COMMANDS.pluginEnable],
    ["disable", COMMANDS.pluginDisable],
    ["uninstall", COMMANDS.pluginUninstall],
    ["configure", COMMANDS.pluginConfigure],
  ] as const)("%s of an unknown id: failure audit, no success event", async (action, topic) => {
    const queue = tenantScopedQueue();
    registerRegistryConsumers(queue);
    const ghost = randomUUID();
    await queue.publish(topic, {
      messageId: randomUUID(), type: topic, tenantId: TENANT, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { pluginId: ghost, tenantId: TENANT, config: {}, reason: "because" },
    });
    await queue.drain();
    const audits = (await outbox("audit.event.record")).filter((r) => (r.payload as { resourceId?: string }).resourceId === ghost);
    expect(audits).toHaveLength(1);
    expect(audits[0]?.payload).toMatchObject({ action, outcome: "failure", code: "UNKNOWN_PLUGIN" });
    for (const t of [EVENTS.pluginEnabled, EVENTS.pluginDisabled, EVENTS.pluginUninstalled, EVENTS.pluginConfigured]) {
      expect((await outbox(t)).filter((r) => (r.payload as { pluginId?: string }).pluginId === ghost)).toHaveLength(0);
    }
  });

  it("an illegal transition (disable an `installed` plugin) is refused with INVALID_TRANSITION and the state is unchanged", async () => {
    const id = await seed("installed");
    const queue = tenantScopedQueue();
    registerRegistryConsumers(queue);
    await queue.publish(COMMANDS.pluginDisable, {
      messageId: randomUUID(), type: COMMANDS.pluginDisable, tenantId: TENANT, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { pluginId: id, tenantId: TENANT, reason: "try" },
    });
    await queue.drain();
    expect(await stateOf(id)).toBe("installed");
    const a = (await outbox("audit.event.record")).filter((r) => (r.payload as { resourceId?: string }).resourceId === id);
    expect(a[0]?.payload).toMatchObject({ outcome: "failure", code: "INVALID_TRANSITION", from: "installed" });
  });

  it("a valid disable records the reason on the event and audit", async () => {
    const id = await seed("enabled");
    const queue = tenantScopedQueue();
    registerRegistryConsumers(queue);
    await queue.publish(COMMANDS.pluginDisable, {
      messageId: randomUUID(), type: COMMANDS.pluginDisable, tenantId: TENANT, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { pluginId: id, tenantId: TENANT, reason: "security advisory" },
    });
    await queue.drain();
    expect(await stateOf(id)).toBe("disabled");
    const a = (await outbox("audit.event.record")).filter((r) => (r.payload as { resourceId?: string }).resourceId === id);
    expect(a[0]?.payload).toMatchObject({ action: "disable", outcome: "success", reason: "security advisory" });
  });
});
