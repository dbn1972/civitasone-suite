import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import {
  applyExceptionAction,
  type ExceptionStatus,
  type ExceptionAction,
} from "@civitasone/reconciliation";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import * as repo from "./repo.js";
import { runReconciliation } from "./service.js";
import { decideWriteOff, assertMayDeclineWriteOff } from "./writeoff-policy.js";
import { DomainError } from "../payments/domain.js";
import { NonRetryableError } from "@civitasone/queue";

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
    await cache.invalidateResource(msg.tenantId, "recon");
    log.info({ id: msg.messageId, runId: result.run.id }, "Processed finance.recon.run");
  }, { visibilityTimeout: 300 });

  queue.subscribe("finance.recon.exception_action", async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      action: ExceptionAction | "decline_write_off";
      note?: string;
      actorRoles?: string[];
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const existing = await repo.getBreakTx(tx, p.tenantId, p.id);
      if (!existing) throw new Error(`recon break ${p.id} not found`);
      const pendingBy = existing.writeoffRequestedBy ?? null;
      let next: ExceptionStatus = existing.status as ExceptionStatus;
      // C30: what this action does to the write-off approval state (undefined = leave it alone).
      let writeoff: "request" | "clear" | undefined;
      try {
        if (p.action === "decline_write_off") {
          assertMayDeclineWriteOff({ requestedBy: pendingBy, actorId: msg.actorId, actorRoles: p.actorRoles ?? [] });
          writeoff = "clear";
        } else {
          next = applyExceptionAction(existing.status as ExceptionStatus, p.action);
          if (p.action === "write_off") {
            const decision = decideWriteOff({
              deltaMinor: existing.deltaMinor ?? null,
              thresholdMinor: await repo.getWriteoffThresholdTx(tx, p.tenantId),
              requestedBy: pendingBy,
              actorId: msg.actorId,
              actorRoles: p.actorRoles ?? [],
            });
            if (decision === "request") { next = existing.status as ExceptionStatus; writeoff = "request"; }
            else writeoff = "clear"; // direct, or the second approver completing it
          } else if (pendingBy) {
            writeoff = "clear"; // any other action supersedes a pending write-off request
          }
        }
      } catch (err) {
        // A refusal is final; retrying cannot change it.
        if (err instanceof DomainError) throw new NonRetryableError(err.message);
        throw err;
      }
      const resolving = next === "resolved" || next === "written_off";
      await repo.updateBreakStatus(tx, p.tenantId, p.id, {
        status: next,
        // Only a closing action writes the note. investigate/reopen must NOT touch the
        // stored resolutionNote (it was wiped to null before); their note, if any,
        // is kept in the audit event below.
        ...(resolving ? { resolutionNote: p.note ?? null } : {}),
        // A pending request must not look like a resolution: resolvedBy/At stay as they were until it is actually closed.
        ...(writeoff === "request" || p.action === "decline_write_off"
          ? {}
          : { resolvedBy: resolving ? msg.actorId : null, resolvedAt: resolving ? new Date() : null }),
        ...(writeoff === "request"
          ? { writeoffRequestedBy: msg.actorId, writeoffRequestedAt: new Date(), writeoffRequestNote: p.note ?? null }
          : writeoff === "clear"
            ? { writeoffRequestedBy: null, writeoffRequestedAt: null, writeoffRequestNote: null }
            : {}),
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
          action: writeoff === "request" ? "recon_writeoff_requested" : p.action === "decline_write_off" ? "recon_writeoff_declined" : "recon_exception_action",
          resourceType: "recon_break",
          resourceId: p.id,
          outcome: "success",
          exceptionAction: p.action,
          previousStatus: existing.status,
          newStatus: next,
          ...(existing.deltaMinor != null ? { deltaMinor: existing.deltaMinor.toString() } : {}),
          ...(pendingBy && p.action === "write_off" ? { secondApprover: msg.actorId, requestedBy: pendingBy } : {}),
          ...(p.note ? { note: p.note } : {}),
        },
      });
    });
    await cache.invalidateResource(msg.tenantId, "recon");
    log.info({ id: msg.messageId, breakId: p.id }, "Processed finance.recon.exception_action");
  });

  // C30: set the per-tenant write-off second-approval threshold. Audited with the old and new figure.
  queue.subscribe("finance.recon.writeoff_policy_set", async (msg) => {
    const p = msg.payload as { tenantId: string; thresholdMinor: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const before = await repo.getWriteoffThresholdTx(tx, p.tenantId);
      const next = BigInt(p.thresholdMinor);
      await repo.upsertWriteoffThreshold(tx, p.tenantId, next, msg.actorId);
      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          service: "finance", action: "recon_writeoff_policy_set", resourceType: "recon_policy", resourceId: p.tenantId,
          outcome: "success", previousMinor: before.toString(), newMinor: next.toString(),
        },
      });
    });
    await cache.invalidateResource(msg.tenantId, "recon");
    log.info({ id: msg.messageId }, "Processed finance.recon.writeoff_policy_set");
  });
}
