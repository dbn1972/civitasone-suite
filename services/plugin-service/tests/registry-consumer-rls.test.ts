/**
 * TX-003 — registry consumer reads under FORCE RLS.
 *
 * registry.plugins is FORCE ROW LEVEL SECURITY (0003b, 0004) and plugin_svc
 * is NOBYPASSRLS. The enable/disable/uninstall consumers used to look up the
 * plugin via repo.findById(), a bare db.select() carrying no app.tenant_id
 * GUC — so it always returned null even for a plugin that genuinely exists,
 * and each consumer took the "not found" branch: markProcessed() committed
 * (message acked) but the plugin's real state never changed and no
 * plugins.registry.{enabled,disabled,uninstalled} event was ever emitted.
 *
 * These tests exercise the real production wiring — a MemoryQueue wrapped
 * exactly like worker.ts wraps the live queue (runWithTenant(msg.tenantId,
 * ...) around every delivery) — against a real Postgres under FORCE RLS, so
 * they fail on the pre-fix code and pass once repo.findByIdTx()/consumer.ts
 * route the read through the transaction's own GUC-scoped handle.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { registerRegistryConsumers } from "../src/modules/registry/consumer.js";
import { plugins } from "../src/modules/registry/schema.js";
import { COMMANDS, EVENTS } from "../src/topics.js";

const TENANT = "c9000000-0000-4000-8000-000000000301";
const ACTOR = "c9000000-0000-4000-8000-0000000000aa";

/** Mirrors worker.ts's production wiring exactly — see its top-level q.subscribe override. */
function tenantScopedQueue(): MemoryQueue {
  const queue = new MemoryQueue();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q = queue as any;
  const rawSubscribe = q.subscribe.bind(q);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  q.subscribe = (topic: string, handler: (msg: any) => Promise<void>) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rawSubscribe(topic, (msg: any) => runWithTenant(msg.tenantId, () => handler(msg)));
  return queue;
}

async function seedPlugin(state: string): Promise<string> {
  const id = randomUUID();
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.insert(plugins).values({
        id,
        tenantId: TENANT,
        manifestJson: {},
        state,
        installedAt: new Date(),
        createdBy: ACTOR,
        updatedBy: ACTOR,
        version: 1,
      });
    }),
  );
  return id;
}

async function readPlugin(id: string) {
  return runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      const rows = await tx.select().from(plugins).where(eq(plugins.id, id)).limit(1);
      return rows[0];
    }),
  );
}

async function hasSuccessEvent(topic: string, pluginId: string): Promise<boolean> {
  return runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(outboxMessages)
        .where(and(eq(outboxMessages.topic, topic), eq(outboxMessages.tenantId, TENANT)));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return rows.some((r) => (r.payload as any)?.pluginId === pluginId);
    }),
  );
}

describe("TX-003 — registry consumer reads under FORCE RLS", () => {
  afterAll(async () => {
    await runWithTenant(TENANT, () =>
      db.transaction(async (tx) => {
        await tx.delete(plugins).where(eq(plugins.tenantId, TENANT));
        await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
      }),
    );
    await sqlClient.end();
  });

  it("enable: a genuinely-existing plugin actually transitions installed -> enabled, and the enabled event is emitted (not a silent no-op ack)", async () => {
    const id = await seedPlugin("installed");
    const queue = tenantScopedQueue();
    registerRegistryConsumers(queue);
    await queue.publish(COMMANDS.pluginEnable, {
      messageId: randomUUID(),
      type: COMMANDS.pluginEnable,
      tenantId: TENANT,
      actorId: ACTOR,
      correlationId: "corr-tx003-enable",
      schemaVersion: "1.0",
      payload: { pluginId: id, tenantId: TENANT },
    });
    await queue.drain();

    const row = await readPlugin(id);
    expect(row?.state).toBe("enabled");
    expect(row?.enabledAt).not.toBeNull();
    expect(await hasSuccessEvent(EVENTS.pluginEnabled, id)).toBe(true);
  });

  it("disable: a genuinely-existing enabled plugin actually transitions to disabled, and the disabled event is emitted (not a silent no-op ack)", async () => {
    const id = await seedPlugin("enabled");
    const queue = tenantScopedQueue();
    registerRegistryConsumers(queue);
    await queue.publish(COMMANDS.pluginDisable, {
      messageId: randomUUID(),
      type: COMMANDS.pluginDisable,
      tenantId: TENANT,
      actorId: ACTOR,
      correlationId: "corr-tx003-disable",
      schemaVersion: "1.0",
      payload: { pluginId: id, tenantId: TENANT },
    });
    await queue.drain();

    const row = await readPlugin(id);
    expect(row?.state).toBe("disabled");
    expect(row?.disabledAt).not.toBeNull();
    expect(await hasSuccessEvent(EVENTS.pluginDisabled, id)).toBe(true);
  });

  it("uninstall: a genuinely-existing installed plugin actually transitions to uninstalled, and the uninstalled event is emitted (not a silent no-op ack)", async () => {
    const id = await seedPlugin("installed");
    const queue = tenantScopedQueue();
    registerRegistryConsumers(queue);
    await queue.publish(COMMANDS.pluginUninstall, {
      messageId: randomUUID(),
      type: COMMANDS.pluginUninstall,
      tenantId: TENANT,
      actorId: ACTOR,
      correlationId: "corr-tx003-uninstall",
      schemaVersion: "1.0",
      payload: { pluginId: id, tenantId: TENANT },
    });
    await queue.drain();

    const row = await readPlugin(id);
    expect(row?.state).toBe("uninstalled");
    expect(await hasSuccessEvent(EVENTS.pluginUninstalled, id)).toBe(true);
  });

  it("regression guard: repo.findById() (the bare, non-tx read) stays RLS-blind even for a genuinely-existing plugin — consumers must use findByIdTx()", async () => {
    const id = await seedPlugin("installed");
    const { findById } = await import("../src/modules/registry/repo.js");
    const bare = await findById(id, TENANT);
    expect(bare).toBeNull();
  });
});
