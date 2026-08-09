/**
 * dashboards consumer — the ONLY code that writes dashboard tables.
 * Idempotent via inbox markProcessed; emits domain + audit events through the
 * transactional outbox in the same tx as the business write.
 */
import { pino } from "pino";
import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS, AUDIT_TOPIC, DASHBOARD_RESOURCE } from "../../topics.js";
import * as repo from "./repo.js";
import type { DashboardLayout } from "./schema.js";
import { tenantScoped } from "../../shared/tenant-queue.js";

const log = pino({ name: "analytics-dashboards-consumer" });
type Tx = Parameters<typeof enqueue>[0];

async function audit(
  tx: Tx,
  msg: CommandEnvelope,
  action: string,
  resourceId: string,
  outcome: "success" | "failure" = "success",
): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC,
    eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: { service: "analytics", action, resourceType: "dashboard", resourceId, outcome },
  });
}

async function emit(
  tx: Tx,
  msg: CommandEnvelope,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await enqueue(tx, {
    topic: eventType,
    eventType,
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload,
  });
}

export function registerDashboardsConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);
  queue.subscribe<Record<string, unknown>>(COMMANDS.createDashboard, async (msg) => {
    try {
      const p = msg.payload as {
        id: string;
        name: string;
        description: string | null;
        status: string;
        ownerId: string | null;
        visibility: string;
        layout: DashboardLayout;
      };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await repo.insert(tx, {
          id: p.id,
          tenantId: msg.tenantId,
          name: p.name,
          description: p.description,
          status: p.status,
          ownerId: p.ownerId ?? msg.actorId,
          visibility: p.visibility,
          layout: p.layout ?? {},
          createdBy: msg.actorId,
          updatedBy: msg.actorId,
          version: 1,
        });
        await emit(tx, msg, EVENTS.dashboardCreated, { dashboardId: p.id, name: p.name });
        await audit(tx, msg, "create", p.id);
      });
      await cache.invalidateResource(msg.tenantId, DASHBOARD_RESOURCE);
    } catch (err) {
      log.error({ err, messageId: msg.messageId, type: COMMANDS.createDashboard }, "Consumer processing failed");
      throw err; // H11 FIX: rethrow so message redelivers/DLQs
    }
  });

  queue.subscribe<Record<string, unknown>>(COMMANDS.updateDashboard, async (msg) => {
    try {
      const p = msg.payload as {
        dashboardId: string;
        expectedVersion: number;
        patch: Record<string, unknown>;
      };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const ok = await repo.updateWithVersion(
          tx,
          p.dashboardId,
          msg.tenantId,
          p.expectedVersion,
          p.patch,
          msg.actorId,
        );
        if (!ok) {
          // version conflict — record the failed attempt, change nothing.
          await audit(tx, msg, "update_conflict", p.dashboardId, "failure");
          return;
        }
        await emit(tx, msg, EVENTS.dashboardUpdated, { dashboardId: p.dashboardId });
        await audit(tx, msg, "update", p.dashboardId);
      });
      await cache.invalidate(cache.makeKey(msg.tenantId, DASHBOARD_RESOURCE, p.dashboardId));
      await cache.invalidateResource(msg.tenantId, DASHBOARD_RESOURCE);
    } catch (err) {
      log.error({ err, messageId: msg.messageId, type: COMMANDS.updateDashboard }, "Consumer processing failed");
      throw err; // H11 FIX: rethrow so message redelivers/DLQs
    }
  });

  queue.subscribe<Record<string, unknown>>(COMMANDS.addWidget, async (msg) => {
    try {
      const p = msg.payload as {
        widgetId: string;
        dashboardId: string;
        title: string;
        vizType: string;
        spec: Record<string, unknown>;
        position: number;
      };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await repo.insertWidget(tx, {
          id: p.widgetId,
          tenantId: msg.tenantId,
          dashboardId: p.dashboardId,
          title: p.title,
          vizType: p.vizType,
          spec: p.spec,
          position: p.position,
          createdBy: msg.actorId,
          updatedBy: msg.actorId,
          version: 1,
        });
        await emit(tx, msg, EVENTS.widgetAdded, { widgetId: p.widgetId, dashboardId: p.dashboardId });
        await audit(tx, msg, "add_widget", p.dashboardId);
      });
      await cache.invalidate(cache.makeKey(msg.tenantId, DASHBOARD_RESOURCE, p.dashboardId));
    } catch (err) {
      log.error({ err, messageId: msg.messageId, type: COMMANDS.addWidget }, "Consumer processing failed");
      throw err; // H11 FIX: rethrow so message redelivers/DLQs
    }
  });

  queue.subscribe<Record<string, unknown>>(COMMANDS.shareDashboard, async (msg) => {
    try {
      const p = msg.payload as {
        shareId: string;
        dashboardId: string;
        principalId: string;
        access: string;
      };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await repo.upsertShare(tx, {
          id: p.shareId,
          tenantId: msg.tenantId,
          dashboardId: p.dashboardId,
          principalId: p.principalId,
          access: p.access,
          createdBy: msg.actorId,
        });
        await emit(tx, msg, EVENTS.dashboardShared, {
          dashboardId: p.dashboardId,
          principalId: p.principalId,
          access: p.access,
        });
        await audit(tx, msg, "share", p.dashboardId);
      });
      await cache.invalidate(cache.makeKey(msg.tenantId, DASHBOARD_RESOURCE, p.dashboardId));
    } catch (err) {
      log.error({ err, messageId: msg.messageId, type: COMMANDS.shareDashboard }, "Consumer processing failed");
      throw err; // H11 FIX: rethrow so message redelivers/DLQs
    }
  });
}
