import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import type { PluginView, PluginState } from "./schema.js";

const AUDIT_TOPIC = "audit.event.record";
const RESOURCE = "plugin";

function keyFor(tenantId: string, id: string) {
  return cache.makeKey(tenantId, RESOURCE, id);
}

/**
 * Valid state transitions (lifecycle state machine):
 *   uploaded → installed → enabled → active → disabled → uninstalled
 *   enabled → disabled (skip active)
 *   installed → uninstalled (skip enable)
 */
const VALID_TRANSITIONS: Record<string, PluginState[]> = {
  uploaded: ["installed"],
  installed: ["enabled", "uninstalled"],
  enabled: ["active", "disabled"],
  active: ["disabled"],
  disabled: ["enabled", "uninstalled"],
};

function isValidTransition(from: PluginState, to: PluginState): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

export function registerRegistryConsumers(queue: Queue): void {
  // Install
  queue.subscribe<PluginView>(COMMANDS.pluginInstall, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;
      await repo.insert(tx, {
        id: p.id,
        tenantId: p.tenantId,
        manifestJson: p.manifestJson,
        state: "installed",
        installedAt: new Date(),
        ...(p.config != null ? { config: p.config } : {}),
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
        version: 1,
      });
      await emit(tx, msg, EVENTS.pluginInstalled, { pluginId: p.id }, "install", p.id);
    });
    await cache.put(keyFor(msg.tenantId, msg.payload.id), msg.payload);
    await cache.invalidateResource(msg.tenantId, RESOURCE);
  });

  // Enable
  queue.subscribe<{ pluginId: string; tenantId: string }>(COMMANDS.pluginEnable, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const existing = await repo.findByIdTx(tx, msg.payload.pluginId, msg.payload.tenantId);
      if (!existing) return refuse(tx, msg, "enable", msg.payload.pluginId, "UNKNOWN_PLUGIN");
      if (!isValidTransition(existing.state, "enabled")) return refuse(tx, msg, "enable", msg.payload.pluginId, "INVALID_TRANSITION", { from: existing.state });
      await repo.updateState(tx, msg.payload.pluginId, "enabled", msg.actorId);
      await emit(tx, msg, EVENTS.pluginEnabled, { pluginId: msg.payload.pluginId }, "enable", msg.payload.pluginId);
    });
    await cache.invalidateResource(msg.tenantId, RESOURCE);
  });

  // Disable
  queue.subscribe<{ pluginId: string; tenantId: string; reason?: string }>(COMMANDS.pluginDisable, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const existing = await repo.findByIdTx(tx, msg.payload.pluginId, msg.payload.tenantId);
      if (!existing) return refuse(tx, msg, "disable", msg.payload.pluginId, "UNKNOWN_PLUGIN", {}, msg.payload.reason);
      if (!isValidTransition(existing.state, "disabled")) return refuse(tx, msg, "disable", msg.payload.pluginId, "INVALID_TRANSITION", { from: existing.state }, msg.payload.reason);
      await repo.updateState(tx, msg.payload.pluginId, "disabled", msg.actorId);
      await emit(tx, msg, EVENTS.pluginDisabled, { pluginId: msg.payload.pluginId, reason: msg.payload.reason }, "disable", msg.payload.pluginId, msg.payload.reason);
    });
    await cache.invalidateResource(msg.tenantId, RESOURCE);
  });

  // Uninstall
  queue.subscribe<{ pluginId: string; tenantId: string }>(COMMANDS.pluginUninstall, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const existing = await repo.findByIdTx(tx, msg.payload.pluginId, msg.payload.tenantId);
      if (!existing) return refuse(tx, msg, "uninstall", msg.payload.pluginId, "UNKNOWN_PLUGIN");
      if (!isValidTransition(existing.state, "uninstalled")) return refuse(tx, msg, "uninstall", msg.payload.pluginId, "INVALID_TRANSITION", { from: existing.state });
      await repo.updateState(tx, msg.payload.pluginId, "uninstalled", msg.actorId);
      await emit(tx, msg, EVENTS.pluginUninstalled, { pluginId: msg.payload.pluginId }, "uninstall", msg.payload.pluginId);
    });
    await cache.invalidateResource(msg.tenantId, RESOURCE);
  });

  // Configure
  queue.subscribe<{ pluginId: string; tenantId: string; config: Record<string, unknown> }>(COMMANDS.pluginConfigure, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const existing = await repo.findByIdTx(tx, msg.payload.pluginId, msg.payload.tenantId);
      if (!existing) return refuse(tx, msg, "configure", msg.payload.pluginId, "UNKNOWN_PLUGIN");
      await repo.updateConfig(tx, msg.payload.pluginId, msg.payload.config, msg.actorId);
      await emit(tx, msg, EVENTS.pluginConfigured, { pluginId: msg.payload.pluginId }, "configure", msg.payload.pluginId);
    });
    await cache.invalidateResource(msg.tenantId, RESOURCE);
  });
}

/**
 * A command for an unknown plugin id (or an illegal lifecycle transition) is refused
 * loudly: no state change, no success event, and an audit event with outcome "failure".
 * It is NOT silently dropped, so a UI wired to the wrong resource shows up in the audit trail.
 */
async function refuse(
  tx: unknown, msg: CommandEnvelope, action: string, resourceId: string, code: "UNKNOWN_PLUGIN" | "INVALID_TRANSITION",
  extra: Record<string, unknown> = {}, reason?: string,
): Promise<void> {
  await enqueue(tx as Parameters<typeof enqueue>[0], {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "plugins", action, resourceType: "plugin", resourceId, outcome: "failure", code, ...extra, ...(reason ? { reason } : {}) },
  });
}

async function emit(tx: unknown, msg: CommandEnvelope, eventType: string, payload: Record<string, unknown>, action: string, resourceId: string, reason?: string): Promise<void> {
  const t = tx as Parameters<typeof enqueue>[0];
  await enqueue(t, { topic: eventType, eventType, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload });
  await enqueue(t, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "plugins", action, resourceType: "plugin", resourceId, outcome: "success", ...(reason ? { reason } : {}) } });
}
