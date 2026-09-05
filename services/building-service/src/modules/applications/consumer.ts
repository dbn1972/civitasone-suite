import { pino } from "pino";
import { randomInt } from "node:crypto";
import type { Queue } from "@civitasone/queue";
import { MUNICIPAL_EVENT_TYPES } from "@civitasone/events";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { cache } from "../../shared/infra.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { emitMunicipalFeeChallan, emitMunicipalNotification } from "../../shared/cross-events.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { calculateFeeMinor, generateApplicationNumber, computeFAR } from "./domain.js";

const log = pino({ name: "building.applications.consumer" });

// Defense-in-depth mirroring PR #1006's money/precision bounds fix
// (this module's routes.ts): that PR bounds plotArea/builtUpArea/
// proposedFloors/fsiRequested at the HTTP layer so calculateFeeMinor's
// BigInt arithmetic never sees an out-of-range input on the normal request
// path. This consumer trusts its queue payload rather than re-deriving it
// from HTTP, so the same ceiling is re-asserted here, directly on the
// amount crossing into finance-service via emitMunicipalFeeChallan — a
// malformed or replayed command must not reach another service's ledger
// carrying an unbounded amount.
const MAX_FEE_MINOR = 10_000_000_00n; // Rs 1,00,00,000 (1 crore) in paise — generous vs. calculateFeeMinor's real-world range

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

