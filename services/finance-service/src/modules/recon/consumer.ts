import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import {
  applyExceptionAction,
  ExceptionWorkflowError,
  type ExceptionStatus,
  type ExceptionAction,
} from "@civitasone/reconciliation";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import * as repo from "./repo.js";
import { runReconciliation } from "./service.js";

const log = pino({ name: "finance.recon.consumer" });
const AUDIT_TOPIC = "audit.event.record";

export function registerReconConsumers(queue: Queue): void {
  queue.subscribe("finance.recon.run", async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      provider: string;
      params?: Record<string, unknown>;
    };

    const result = await runReconciliation(
      { tenantId: p.tenantId, actorId: msg.actorId },
      p.provider,
      p.params ?? {},
      { runId: p.id, messageId: msg.messageId, correlationId: msg.correlationId },
    );
    if (!result) {
      log.debug({ id: msg.messageId }, "finance.recon.run already processed");
      return;
    }
    await cache.invalidate(`finance:${msg.tenantId}:recon:*`);
    log.info({ id: msg.messageId, runId: result.run.id }, "Processed finance.recon.run");
  }, { visibilityTimeout: 300 });

  queue.subscribe("finance.recon.exception_action", async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      action: ExceptionAction;
      note?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const existing = await repo.getBreak(p.tenantId, p.id);
      if (!existing) throw new Error(`recon break ${p.id} not found`);
      let next: ExceptionStatus;
      try {
        next = applyExceptionAction(existing.status as ExceptionStatus, p.action);
      } catch (err) {
        if (err instanceof ExceptionWorkflowError) throw err;
        throw err;
      }
      const resolving = next === "resolved" || next === "written_off";
      await repo.updateBreakStatus(tx, p.tenantId, p.id, {
        status: next,
        resolutionNote: p.note ?? null,
        resolvedBy: resolving ? msg.actorId : null,
        resolvedAt: resolving ? new Date() : null,
      });
      await enqueue(tx, {
        topic: "finance.recon.exception_updated",
        eventType: "finance.recon.exception_updated",
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { breakId: p.id, status: next, action: p.action },
      });
      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          service: "finance",
          action: "recon_exception_action",
          resourceType: "recon_break",
          resourceId: p.id,
          outcome: "success",
        },
      });
    });
    await cache.invalidate(`finance:${msg.tenantId}:recon:*`);
    log.info({ id: msg.messageId, breakId: p.id }, "Processed finance.recon.exception_action");
  });
}
