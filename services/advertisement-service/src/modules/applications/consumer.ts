import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { emitMunicipalFeeChallan, emitMunicipalNotification, municipalDecisionNotificationEventType } from "../../shared/cross-events.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
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
    const applicationNumber = generateApplicationNumber("ULB", Date.now() % 999999);

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
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
      await writeAudit(tx, ctxOf(msg), { action: "application.create", resourceType: "adv_application", resourceId: p.id });
    });
    log.info({ id: p.id, applicationNumber }, "advertisement application created");
  });

  queue.subscribe(COMMANDS.submitApplication, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.updateStatus(tx, p.id, msg.tenantId, "submitted", msg.actorId);
      if (!ok) return;
      await enqueue(tx, { topic: EVENTS.applicationSubmitted, eventType: EVENTS.applicationSubmitted, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { applicationId: p.id } });
      await emitMunicipalNotification(tx, ctxOf(msg), {
        eventType: EVENTS.applicationSubmitted,
        recipient: msg.actorId,
        recipientId: msg.actorId,
        variables: { applicationId: p.id },
      });
      await writeAudit(tx, ctxOf(msg), { action: "application.submit", resourceType: "adv_application", resourceId: p.id });
    });
  });
}
