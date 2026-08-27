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
    // since this renewal was requested — re-check its current state before an
    // approval mutates it, for the same reason as above.
    const permit = p.decision === "approved" ? await permitRepo.findById(renewal.permitId, msg.tenantId) : null;

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.updateDecision(
        tx, p.id, msg.tenantId, p.decision, msg.actorId, p.reason ?? null, newValidUntil,
      );
      if (!ok) return;

      if (p.decision === "approved" && renewal.renewalType === "renewal" && newValidUntil) {
        if (permit && (permit.permitStatus === "active" || permit.permitStatus === "expired")) {
          await permitRepo.updateValidUntil(tx, renewal.permitId, msg.tenantId, newValidUntil, msg.actorId);
        } else {
          log.warn(
            { renewalId: p.id, permitId: renewal.permitId, permitStatus: permit?.permitStatus },
            "decideRenewal: permit no longer active/expired, skipping validUntil extension",
          );
        }
      }
      if (p.decision === "approved" && renewal.renewalType === "surrender") {
        if (permit && canPerformAction(permit.permitStatus, "cancelled")) {
          await permitRepo.updatePermitStatus(
            tx, renewal.permitId, msg.tenantId, "cancelled",
            { cancelledAt: new Date(), cancellationReason: "Surrendered by holder" },
            msg.actorId,
          );
        } else {
          log.warn(
            { renewalId: p.id, permitId: renewal.permitId, permitStatus: permit?.permitStatus },
            "decideRenewal: permit can no longer be cancelled via surrender, skipping",
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
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.updateFeePayment(tx, p.id, msg.tenantId, p.transactionId, msg.actorId);
      if (!ok) return;
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
    });
    log.info({ id: p.id }, "renewal fee payment recorded");
  });
}
