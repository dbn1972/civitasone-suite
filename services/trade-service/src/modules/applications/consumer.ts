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

const log = pino({ name: "trade.applications.consumer" });

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

export function registerApplicationConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.createApplication, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      businessName: string;
      tradeCategory: string;
      subCategory?: string;
      ownerName: string;
      premisesAddress: Record<string, unknown>;
      areaInSqft?: number;
      employeeCount?: number;
      documents?: Array<{ docType: string; fileId: string; uploadedAt: string }>;
    };
    const feeMinor = calculateFeeMinor({
      tradeCategory: p.tradeCategory,
      areaInSqft: p.areaInSqft,
      employeeCount: p.employeeCount,
    });
    const applicationNumber = generateApplicationNumber("ULB", Date.now() % 999999);

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertApplication(tx, {
        id: p.id,
        tenantId: msg.tenantId,
        applicationNumber,
        status: "draft",
        businessName: p.businessName,
        tradeCategory: p.tradeCategory,
        subCategory: p.subCategory ?? null,
        ownerName: p.ownerName,
        premisesAddress: p.premisesAddress as never,
        areaInSqft: p.areaInSqft ?? null,
        employeeCount: p.employeeCount ?? null,
        documents: p.documents ?? [],
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
        payload: { applicationId: p.id, applicationNumber, businessName: p.businessName, feeMinor: String(feeMinor), feeCurrency: "INR" },
      });
      await writeAudit(tx, ctxOf(msg), { action: "application.create", resourceType: "trade_application", resourceId: p.id });
    });
    log.info({ id: p.id, applicationNumber }, "trade application created");
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
      await writeAudit(tx, ctxOf(msg), { action: "application.submit", resourceType: "trade_application", resourceId: p.id });
    });
  });

  queue.subscribe(COMMANDS.withdrawApplication, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.updateStatus(tx, p.id, msg.tenantId, "withdrawn", msg.actorId);
      if (!ok) return;
      await enqueue(tx, { topic: EVENTS.applicationWithdrawn, eventType: EVENTS.applicationWithdrawn, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { applicationId: p.id } });
      await writeAudit(tx, ctxOf(msg), { action: "application.withdraw", resourceType: "trade_application", resourceId: p.id });
    });
  });

  queue.subscribe(COMMANDS.recordFeePayment, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; transactionId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.updateFeePayment(tx, p.id, msg.tenantId, p.transactionId, msg.actorId);
      if (!ok) return;
      await enqueue(tx, { topic: EVENTS.feePaymentRecorded, eventType: EVENTS.feePaymentRecorded, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { applicationId: p.id, transactionId: p.transactionId } });
      await writeAudit(tx, ctxOf(msg), { action: "application.fee_payment", resourceType: "trade_application", resourceId: p.id });
    });
  });
}
