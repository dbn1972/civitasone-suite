import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { cache } from "../../shared/infra.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import * as licenceRepo from "../licences/repo.js";
import * as applicationsRepo from "../applications/repo.js";
import { calculateRenewalFeeMinor, calculateNewValidUntil } from "./domain.js";
import { emitMunicipalNotification } from "../../shared/cross-events.js";
import { MUNICIPAL_EVENT_TYPES } from "@civitasone/events";

const log = pino({ name: "trade.lifecycle.consumer" });

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

export function registerLifecycleConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.requestRenewal, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; licenceId: string; renewalType: string; details?: Record<string, unknown> };
    const feeMinor = calculateRenewalFeeMinor(p.renewalType);
    const licence = await licenceRepo.findById(p.licenceId, msg.tenantId);
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertRenewal(tx, {
        id: p.id, tenantId: msg.tenantId, licenceId: p.licenceId, renewalType: p.renewalType, status: "submitted", details: p.details ?? null, feeMinor, feeCurrency: "INR", previousValidUntil: licence?.validUntil ?? null, createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await enqueue(tx, { topic: EVENTS.renewalRequested, eventType: EVENTS.renewalRequested, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { renewalId: p.id, licenceId: p.licenceId, renewalType: p.renewalType, feeMinor: String(feeMinor) } });
      await writeAudit(tx, ctxOf(msg), { action: "renewal.request", resourceType: "trade_renewal", resourceId: p.id });
    });
    log.info({ id: p.id, licenceId: p.licenceId, type: p.renewalType }, "trade renewal requested");
  });

  queue.subscribe(COMMANDS.decideRenewal, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; decision: string; reason?: string };
    const renewal = await repo.findById(p.id, msg.tenantId);
    if (!renewal) return;
    const newValidUntil = p.decision === "approved" && renewal.renewalType === "renewal"
      ? calculateNewValidUntil(renewal.previousValidUntil)
      : null;
    // Wave 3 cross-service wiring: a renewal decision is citizen-meaningful
    // whenever it changes what the licence-holder can rely on — a successful
    // renewal (approved, type "renewal"), a successful surrender (approved,
    // type "surrender" — the licence goes to cancelled), or any rejection
    // (asymmetric to leave unwired, given approvals/consumer.ts's
    // decideApplication already notifies both its approved AND rejected
    // paths). Resolve the applicant behind the licence before the tx for all
    // three, same pattern as licences/consumer.ts.
    const notifiable = p.decision === "approved" || p.decision === "rejected";
    const licence = notifiable ? await licenceRepo.findById(renewal.licenceId, msg.tenantId) : null;
    const application = licence ? await applicationsRepo.findById(licence.applicationId, msg.tenantId) : null;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.updateDecision(tx, p.id, msg.tenantId, p.decision, msg.actorId, p.reason ?? null, newValidUntil);
      if (p.decision === "approved" && renewal.renewalType === "renewal" && newValidUntil) {
        await licenceRepo.updateValidUntil(tx, renewal.licenceId, msg.tenantId, newValidUntil, msg.actorId);
        // See applications/consumer.ts's header comment: GET /licences/:id is
        // cached and this write (via a DIFFERENT module) mutates that row.
        await cache.invalidateResourceAfterCommit(tx, msg.tenantId, "licence");
        await emitMunicipalNotification(tx, ctxOf(msg), {
          eventType: MUNICIPAL_EVENT_TYPES.statusChanged,
          recipient: application?.businessName ?? "Licensee",
          ...(application?.createdBy ? { recipientId: application.createdBy } : {}),
          variables: { licenceId: renewal.licenceId, renewalId: p.id, status: "renewed", validUntil: newValidUntil.toISOString(), serviceName: "trade" },
        });
      }
      if (p.decision === "approved" && renewal.renewalType === "surrender") {
        await licenceRepo.updateLicenceStatus(tx, renewal.licenceId, msg.tenantId, "cancelled", { cancelledAt: new Date(), cancellationReason: "Surrendered by holder" }, msg.actorId);
        await cache.invalidateResourceAfterCommit(tx, msg.tenantId, "licence");
        await emitMunicipalNotification(tx, ctxOf(msg), {
          eventType: MUNICIPAL_EVENT_TYPES.statusChanged,
          recipient: application?.businessName ?? "Licensee",
          ...(application?.createdBy ? { recipientId: application.createdBy } : {}),
          variables: { licenceId: renewal.licenceId, renewalId: p.id, status: "surrendered", serviceName: "trade" },
        });
      }
      if (p.decision === "rejected") {
        await emitMunicipalNotification(tx, ctxOf(msg), {
          eventType: MUNICIPAL_EVENT_TYPES.statusChanged,
          recipient: application?.businessName ?? "Licensee",
          ...(application?.createdBy ? { recipientId: application.createdBy } : {}),
          variables: { licenceId: renewal.licenceId, renewalId: p.id, status: "rejected", reason: p.reason ?? "", serviceName: "trade" },
        });
      }
      await enqueue(tx, { topic: EVENTS.renewalDecided, eventType: EVENTS.renewalDecided, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { renewalId: p.id, licenceId: renewal.licenceId, renewalType: renewal.renewalType, decision: p.decision, reason: p.reason, newValidUntil: newValidUntil?.toISOString() } });
      await writeAudit(tx, ctxOf(msg), { action: `renewal.${p.decision}`, resourceType: "trade_renewal", resourceId: p.id });
    });
    log.info({ id: p.id, decision: p.decision }, "trade renewal decided");
  });
}
