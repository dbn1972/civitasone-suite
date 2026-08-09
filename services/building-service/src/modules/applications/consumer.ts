import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { calculateFeeMinor, generateApplicationNumber, computeFAR } from "./domain.js";

const log = pino({ name: "building.applications.consumer" });

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
    const applicationNumber = generateApplicationNumber("ULB", Date.now() % 999999);
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
      await writeAudit(tx, ctxOf(msg), { action: "application.create", resourceType: "building_application", resourceId: p.id });
    });
    log.info({ id: p.id, applicationNumber }, "building application created");
  });

  queue.subscribe(COMMANDS.submitApplication, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.updateStatus(tx, p.id, msg.tenantId, "submitted", msg.actorId);
      if (!ok) return;
      await enqueue(tx, { topic: EVENTS.applicationSubmitted, eventType: EVENTS.applicationSubmitted, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { applicationId: p.id } });
      await writeAudit(tx, ctxOf(msg), { action: "application.submit", resourceType: "building_application", resourceId: p.id });
    });
  });

  queue.subscribe(COMMANDS.withdrawApplication, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.updateStatus(tx, p.id, msg.tenantId, "withdrawn", msg.actorId);
      if (!ok) return;
      await enqueue(tx, { topic: EVENTS.applicationWithdrawn, eventType: EVENTS.applicationWithdrawn, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { applicationId: p.id } });
      await writeAudit(tx, ctxOf(msg), { action: "application.withdraw", resourceType: "building_application", resourceId: p.id });
    });
  });

  queue.subscribe(COMMANDS.recordFeePayment, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; transactionId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.updateFeePayment(tx, p.id, msg.tenantId, p.transactionId, msg.actorId);
      if (!ok) return;
      await enqueue(tx, { topic: EVENTS.feePaymentRecorded, eventType: EVENTS.feePaymentRecorded, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { applicationId: p.id, transactionId: p.transactionId } });
      await writeAudit(tx, ctxOf(msg), { action: "application.fee_payment", resourceType: "building_application", resourceId: p.id });
    });
  });
}
