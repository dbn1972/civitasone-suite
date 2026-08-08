/**
 * Hook execution consumer — listens for domain events and fires matching plugin hooks.
 *
 * Subscribes to the "plugin.event.dispatch" topic. Other services emit to this
 * topic when a hookable event fires. The dispatcher looks up active hooks for
 * the event type + tenant and runs them in the sandboxed engine.
 *
 * Flow:
 *   1. Domain event → queue: plugin.event.dispatch { eventType, tenantId, payload }
 *   2. This consumer finds active hooks where hook.eventType matches
 *   3. For each match, executes the handler in the sandbox
 *   4. Records execution result in DB for audit/debugging
 */
import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { pluginHooks } from "../hooks/schema.js";
import { plugins } from "../registry/schema.js";
import { eq, and } from "drizzle-orm";
import { executeHooks, type PluginHookDef, type PluginManifest } from "./engine.js";
import { shouldDeliverEvent } from "../events/domain.js";
import { isPluginAllowed } from "../events/preview.js";
import type { PluginManifest as SandboxManifest, PluginPermission } from "../sandbox/types.js";

const AUDIT_TOPIC = "audit.event.record";

const log = pino({ name: "plugin-runtime-consumer" });

const DISPATCH_TOPIC = "plugin.event.dispatch";

interface DispatchPayload {
  eventType: string;
  tenantId: string;
  payload: Record<string, unknown>;
  correlationId: string;
}

export function registerRuntimeConsumers(queue: Queue): void {
  queue.subscribe<DispatchPayload>(DISPATCH_TOPIC, async (msg) => {
    const { eventType, tenantId, payload, correlationId } = msg.payload;

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      // Load active hooks for this event type + tenant
      const hooks = await tx.select().from(pluginHooks)
        .where(and(
          eq(pluginHooks.tenantId, tenantId),
          eq(pluginHooks.eventType, eventType),
          eq(pluginHooks.active, true),
        ));

      if (hooks.length === 0) return; // no hooks registered for this event

      // Build the hook definitions for the engine
      const hookDefs: PluginHookDef[] = hooks.map((h) => ({
        id: h.id,
        pluginId: h.pluginId,
        tenantId: h.tenantId,
        eventType: h.eventType,
        handlerPath: h.handlerPath,
        active: h.active,
      }));

      // Manifest lookup: load plugin manifests for permission checks
      const pluginIds = [...new Set(hooks.map((h) => h.pluginId))];
      const pluginRows = await tx.select().from(plugins)
        .where(and(eq(plugins.tenantId, tenantId)));
      const manifestMap = new Map<string, PluginManifest>();
      for (const p of pluginRows) {
        if (pluginIds.includes(p.id)) {
          const manifest = p.manifestJson as Record<string, unknown>;
          const sandboxManifest: SandboxManifest = {
            id: p.id,
            permissions: ((manifest["permissions"] as string[]) ?? []) as PluginPermission[],
            events: (manifest["events"] as string[]) ?? [],
          };

          // Skip preview plugins when the feature gate is disabled
          if (!isPluginAllowed(sandboxManifest)) {
            log.debug({ pluginId: p.id }, "skipping preview plugin — feature gate disabled");
            continue;
          }

          // Only deliver event if manifest declares this event type
          if (!shouldDeliverEvent(sandboxManifest, eventType)) {
            log.debug({ pluginId: p.id, eventType }, "skipping plugin — not subscribed to event");
            continue;
          }

          manifestMap.set(p.id, {
            name: (manifest["name"] as string) ?? "unknown",
            version: (manifest["version"] as string) ?? "0.0.0",
            permissions: (manifest["permissions"] as string[]) ?? [],
            events: (manifest["events"] as string[]) ?? [],
          });
        }
      }

      const results = await executeHooks(
        hookDefs,
        { tenantId, eventType, payload, correlationId },
        (pluginId) => manifestMap.get(pluginId) ?? null,
      );

      for (const r of results) {
        if (r.status === "error" || r.status === "timeout") {
          log.warn({ hookId: r.hookId, status: r.status, error: r.error }, "hook execution failed");
        }
      }

      log.info({ eventType, tenantId, hookCount: hooks.length, executed: results.length }, "hooks dispatched");
      await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "plugin-service", action: "process", resourceType: "runtime", resourceId: msg.messageId, outcome: "success" } });
    });
  });
}
