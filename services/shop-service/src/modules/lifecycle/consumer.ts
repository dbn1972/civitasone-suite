import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import * as permitRepo from "../permits/repo.js";
import { canPerformAction } from "../permits/domain.js";
import { calculateRenewalFeeMinor, calculateNewValidUntil, canDecideRenewal } from "./domain.js";

const log = pino({ name: "shop.lifecycle.consumer" });

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

const PERMIT_ACTIVE_OR_EXPIRED = ["active", "expired"];

export function registerLifecycleConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.requestRenewal, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      permitId: string;
      renewalType: string;
      details?: Record<string, unknown>;
    };
    const feeAmountMinor = calculateRenewalFeeMinor(p.renewalType);
    const permit = await permitRepo.findById(p.permitId, msg.tenantId);

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertRenewal(tx, {
        id: p.id,
        tenantId: msg.tenantId,
        permitId: p.permitId,
        renewalType: p.renewalType,
        status: "submitted",
        details: p.details ?? null,
        feeAmountMinor,
        feeCurrency: "INR",
        previousValidUntil: permit?.validUntil ?? null,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.renewalRequested,
        eventType: EVENTS.renewalRequested,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          renewalId: p.id,
          permitId: p.permitId,
          renewalType: p.renewalType,
          feeAmountMinor: String(feeAmountMinor),
        },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "renewal.request",
        resourceType: "shop_renewal",
        resourceId: p.id,
      });
    });
    log.info({ id: p.id, permitId: p.permitId, type: p.renewalType }, "renewal requested");
  });

  queue.subscribe(COMMANDS.decideRenewal, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      decision: string;
      reason?: string;
    };
    const renewal = await repo.findById(p.id, msg.tenantId);
    if (!renewal) return;
    // Re-validate against the CURRENT persisted status — the route only checked a
    // snapshot at request time, and async delivery is not guaranteed ordered, so
    // two racing decisions on the same renewal must not both silently land.
    if (!canDecideRenewal(renewal.status)) {
      log.warn(
        { id: p.id, currentStatus: renewal.status },
        "decideRenewal: stale or already-decided renewal, skipping",
      );
      return;
    }

    const newValidUntil = p.decision === "approved" && renewal.renewalType === "renewal"
      ? calculateNewValidUntil(renewal.previousValidUntil)
      : null;

    // The permit itself may have moved (e.g. suspended/cancelled by an officer)
    // since this renewal was requested. Determine UP FRONT, before persisting
    // anything, whether an approval can actually be fully honored against the
    // permit's CURRENT state. If it can't, treat the whole decision as stale and
    // skip it entirely (leaving the renewal re-decidable) — do NOT commit the
    // renewal as "approved" (with a newValidUntil / decided outcome) while the
    // corresponding permit-side effect silently fails to apply underneath it.
    // That half-applied state is exactly the kind of fake-success this whole
    // pass has been hunting: the renewal row and its emitted event would both
    // claim an extension/surrender that never actually happened to the permit.
    let permit: Awaited<ReturnType<typeof permitRepo.findById>> = null;
    if (p.decision === "approved") {
      permit = await permitRepo.findById(renewal.permitId, msg.tenantId);
      if (renewal.renewalType === "renewal" && newValidUntil) {
        if (!permit || !PERMIT_ACTIVE_OR_EXPIRED.includes(permit.permitStatus)) {
          log.warn(
            { renewalId: p.id, permitId: renewal.permitId, permitStatus: permit?.permitStatus },
            "decideRenewal: permit no longer active/expired, deferring decision (not applying)",
          );
          return;
        }
      }
      if (renewal.renewalType === "surrender") {
        if (!permit || !canPerformAction(permit.permitStatus, "cancelled")) {
          log.warn(
            { renewalId: p.id, permitId: renewal.permitId, permitStatus: permit?.permitStatus },
            "decideRenewal: permit can no longer be cancelled via surrender, deferring decision (not applying)",
          );
          return;
        }
      }
    }

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.updateDecision(
        tx, p.id, msg.tenantId, ["submitted", "under_review"], p.decision, msg.actorId, p.reason ?? null, newValidUntil,
      );
      if (!ok) return;

      if (p.decision === "approved" && renewal.renewalType === "renewal" && newValidUntil) {
        const permitOk = await permitRepo.updateValidUntil(
          tx, renewal.permitId, msg.tenantId, PERMIT_ACTIVE_OR_EXPIRED, newValidUntil, msg.actorId,
        );
        if (!permitOk) {
          // Lost a race in the tiny window between the pre-check above and this
          // transaction (the permit moved again). Abort the whole decision by
          // throwing — the transaction rolls back the updateDecision too, so we
          // never persist an "approved" renewal whose extension didn't land.
          throw new Error(
            `decideRenewal: permit ${renewal.permitId} state changed again before commit; aborting`,
          );
        }
      }
      if (p.decision === "approved" && renewal.renewalType === "surrender") {
        const permitOk = await permitRepo.updatePermitStatus(
          tx, renewal.permitId, msg.tenantId, ["active", "suspended"], "cancelled",
          { cancelledAt: new Date(), cancellationReason: "Surrendered by holder" },
          msg.actorId,
        );
        if (!permitOk) {
          throw new Error(
            `decideRenewal: permit ${renewal.permitId} state changed again before commit; aborting`,
          );
        }
      }

      await enqueue(tx, {
        topic: EVENTS.renewalDecided,
        eventType: EVENTS.renewalDecided,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          renewalId: p.id,
          permitId: renewal.permitId,
          renewalType: renewal.renewalType,
          decision: p.decision,
          reason: p.reason,
          newValidUntil: newValidUntil?.toISOString(),
        },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: `renewal.${p.decision}`,
        resourceType: "shop_renewal",
        resourceId: p.id,
      });
    });
    log.info({ id: p.id, decision: p.decision }, "renewal decided");
  });

  queue.subscribe(COMMANDS.recordRenewalFeePayment, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; transactionId: string };
    // Same "don't log success on a no-op" fix as the other handlers in this
    // file: gate the trailing log on whether the write actually applied
    // (relevant now that updateFeePayment has its own feePaid=false CAS guard,
    // so a racing duplicate payment command correctly no-ops here).
    const applied = await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return false;
      const ok = await repo.updateFeePayment(tx, p.id, msg.tenantId, p.transactionId, msg.actorId);
      if (!ok) return false;
      await enqueue(tx, {
        topic: EVENTS.renewalFeePaymentRecorded,
        eventType: EVENTS.renewalFeePaymentRecorded,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { renewalId: p.id, transactionId: p.transactionId },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "renewal.fee_payment",
        resourceType: "shop_renewal",
        resourceId: p.id,
      });
      return true;
    });
    if (applied) log.info({ id: p.id }, "renewal fee payment recorded");
  });
}
