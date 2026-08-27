import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { cache } from "../../shared/infra.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import * as permitRepo from "../permits/repo.js";
import { calculateRenewalFeeMinor, calculateNewValidUntil, generateCertificateVerificationCode } from "./domain.js";

const log = pino({ name: "building.lifecycle.consumer" });

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

export function registerLifecycleConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.issueCertificate, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; permitId: string; certType: string; inspectionReport?: Record<string, unknown> };
    const verificationCode = generateCertificateVerificationCode();
    const now = new Date();
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertCertificate(tx, { id: p.id, tenantId: msg.tenantId, permitId: p.permitId, certType: p.certType, status: "issued", issuedAt: now, inspectionReport: p.inspectionReport ?? null, verificationCode, createdBy: msg.actorId, updatedBy: msg.actorId });
      await enqueue(tx, { topic: EVENTS.certificateIssued, eventType: EVENTS.certificateIssued, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { certificateId: p.id, permitId: p.permitId, certType: p.certType, verificationCode } });
      await writeAudit(tx, ctxOf(msg), { action: "certificate.issue", resourceType: "building_certificate", resourceId: p.id });
    });
    log.info({ id: p.id, certType: p.certType }, "building certificate issued");
  });

  queue.subscribe(COMMANDS.requestRenewal, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; permitId: string; renewalType: string; details?: Record<string, unknown> };
    const feeMinor = calculateRenewalFeeMinor(p.renewalType);
    const permit = await permitRepo.findById(p.permitId, msg.tenantId);
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertRenewal(tx, { id: p.id, tenantId: msg.tenantId, permitId: p.permitId, renewalType: p.renewalType, status: "submitted", details: p.details ?? null, feeMinor, feeCurrency: "INR", previousValidUntil: permit?.validUntil ?? null, createdBy: msg.actorId, updatedBy: msg.actorId });
      await enqueue(tx, { topic: EVENTS.renewalRequested, eventType: EVENTS.renewalRequested, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { renewalId: p.id, permitId: p.permitId, renewalType: p.renewalType, feeMinor: String(feeMinor) } });
      await writeAudit(tx, ctxOf(msg), { action: "renewal.request", resourceType: "building_renewal", resourceId: p.id });
    });
    log.info({ id: p.id, permitId: p.permitId, type: p.renewalType }, "building renewal requested");
  });

  queue.subscribe(COMMANDS.decideRenewal, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; decision: string; reason?: string };
    const renewal = await repo.findRenewalById(p.id, msg.tenantId);
    if (!renewal) return;
    const newValidUntil = p.decision === "approved" ? calculateNewValidUntil(renewal.previousValidUntil) : null;
    let applied = false;
    let permitExtended = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // updateRenewalDecision's boolean return (row actually matched) was
      // previously discarded — same fake-success pattern already fixed
      // elsewhere in this service. Gate everything else on it.
      const ok = await repo.updateRenewalDecision(tx, p.id, msg.tenantId, p.decision, msg.actorId, p.reason ?? null, newValidUntil);
      if (!ok) return;
      applied = true;
      if (p.decision === "approved" && newValidUntil) {
        permitExtended = await permitRepo.updateValidUntil(tx, renewal.permitId, msg.tenantId, newValidUntil, msg.actorId);
        if (!permitExtended) {
          // The renewal record itself was genuinely decided (true above), so
          // we still report that truthfully — but a matched renewal whose
          // permit didn't update is a real data inconsistency (permit
          // deleted/wrong tenant under an id we just read moments ago), not
          // a routine no-op, so it must not vanish silently.
          log.error({ renewalId: p.id, permitId: renewal.permitId }, "renewal approved but permit validUntil update matched no row — data inconsistency");
        }
      }
      await enqueue(tx, { topic: EVENTS.renewalDecided, eventType: EVENTS.renewalDecided, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { renewalId: p.id, permitId: renewal.permitId, renewalType: renewal.renewalType, decision: p.decision, reason: p.reason, newValidUntil: newValidUntil?.toISOString() } });
      await writeAudit(tx, ctxOf(msg), { action: `renewal.${p.decision}`, resourceType: "building_renewal", resourceId: p.id });
    });
    // GET /v1/building/permits/:id (permits/routes.ts) reads through a cache
    // that only this consumer's write path can invalidate (CLAUDE.md §6).
    if (permitExtended) await cache.invalidate(cache.makeKey(msg.tenantId, "permit", renewal.permitId));
    if (applied) log.info({ id: p.id, decision: p.decision }, "building renewal decided");
  });
}
