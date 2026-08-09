import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import * as permitRepo from "../permits/repo.js";
import { calculateRenewalFeeMinor, calculateNewValidUntil } from "./domain.js";

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

    const newValidUntil = p.decision === "approved" && renewal.renewalType === "renewal"
      ? calculateNewValidUntil(renewal.previousValidUntil)
      : null;

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.updateDecision(
        tx, p.id, msg.tenantId, p.decision, msg.actorId, p.reason ?? null, newValidUntil,
      );

      if (p.decision === "approved" && renewal.renewalType === "renewal" && newValidUntil) {
        await permitRepo.updateValidUntil(tx, renewal.permitId, msg.tenantId, newValidUntil, msg.actorId);
      }
      if (p.decision === "approved" && renewal.renewalType === "surrender") {
        await permitRepo.updatePermitStatus(
          tx, renewal.permitId, msg.tenantId, "cancelled",
          { cancelledAt: new Date(), cancellationReason: "Surrendered by holder" },
          msg.actorId,
        );
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
}
