import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { MUNICIPAL_EVENT_TYPES } from "@civitasone/events";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { cache } from "../../shared/infra.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { emitMunicipalFeeChallan, emitMunicipalNotification, municipalDecisionNotificationEventType } from "../../shared/cross-events.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import * as permitRepo from "../permits/repo.js";
import * as appRepo from "../applications/repo.js";
import { calculateRenewalFeeMinor, calculateNewValidUntil, generateCertificateVerificationCode } from "./domain.js";

const log = pino({ name: "building.lifecycle.consumer" });

// Same defense-in-depth ceiling as applications/consumer.ts's
// MAX_FEE_MINOR — calculateRenewalFeeMinor is itself a fixed switch over
// RENEWAL_TYPES (no user-controlled multiplication), so this can never
// trip in practice, but every amount handed to emitMunicipalFeeChallan is
// re-asserted against the same sanity ceiling rather than trusted by type
// alone.
const MAX_FEE_MINOR = 10_000_000_00n; // Rs 1,00,00,000 (1 crore) in paise

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

export function registerLifecycleConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.issueCertificate, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; permitId: string; certType: string; inspectionReport?: Record<string, unknown> };
    const verificationCode = generateCertificateVerificationCode();
    const now = new Date();
    const permit = await permitRepo.findById(p.permitId, msg.tenantId);
    const app = permit ? await appRepo.findById(permit.applicationId, msg.tenantId) : null;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertCertificate(tx, { id: p.id, tenantId: msg.tenantId, permitId: p.permitId, certType: p.certType, status: "issued", issuedAt: now, inspectionReport: p.inspectionReport ?? null, verificationCode, createdBy: msg.actorId, updatedBy: msg.actorId });
      await enqueue(tx, { topic: EVENTS.certificateIssued, eventType: EVENTS.certificateIssued, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { certificateId: p.id, permitId: p.permitId, certType: p.certType, verificationCode } });
      if (app) {
        await emitMunicipalNotification(tx, ctxOf(msg), {
          eventType: MUNICIPAL_EVENT_TYPES.statusChanged,
          recipient: app.createdBy,
          recipientId: p.id,
          variables: { certificateId: p.id, certType: p.certType, permitId: p.permitId },
        });
      }
      await writeAudit(tx, ctxOf(msg), { action: "certificate.issue", resourceType: "building_certificate", resourceId: p.id });
    });
    log.info({ id: p.id, certType: p.certType }, "building certificate issued");
  });

  queue.subscribe(COMMANDS.requestRenewal, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; permitId: string; renewalType: string; details?: Record<string, unknown> };
    const feeMinor = calculateRenewalFeeMinor(p.renewalType);
    if (feeMinor > MAX_FEE_MINOR) {
      log.error({ id: p.id, feeMinor: feeMinor.toString() }, "computed renewal fee exceeds sanity ceiling — refusing to raise a challan");
      throw new Error(`building renewal fee ${feeMinor.toString()} exceeds MAX_FEE_MINOR ceiling`);
    }
    const permit = await permitRepo.findById(p.permitId, msg.tenantId);
    const app = permit ? await appRepo.findById(permit.applicationId, msg.tenantId) : null;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertRenewal(tx, { id: p.id, tenantId: msg.tenantId, permitId: p.permitId, renewalType: p.renewalType, status: "submitted", details: p.details ?? null, feeMinor, feeCurrency: "INR", previousValidUntil: permit?.validUntil ?? null, createdBy: msg.actorId, updatedBy: msg.actorId });
      await enqueue(tx, { topic: EVENTS.renewalRequested, eventType: EVENTS.renewalRequested, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { renewalId: p.id, permitId: p.permitId, renewalType: p.renewalType, feeMinor: String(feeMinor) } });
      if (app) {
        await emitMunicipalFeeChallan(tx, ctxOf(msg), {
          sourceRef: p.id,
          depositor: app.createdBy,
          amountMinor: feeMinor,
          currency: "INR",
        });
      }
      await writeAudit(tx, ctxOf(msg), { action: "renewal.request", resourceType: "building_renewal", resourceId: p.id });
    });
    log.info({ id: p.id, permitId: p.permitId, type: p.renewalType }, "building renewal requested");
  });

  queue.subscribe(COMMANDS.decideRenewal, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; decision: string; reason?: string };
    const renewal = await repo.findRenewalById(p.id, msg.tenantId);
    if (!renewal) return;
    const newValidUntil = p.decision === "approved" ? calculateNewValidUntil(renewal.previousValidUntil) : null;
    const permit = await permitRepo.findById(renewal.permitId, msg.tenantId);
    const app = permit ? await appRepo.findById(permit.applicationId, msg.tenantId) : null;
    let applied = false;
    let permitExtended = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.updateRenewalDecision(tx, p.id, msg.tenantId, p.decision, msg.actorId, p.reason ?? null, newValidUntil);
      if (!ok) return;
      applied = true;
      if (p.decision === "approved" && newValidUntil) {
        permitExtended = await permitRepo.updateValidUntil(tx, renewal.permitId, msg.tenantId, newValidUntil, msg.actorId);
        if (!permitExtended) {
          log.error({ renewalId: p.id, permitId: renewal.permitId }, "renewal approved but permit validUntil update matched no row — data inconsistency");
        }
      }
      await enqueue(tx, { topic: EVENTS.renewalDecided, eventType: EVENTS.renewalDecided, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { renewalId: p.id, permitId: renewal.permitId, renewalType: renewal.renewalType, decision: p.decision, reason: p.reason, newValidUntil: newValidUntil?.toISOString() } });
      if (app) {
        await emitMunicipalNotification(tx, ctxOf(msg), {
          eventType: municipalDecisionNotificationEventType(MUNICIPAL_EVENT_TYPES.statusChanged, p.decision),
          recipient: app.createdBy,
          recipientId: p.id,
          variables: { renewalId: p.id, permitId: renewal.permitId, decision: p.decision },
        });
      }
      await writeAudit(tx, ctxOf(msg), { action: `renewal.${p.decision}`, resourceType: "building_renewal", resourceId: p.id });
    });
    if (permitExtended) await cache.invalidate(cache.makeKey(msg.tenantId, "permit", renewal.permitId));
    if (applied) log.info({ id: p.id, decision: p.decision }, "building renewal decided");
  });
}
