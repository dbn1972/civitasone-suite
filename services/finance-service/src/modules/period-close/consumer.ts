import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import * as periodRepo from "./repo.js";
import { deriveFY } from "../reports/routes.js";

const log = pino({ name: "finance.period-close.consumer" });

const AUDIT_TOPIC = "audit.event.record";

export function registerPeriodCloseConsumers(queue: Queue): void {
  queue.subscribe("finance.period.close", async (msg) => {
    const p = msg.payload as { tenantId: string; period: string; closeType: "soft_close" | "hard_close" };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const existing = await periodRepo.findPeriodCloseTx(tx, p.tenantId, p.period);
      if (existing?.status === "hard_close") return; // already hard-closed, idempotent
      if (existing?.status === p.closeType) return; // already in desired state

      await periodRepo.upsertPeriodClose(tx, {
        id: existing?.id ?? crypto.randomUUID(),
        tenantId: p.tenantId,
        fiscalYear: deriveFY(p.period),
        period: p.period,
        status: p.closeType,
        closedBy: msg.actorId,
        closedAt: new Date(),
      });
      await enqueue(tx, {
        topic: "finance.period.closed", eventType: "finance.period.closed",
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { period: p.period, status: p.closeType },
      });
      await audit(tx, msg, p.closeType, "period", p.period);
    });
    await cache.invalidate(`finance:${msg.tenantId}:periods:*`);
    log.info({ id: msg.messageId, period: p.period }, "Processed period.close");
  });

  queue.subscribe("finance.period.reopen", async (msg) => {
    const p = msg.payload as { tenantId: string; period: string; reason?: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const existing = await periodRepo.findPeriodCloseTx(tx, p.tenantId, p.period);
      if (!existing || existing.status === "open") return; // already open
      const fromStatus = existing.status;

      await periodRepo.upsertPeriodClose(tx, {
        id: existing.id,
        tenantId: p.tenantId,
        fiscalYear: deriveFY(p.period),
        period: p.period,
        status: "open",
        closedBy: null,
        closedAt: null,
      });
      await periodRepo.logReopen(tx, {
        id: crypto.randomUUID(),
        tenantId: p.tenantId,
        period: p.period,
        fromStatus,
        toStatus: "open",
        ...(p.reason ? { reason: p.reason } : {}),
        createdBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: "finance.period.reopened", eventType: "finance.period.reopened",
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { period: p.period, fromStatus, reason: p.reason },
      });
      await audit(tx, msg, "reopen", "period", p.period);
    });
    await cache.invalidate(`finance:${msg.tenantId}:periods:*`);
    log.info({ id: msg.messageId, period: p.period }, "Processed period.reopen");
  });
}

async function audit(tx: any, msg: any, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "finance", action, resourceType, resourceId, outcome: "success" },
  });
}
