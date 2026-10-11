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
import { isAllowedProducer } from "./producer.js";

const AUDIT = "audit.event.record";

/** Postgres exclusion-constraint violation (an EXCLUDE … WITH && clash) only. */
function isExclusionViolation(err: unknown): boolean {
  return (err as { code?: string } | undefined)?.code === "23P01";
}

/** CHECK-constraint violation (e.g. the occupancy/ledger date checks). */
function isCheckViolation(err: unknown): boolean {
  return (err as { code?: string } | undefined)?.code === "23514";
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
      producer?: string;
    };

    // ST-M01-15 — producer ACL (scoped service credential for the
    // SmartTransfer→HRMS command path; spec §14, D-ST-10 APPROVED, D-ST-19).
    // Only the frozen contract owner (smarttransfer-service) and the
    // hrms-service in-service HTTP affordance may drive a posting write. A
    // command from ANY other producer (payroll, a rogue leave consumer, a
    // mis-wired future service) is refused with an AUDITED record in its own
    // transaction — never the guarded write, never a leaked reason (house rule
    // 6). The write path (markProcessed + occupancy/ledger/employee/service
    // book + audit) is NOT entered. A redelivery of a refused command stays
    // refused (deterministic on producer), so it is safe to let the queue drop
    // it without marking it processed.
    if (!isAllowedProducer(p.producer)) {
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
              reason: "PRODUCER_NOT_AUTHORISED",
            },
          },
        });
      });
      return;
    }

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
      if (isExclusionViolation(err) || isCheckViolation(err)) {
        const reason = isExclusionViolation(err)
          ? "POST_ALREADY_OCCUPIED"
          : "POSTING_DATES_INVALID";
        // Concurrent apply of two orders for the same post/employee: exactly
        // one wins; the other is refused with an AUDITED record, not a leaked
        // 23P01. The failed tx (incl. markProcessed) rolled back, but the
        // message is acknowledged here, so it is NOT retried: the refusal is
        // final for this order and a corrected posting needs a new order.
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
                reason,
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
