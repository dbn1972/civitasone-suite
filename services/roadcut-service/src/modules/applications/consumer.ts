import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { calculateFeeMinor, calculateDepositMinor, generateApplicationNumber } from "./domain.js";

const log = pino({ name: "roadcut.applications.consumer" });

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

export function registerApplicationConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.createApplication, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      applicantName: string;
      applicantOrg?: string;
      purpose: string;
      location: { latitude: number; longitude: number; address: string; ward?: string; zone?: string };
      roadType: string;
      cuttingLength: string;
      cuttingWidth: string;
      cuttingDepth: string;
      documents?: Array<{ docType: string; fileId: string; uploadedAt: string }>;
    };
    const cuttingLength = parseFloat(p.cuttingLength);
    const cuttingWidth = parseFloat(p.cuttingWidth);
    const feeMinor = calculateFeeMinor({ roadType: p.roadType, cuttingLength, cuttingWidth });
    const depositMinor = calculateDepositMinor({ roadType: p.roadType, cuttingLength, cuttingWidth });
    const applicationNumber = generateApplicationNumber("ULB", Date.now() % 999999);

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertApplication(tx, {
        id: p.id,
        tenantId: msg.tenantId,
        applicationNumber,
        status: "draft",
        applicantName: p.applicantName,
        applicantOrg: p.applicantOrg ?? null,
        purpose: p.purpose,
        location: p.location,
        roadType: p.roadType,
        cuttingLength: p.cuttingLength,
        cuttingWidth: p.cuttingWidth,
        cuttingDepth: p.cuttingDepth,
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
        resourceType: "roadcut_application",
        resourceId: p.id,
      });
    });
    log.info({ id: p.id, applicationNumber }, "roadcut application created");
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
        resourceType: "roadcut_application",
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
        resourceType: "roadcut_application",
        resourceId: p.id,
      });
    });
  });
}
