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

const log = pino({ name: "fire.applications.consumer" });

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

export function registerApplicationConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.createApplication, async (msg) => {
    const p = msg.payload as {
      id: string;
      buildingName: string;
      buildingAddress: Record<string, unknown>;
      occupancyType: string;
      buildingHeight?: string;
      numberOfFloors?: number;
      builtUpArea?: string;
      fireSafetyMeasures?: Record<string, unknown>;
      documents?: Array<{ docType: string; fileId: string; uploadedAt: string }>;
    };
    const builtUpAreaSqft = p.builtUpArea ? parseInt(p.builtUpArea, 10) || 0 : 0;
    const feeMinor = calculateFeeMinor(p.occupancyType as never, builtUpAreaSqft);
    const applicationNumber = generateApplicationNumber("ULB", new Date().getUTCFullYear(), Date.now() % 999999);

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insert(tx, {
        id: p.id,
        tenantId: msg.tenantId,
        applicationNumber,
        status: "draft",
        buildingName: p.buildingName,
        buildingAddress: p.buildingAddress as never,
        occupancyType: p.occupancyType,
        buildingHeight: p.buildingHeight ?? null,
        numberOfFloors: p.numberOfFloors ?? null,
        builtUpArea: p.builtUpArea ?? null,
        fireSafetyMeasures: p.fireSafetyMeasures ?? null,
        documents: p.documents ?? null,
        feeMinor,
        feeCurrency: "INR",
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
        payload: { applicationId: p.id, applicationNumber, buildingName: p.buildingName, feeMinor: String(feeMinor) },
      });
      await writeAudit(tx, ctxOf(msg), { action: "application.create", resourceType: "fire_application", resourceId: p.id });
    });
    log.info({ id: p.id, applicationNumber }, "fire application created");
  });

  queue.subscribe(COMMANDS.submitApplication, async (msg) => {
    const p = msg.payload as { applicationId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const row = await repo.updateStatus(tx, msg.tenantId, p.applicationId, "submitted", msg.actorId);
      if (!row) return;
      await enqueue(tx, { topic: EVENTS.applicationSubmitted, eventType: EVENTS.applicationSubmitted, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { applicationId: p.applicationId } });
      await emitMunicipalNotification(tx, ctxOf(msg), {
        eventType: EVENTS.applicationSubmitted,
        recipient: msg.actorId,
        recipientId: msg.actorId,
        variables: { applicationId: p.applicationId },
      });
      await writeAudit(tx, ctxOf(msg), { action: "application.submit", resourceType: "fire_application", resourceId: p.applicationId });
    });
  });

  queue.subscribe(COMMANDS.withdrawApplication, async (msg) => {
    const p = msg.payload as { applicationId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const row = await repo.updateStatus(tx, msg.tenantId, p.applicationId, "withdrawn", msg.actorId);
      if (!row) return;
      await enqueue(tx, { topic: EVENTS.applicationWithdrawn, eventType: EVENTS.applicationWithdrawn, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { applicationId: p.applicationId } });
      await writeAudit(tx, ctxOf(msg), { action: "application.withdraw", resourceType: "fire_application", resourceId: p.applicationId });
    });
  });
}
