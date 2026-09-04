import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { cache } from "../../shared/infra.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { emitMunicipalFeeChallan, emitMunicipalNotification, MUNICIPAL_EVENT_TYPES } from "../../shared/cross-events.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { calculateFeeMinor, generateApplicationNumber } from "./domain.js";

const log = pino({ name: "advertisement.applications.consumer" });

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

export function registerApplicationConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.createApplication, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      advertiserName: string;
      advertiserOrg: string;
      advertisementType: string;
      location: Record<string, unknown>;
      dimensions: { widthFt: number; heightFt: number; areaInSqFt: number };
      structuralDetails?: Record<string, unknown>;
      creative?: string;
      documents?: Array<{ docType: string; fileId: string; uploadedAt: string }>;
    };
    const feeMinor = calculateFeeMinor({
      advertisementType: p.advertisementType,
      dimensions: p.dimensions,
    });
    let applicationNumber = "";

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // BUG FIX (collision-prone number generation): sequence now comes from
      // a real Postgres SEQUENCE (nextval, atomic) instead of
      // Date.now() % 999999, which could produce identical numbers for two
      // commands processed close together and throw on the UNIQUE
      // constraint mid-transaction. See repo.nextApplicationNumberSeq and
      // migrations/0003_number_sequences.sql.
      const seq = await repo.nextApplicationNumberSeq(tx);
      applicationNumber = generateApplicationNumber("ULB", seq);
      await repo.insertApplication(tx, {
        id: p.id,
        tenantId: msg.tenantId,
        applicationNumber,
        status: "draft",
        advertiserName: p.advertiserName,
        advertiserOrg: p.advertiserOrg,
        advertisementType: p.advertisementType,
        location: p.location as never,
        dimensions: p.dimensions as never,
        structuralDetails: (p.structuralDetails as never) ?? null,
        creative: p.creative ?? null,
        documents: p.documents ?? [],
        feeMinor,
        currency: "INR",
        feePaid: false,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.applicationCreated,
        eventType: EVENTS.applicationCreated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { applicationId: p.id, applicationNumber, advertiserName: p.advertiserName, feeMinor: String(feeMinor), currency: "INR" },
      });
      // No cross-service wiring here: a "draft" application hasn't been
      // formally filed and can still be edited or withdrawn without ever
      // being submitted (see VALID_TRANSITIONS in domain.ts). The fee is
      // computed and stored on the row now, but does not genuinely become
      // payable until the applicant actually submits — see
      // COMMANDS.submitApplication below, which is where the fee challan
      // and the citizen notification are both raised.
      await writeAudit(tx, ctxOf(msg), { action: "application.create", resourceType: "adv_application", resourceId: p.id });
    });
    log.info({ id: p.id, applicationNumber }, "advertisement application created");
  });

  queue.subscribe(COMMANDS.submitApplication, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    // Read before the tx, not nested inside it: the fee challan and the
    // citizen notification both need the row's fee/advertiser details, which
    // repo.updateStatus's own return value doesn't carry. repo.findById goes
    // through scopedRead (its own db.transaction), so calling it from INSIDE
    // this handler's write transaction would hold the outer connection while
    // requesting a second one from the same pool — the exact deadlock class
    // closed in notification-service tonight (PR #1028).
    const application = await repo.findById(p.id, msg.tenantId);
    let applied = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.updateStatus(tx, p.id, msg.tenantId, "submitted", msg.actorId);
      if (!ok) return;
      applied = true;
      await enqueue(tx, { topic: EVENTS.applicationSubmitted, eventType: EVENTS.applicationSubmitted, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { applicationId: p.id } });
      // Cross-service wiring (municipal-sec5 event contract, Wave 3): the
      // application is now formally filed, which is the point the assessed
      // fee actually becomes payable — raise the challan atomically with the
      // status transition that creates the obligation. emitMunicipalFeeChallan
      // no-ops for amountMinor <= 0n, so no separate guard is needed here.
      if (application?.feeMinor) {
        await emitMunicipalFeeChallan(tx, ctxOf(msg), {
          sourceRef: application.applicationNumber,
          depositor: application.advertiserName,
          amountMinor: application.feeMinor,
          currency: application.currency,
        });
      }
      // Citizen-meaningful transition: the applicant's application was
      // successfully submitted.
      await emitMunicipalNotification(tx, ctxOf(msg), {
        eventType: MUNICIPAL_EVENT_TYPES.applicationSubmitted,
        recipient: application?.advertiserName ?? "Applicant",
        recipientId: application?.createdBy ?? msg.actorId,
        variables: {
          applicationId: p.id,
          applicationNumber: application?.applicationNumber ?? "",
          feeMinor: application?.feeMinor ? String(application.feeMinor) : "0",
        },
      });
      await writeAudit(tx, ctxOf(msg), { action: "application.submit", resourceType: "adv_application", resourceId: p.id });
    });
    // GET /v1/advertisement/applications/:id (applications/routes.ts) reads
    // through a cache that only this write path can invalidate (CLAUDE.md §6).
    if (applied) await cache.invalidate(cache.makeKey(msg.tenantId, "application", p.id));
  });
}
