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

const log = pino({ name: "shop.registrations.consumer" });

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

export function registerRegistrationConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.createApplication, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      establishmentName: string;
      establishmentType: string;
      ownerName: string;
      ownerType: string;
      premisesAddress: Record<string, unknown>;
      premisesPropertyId?: string;
      activityDescription?: string;
      activityCategory: string;
      employeeCount?: number;
      capacityDetails?: { seating?: number; areaSqft?: number; floors?: number };
      documents?: Array<{ docType: string; fileId: string; uploadedAt: string }>;
    };
    const feeAmountMinor = calculateFeeMinor({
      establishmentType: p.establishmentType,
      activityCategory: p.activityCategory,
      employeeCount: p.employeeCount,
      areaSqft: p.capacityDetails?.areaSqft,
    });
    const applicationNumber = generateApplicationNumber("ULB", Date.now() % 999999);

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertApplication(tx, {
        id: p.id,
        tenantId: msg.tenantId,
        applicationNumber,
        status: "draft",
        applicantId: msg.actorId,
        establishmentName: p.establishmentName,
        establishmentType: p.establishmentType,
        ownerName: p.ownerName,
        ownerType: p.ownerType,
        premisesAddress: p.premisesAddress as never,
        premisesPropertyId: p.premisesPropertyId ?? null,
        activityDescription: p.activityDescription ?? null,
        activityCategory: p.activityCategory,
        employeeCount: p.employeeCount ?? null,
        capacityDetails: p.capacityDetails as never ?? null,
        documents: p.documents ?? [],
        feeAmountMinor,
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
        payload: {
          applicationId: p.id,
          applicationNumber,
          establishmentName: p.establishmentName,
          feeAmountMinor: String(feeAmountMinor),
          feeCurrency: "INR",
        },
      });
      await emitMunicipalFeeChallan(tx, ctxOf(msg), {
        sourceRef: p.id,
        depositor: p.establishmentName,
        amountMinor: feeAmountMinor,
        currency: "INR",
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "application.create",
        resourceType: "shop_application",
        resourceId: p.id,
      });
    });
    log.info({ id: p.id, applicationNumber }, "shop application created");
  });

  queue.subscribe(COMMANDS.submitApplication, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.updateStatus(tx, p.id, msg.tenantId, "submitted", msg.actorId);
      if (!ok) return;
      await enqueue(tx, {
        topic: EVENTS.applicationSubmitted,
        eventType: EVENTS.applicationSubmitted,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { applicationId: p.id },
      });
      await emitMunicipalNotification(tx, ctxOf(msg), {
        eventType: EVENTS.applicationSubmitted,
        recipient: msg.actorId,
        recipientId: msg.actorId,
        variables: { applicationId: p.id },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "application.submit",
        resourceType: "shop_application",
        resourceId: p.id,
      });
    });
  });

  queue.subscribe(COMMANDS.withdrawApplication, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.updateStatus(tx, p.id, msg.tenantId, "withdrawn", msg.actorId);
      if (!ok) return;
      await enqueue(tx, {
        topic: EVENTS.applicationWithdrawn,
        eventType: EVENTS.applicationWithdrawn,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { applicationId: p.id },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "application.withdraw",
        resourceType: "shop_application",
        resourceId: p.id,
      });
    });
  });

  queue.subscribe(COMMANDS.recordFeePayment, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; transactionId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.updateFeePayment(tx, p.id, msg.tenantId, p.transactionId, msg.actorId);
      if (!ok) return;
      await enqueue(tx, {
        topic: EVENTS.feePaymentRecorded,
        eventType: EVENTS.feePaymentRecorded,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { applicationId: p.id, transactionId: p.transactionId },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "application.fee_payment",
        resourceType: "shop_application",
        resourceId: p.id,
      });
    });
  });
}
