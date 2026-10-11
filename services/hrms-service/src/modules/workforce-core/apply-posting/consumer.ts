/**
 * applyPosting — the single consumer (SmartTransfer OS, ST-M01-09).
 *
 * House rule 1: route → zod → command (deterministic messageId from orderId) →
 * 202 → THIS consumer, which runs markProcessed + the guarded write
 * (applyPostingTx) + audit.event.record in ONE transaction. Idempotent on the
 * order id: the messageId is derived from orderId, so a redelivery is dropped
 * by markProcessed and nothing is written twice.
 *
 * Behind WORKFORCE_CORE_LEDGER_ENABLED (M01 exit criterion 2): when the flag is
 * OFF the consumer is NOT subscribed (worker.ts gates registration), so the
 * legacy behaviour is unchanged. When ON, this is the authoritative posting
 * write path (D-ST-10 — SmartTransfer may only move a posting through it).
 *
 * A genuine concurrent clash on the same post/employee raises the Postgres
 * EXCLUDE constraint (SQLSTATE 23P01). We catch exactly that, record an AUDITED
 * refusal in its OWN transaction, and return — the raw constraint error is
 * never leaked (house rule 6 / the "swallowed 23P01" anti-pattern turned into
 * an explicit audited refusal, per WAVE0 §3).
 */
import type { Queue } from "@civitasone/queue";
import { db } from "../../../shared/db.js";
import { cache } from "../../../shared/infra.js";
import { enqueue, markProcessed } from "../../../shared/outbox.js";
import { COMMANDS } from "../../../topics.js";
import { HttpError } from "../../../shared/context.js";
import { applyPostingTx } from "./apply.js";

const AUDIT = "audit.event.record";

/** Postgres exclusion-constraint violation (an EXCLUDE … WITH && clash). */
function isExclusionViolation(err: unknown): boolean {
  const code = (err as { code?: string } | undefined)?.code;
  return code === "23P01" || code === "23505";
}

export function registerApplyPostingConsumer(queue: Queue): void {
  queue.subscribe(COMMANDS.postingApply, async (msg) => {
    const p = msg.payload as {
      orderId: string;
      employeeId: string;
      postId: string;
      effectiveDate: string;
      orderNumber: string;
      chargeType?: string;
      approvedBy?: string | null;
    };

    try {
      await db.transaction(async (tx) => {
        // Idempotent on the order id (the messageId is derived from orderId).
        if (!(await markProcessed(tx, msg.messageId))) return;

        const result = await applyPostingTx(tx, {
          tenantId: msg.tenantId,
          orderId: p.orderId,
          employeeId: p.employeeId,
          postId: p.postId,
          effectiveDate: p.effectiveDate,
          orderNumber: p.orderNumber,
          chargeType: p.chargeType ?? "substantive",
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          approvedBy: p.approvedBy ?? null,
        });

        await enqueue(tx, {
          topic: AUDIT,
          eventType: AUDIT,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            service: "hrms",
            action: "apply_posting",
            resourceType: "posting",
            resourceId: p.orderId,
            outcome: "success",
            metadata: {
              employeeId: p.employeeId,
              postId: p.postId,
              effectiveDate: p.effectiveDate,
              orderNumber: p.orderNumber,
              chargeType: p.chargeType ?? "substantive",
              // The rich posting fact (station/state/city class + office move)
              // is recorded here regardless of whether the standalone
              // hrms.posting.* events are enabled, so nothing is lost when they
              // are gated off (config.isPostingEventsEnabled).
              fromOfficeId: result.fromOfficeId,
              toOfficeId: result.toOfficeId,
              officeChanged: result.officeChanged,
              station: result.station,
              state: result.state,
              cityClass: result.cityClass,
            },
          },
        });
      });
    } catch (err) {
      if (isExclusionViolation(err)) {
        // Concurrent apply of two orders for the same post/employee: exactly
        // one wins; the other is refused with an AUDITED record, not a leaked
        // 23P01. markProcessed already rolled back with the failed tx, so a
        // retry is still possible if the winning posting is later vacated.
        await db.transaction(async (tx) => {
          await enqueue(tx, {
            topic: AUDIT,
            eventType: AUDIT,
            tenantId: msg.tenantId,
            actorId: msg.actorId,
            correlationId: msg.correlationId,
            payload: {
              service: "hrms",
              action: "apply_posting",
              resourceType: "posting",
              resourceId: p.orderId,
              outcome: "failure",
              metadata: {
                employeeId: p.employeeId,
                postId: p.postId,
                reason: "POST_ALREADY_OCCUPIED",
              },
            },
          });
        });
        return;
      }
      // A domain refusal (post/employee not found, SoD) is also an audited
      // failure, not a crash-loop. Anything else re-throws for the queue's
      // own retry/DLQ handling.
      if (err instanceof HttpError && err.status < 500) {
        await db.transaction(async (tx) => {
          await enqueue(tx, {
            topic: AUDIT,
            eventType: AUDIT,
            tenantId: msg.tenantId,
            actorId: msg.actorId,
            correlationId: msg.correlationId,
            payload: {
              service: "hrms",
              action: "apply_posting",
              resourceType: "posting",
              resourceId: p.orderId,
              outcome: "failure",
              metadata: {
                employeeId: p.employeeId,
                postId: p.postId,
                reason: err.code,
              },
            },
          });
        });
        return;
      }
      throw err;
    }

    await cache.invalidate(
      cache.makeKey(msg.tenantId, "employee", p.employeeId),
    );
    await cache.invalidateResource(msg.tenantId, "employee");
  });
}
