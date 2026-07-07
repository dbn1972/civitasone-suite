import type { Queue } from "@civitasone/queue";
import { NOTIFICATION_SEND, buildNotificationPayload } from "@civitasone/events";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { computeDeadline, scheduleNotifications } from "./domain.js";
import * as repo from "./repo.js";

const AUDIT_TOPIC = "audit.event.record";

export function registerLimitationConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.limitationCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; matterId: string;
      ruleType: string; startDate: string; periodDays: number;
    };

    const startDate = new Date(p.startDate);
    const deadline = computeDeadline(startDate, p.periodDays);
    const now = new Date();
    const notifications = scheduleNotifications(deadline, now);

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      await repo.insert(tx as unknown as typeof db, {
        id: p.id,
        tenantId: p.tenantId,
        matterId: p.matterId,
        ruleType: p.ruleType,
        startDate,
        periodDays: p.periodDays,
        deadline,
        status: "active",
        notifications,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
        version: 1,
      });

      // Schedule notification events for each future alert date
      if (notifications.at30d) {
        await enqueueNotification(tx, msg, p.id, p.matterId, notifications.at30d, "30d");
      }
      if (notifications.at15d) {
        await enqueueNotification(tx, msg, p.id, p.matterId, notifications.at15d, "15d");
      }
      if (notifications.at7d) {
        await enqueueNotification(tx, msg, p.id, p.matterId, notifications.at7d, "7d");
      }

      await audit(tx, msg, "create", p.id);
    });

    await cache.invalidate(cache.makeKey(msg.tenantId, "limitation", p.id));
  });

  queue.subscribe(COMMANDS.limitationUpdate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string;
      ruleType?: string; startDate?: string; periodDays?: number; status?: string;
    };

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const existing = await repo.findByIdTx(tx as unknown as typeof db, p.id);
      if (!existing) throw new Error(`limitation rule ${p.id} not found`);

      const updates: Record<string, unknown> = {
        updatedBy: msg.actorId,
        version: existing.version + 1,
      };

      if (p.ruleType) updates.ruleType = p.ruleType;
      if (p.status) updates.status = p.status;

      // Recompute deadline if startDate or periodDays changed
      const newStartDate = p.startDate ? new Date(p.startDate) : existing.startDate;
      const newPeriodDays = p.periodDays ?? existing.periodDays;

      if (p.startDate || p.periodDays) {
        const newDeadline = computeDeadline(newStartDate, newPeriodDays);
        const now = new Date();
        const newNotifications = scheduleNotifications(newDeadline, now);
        updates.startDate = newStartDate;
        updates.periodDays = newPeriodDays;
        updates.deadline = newDeadline;
        updates.notifications = newNotifications;
      }

      await repo.update(tx as unknown as typeof db, p.id, updates);
      await audit(tx, msg, "update", p.id);
    });

    await cache.invalidate(cache.makeKey(msg.tenantId, "limitation", p.id));
  });

  queue.subscribe(COMMANDS.limitationDelete, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const existing = await repo.findByIdTx(tx as unknown as typeof db, p.id);
      if (!existing) throw new Error(`limitation rule ${p.id} not found`);

      await repo.softDelete(tx as unknown as typeof db, p.id, msg.actorId);
      await audit(tx, msg, "delete", p.id);
    });

    await cache.invalidate(cache.makeKey(msg.tenantId, "limitation", p.id));
  });
}

async function enqueueNotification(
  tx: any,
  msg: { tenantId: string; actorId: string; correlationId: string },
  ruleId: string,
  matterId: string,
  alertDate: Date,
  alertLabel: string,
): Promise<void> {
  const payload = buildNotificationPayload({
    eventType: "legal.limitation.alert",
    recipient: msg.actorId,
    recipientId: msg.actorId,
    channel: "in_app",
    variables: {
      ruleId,
      matterId,
      alertLabel,
      alertDate: alertDate.toISOString(),
    },
  });
  await enqueue(tx, {
    topic: NOTIFICATION_SEND,
    eventType: "legal.limitation.alert",
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload,
  });
}

async function audit(
  tx: any,
  msg: { tenantId: string; actorId: string; correlationId: string },
  action: string,
  resourceId: string,
): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC,
    eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: { service: "legal", action, resourceType: "limitation_rule", resourceId, outcome: "success" },
  });
}