export function registerApplicationConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.createApplication, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string;
      siteAddress: Record<string, unknown>;
      plotArea?: number; builtUpArea?: number; proposedFloors?: number; fsiRequested?: number;
      architectName?: string; architectLicenceNo?: string; structuralEngineer?: string;
      documents?: Array<{ docType: string; fileId: string; uploadedAt: string }>;
      drawings?: Array<{ drawingType: string; fileId: string; versionNumber: number; uploadedAt: string }>;
    };
    const feeMinor = calculateFeeMinor({ plotArea: p.plotArea, builtUpArea: p.builtUpArea, proposedFloors: p.proposedFloors });
    if (feeMinor > MAX_FEE_MINOR) {
      log.error({ id: p.id, feeMinor: feeMinor.toString() }, "computed application fee exceeds sanity ceiling — refusing to create application or raise a challan");
      throw new Error(`building application fee ${feeMinor.toString()} exceeds MAX_FEE_MINOR ceiling`);
    }
    // See services/building-service/src/modules/permits/consumer.ts for why
    // Date.now() % N is a deterministic-collision hazard on a UNIQUE column,
    // not a source of randomness — same fix applied here for applicationNumber.
    const applicationNumber = generateApplicationNumber("ULB", randomInt(1, 999999));
    const farComputed = (p.builtUpArea && p.plotArea) ? computeFAR(p.builtUpArea, p.plotArea) : undefined;

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertApplication(tx, {
        id: p.id, tenantId: msg.tenantId, applicationNumber, status: "draft",
        siteAddress: p.siteAddress as never,
        plotArea: p.plotArea?.toString() ?? null,
        builtUpArea: p.builtUpArea?.toString() ?? null,
        proposedFloors: p.proposedFloors ?? null,
        fsiRequested: p.fsiRequested?.toString() ?? null,
        farComputed: farComputed?.toString() ?? null,
        architectName: p.architectName ?? null,
        architectLicenceNo: p.architectLicenceNo ?? null,
        structuralEngineer: p.structuralEngineer ?? null,
        documents: p.documents ?? [],
        drawings: p.drawings ?? [],
        feeMinor, feeCurrency: "INR", feePaid: false,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await enqueue(tx, { topic: EVENTS.applicationCreated, eventType: EVENTS.applicationCreated, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { applicationId: p.id, applicationNumber, feeMinor: String(feeMinor), feeCurrency: "INR" } });
      // Cross-service wiring (municipal-sec5 event contract, Wave 3):
      // assess the building-permit fee via finance.challan.create, and tell
      // the applicant it's due, in the same transaction as the application
      // row and its own domain event — all-or-nothing with the write that
      // created the obligation in the first place.
      await emitMunicipalFeeChallan(tx, ctxOf(msg), {
        sourceRef: p.id,
        depositor: msg.actorId,
        amountMinor: feeMinor,
        currency: "INR",
      });
      await emitMunicipalNotification(tx, ctxOf(msg), {
        eventType: MUNICIPAL_EVENT_TYPES.feeDue,
        recipient: msg.actorId,
        recipientId: p.id,
        variables: { applicationId: p.id, applicationNumber, feeMinor: String(feeMinor) },
      });
      await writeAudit(tx, ctxOf(msg), { action: "application.create", resourceType: "building_application", resourceId: p.id });
    });
    log.info({ id: p.id, applicationNumber }, "building application created");
  });

  queue.subscribe(COMMANDS.submitApplication, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    let applied = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.updateStatus(tx, p.id, msg.tenantId, "submitted", msg.actorId);
      if (!ok) return;
      applied = true;
      await enqueue(tx, { topic: EVENTS.applicationSubmitted, eventType: EVENTS.applicationSubmitted, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { applicationId: p.id } });
      // Cross-service wiring: applicant-facing status notification. The
      // schema has no separate applicant-name/contact field (unlike e.g.
      // advertisement-service's advertiserName), so the citizen identity we
      // notify is the application's own createdBy — the actor who raised it.
      //
      // Reads through the already-open outer `tx` (findByIdInTx), not
      // repo.findById's scopedRead, which would open a SECOND, nested
      // db.transaction() on the same connection pool as this outer send
      // transaction and deadlock the pool once enough submitApplication
      // calls are concurrently in-flight (pool.max = 10) — see the
      // notification-service checkQuota/checkDlt deadlock fixed in PR #1028.
      const app = await repo.findByIdInTx(tx, p.id, msg.tenantId);
      if (app) {
        await emitMunicipalNotification(tx, ctxOf(msg), {
          eventType: MUNICIPAL_EVENT_TYPES.applicationSubmitted,
          recipient: app.createdBy,
          recipientId: p.id,
          variables: { applicationId: p.id, applicationNumber: app.applicationNumber },
        });
      }
      await writeAudit(tx, ctxOf(msg), { action: "application.submit", resourceType: "building_application", resourceId: p.id });
    });
    // Read-through GET-by-id cache must not keep serving pre-submit state
    // (CLAUDE.md §6: "the consumer invalidates here").
    if (applied) await cache.invalidate(cache.makeKey(msg.tenantId, "application", p.id));
  });

  queue.subscribe(COMMANDS.withdrawApplication, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    let applied = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.updateStatus(tx, p.id, msg.tenantId, "withdrawn", msg.actorId);
      if (!ok) return;
      applied = true;
      await enqueue(tx, { topic: EVENTS.applicationWithdrawn, eventType: EVENTS.applicationWithdrawn, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { applicationId: p.id } });
      await writeAudit(tx, ctxOf(msg), { action: "application.withdraw", resourceType: "building_application", resourceId: p.id });
    });
    if (applied) await cache.invalidate(cache.makeKey(msg.tenantId, "application", p.id));
  });

  queue.subscribe(COMMANDS.recordFeePayment, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; transactionId: string };
    let applied = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.updateFeePayment(tx, p.id, msg.tenantId, p.transactionId, msg.actorId);
      if (!ok) return;
      applied = true;
      await enqueue(tx, { topic: EVENTS.feePaymentRecorded, eventType: EVENTS.feePaymentRecorded, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { applicationId: p.id, transactionId: p.transactionId } });
      await writeAudit(tx, ctxOf(msg), { action: "application.fee_payment", resourceType: "building_application", resourceId: p.id });
    });
    if (applied) await cache.invalidate(cache.makeKey(msg.tenantId, "application", p.id));
  });
}
