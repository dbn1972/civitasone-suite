import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { calculateFeeMinor, calculateDepositMinor, generateApplicationNumber } from "./domain.js";

const log = pino({ name: "event.applications.consumer" });

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

export function registerApplicationConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.createApplication, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      organiserName: string;
      organiserOrg?: string;
      organiserPhone: string;
      eventType: string;
      venueName: string;
      venueAddress: Record<string, unknown>;
      startDate: string;
      endDate: string;
      expectedAttendance: number;
      temporaryStructures?: Array<{ type: string; count: number; areaSqft?: number }>;
      soundPermission?: boolean;
      documents?: Array<{ docType: string; fileId: string; uploadedAt: string }>;
    };
    const feeMinor = calculateFeeMinor({
      eventType: p.eventType,
      expectedAttendance: p.expectedAttendance,
      soundPermission: p.soundPermission ?? false,
    });
    const depositMinor = calculateDepositMinor({
      eventType: p.eventType,
      expectedAttendance: p.expectedAttendance,
      soundPermission: p.soundPermission ?? false,
    });
    const applicationNumber = generateApplicationNumber("ULB", Date.now() % 999999);

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertApplication(tx, {
        id: p.id,
        tenantId: msg.tenantId,
        applicationNumber,
        status: "draft",
        organiserName: p.organiserName,
        organiserOrg: p.organiserOrg ?? null,
        organiserPhone: p.organiserPhone,
        eventType: p.eventType,
        venueName: p.venueName,
        venueAddress: p.venueAddress as never,
        startDate: p.startDate,
        endDate: p.endDate,
        expectedAttendance: p.expectedAttendance,
        temporaryStructures: p.temporaryStructures as never ?? null,
        soundPermission: p.soundPermission ?? false,
        documents: p.documents ?? [],
        feeMinor,
        depositMinor,
        currency: "INR",
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
          feeMinor: String(feeMinor),
          depositMinor: String(depositMinor),
          currency: "INR",
        },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "application.create",
        resourceType: "event_application",
        resourceId: p.id,
      });
    });
    log.info({ id: p.id, applicationNumber }, "event application created");
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
      await writeAudit(tx, ctxOf(msg), {
        action: "application.submit",
        resourceType: "event_application",
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
        resourceType: "event_application",
        resourceId: p.id,
      });
    });
  });
}
