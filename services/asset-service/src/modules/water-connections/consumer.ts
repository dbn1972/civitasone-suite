import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";
import { generateApplicationNumber, generateConnectionNumber, calculateFeeMinor, assertTransition } from "./domain.js";

const log = pino({ name: "asset-water-connections-consumer" });
const AUDIT_TOPIC = "audit.event.record";

export function registerWaterConnectionConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.waterApplicationCreate, async (msg) => {
    try {
      const p = msg.payload as {
        id: string; tenantId: string; applicantName: string; applicantPhone: string;
        propertyId?: string; connectionType: string; pipeSize?: string;
        address?: unknown; documents?: unknown;
      };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const feeMinor = calculateFeeMinor(p.connectionType, p.pipeSize ?? "15mm");
        await repo.insertApplication(tx, {
          id: p.id, tenantId: p.tenantId,
          applicationNumber: generateApplicationNumber(),
          status: "draft", applicantName: p.applicantName, applicantPhone: p.applicantPhone,
          propertyId: p.propertyId ?? null, connectionType: p.connectionType,
          pipeSize: p.pipeSize ?? null, address: p.address ?? null,
          documents: p.documents ?? null, feeMinor, feeCurrency: "INR",
          feePaid: false, feeTransactionId: null, feasibilityReport: null,
          createdBy: msg.actorId, updatedBy: msg.actorId,
        });
        await audit(tx, msg, "create", "water_application", p.id);
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "Consumer processing failed");
    }
  });

  queue.subscribe(COMMANDS.waterApplicationSubmit, async (msg) => {
    try {
      const p = msg.payload as { id: string; tenantId: string };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        assertTransition("draft", "submitted");
        await repo.updateApplicationStatus(tx, p.id, p.tenantId, "submitted", { updatedBy: msg.actorId });
        await audit(tx, msg, "submit", "water_application", p.id);
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "Consumer processing failed");
    }
  });

  queue.subscribe(COMMANDS.waterFeasibilityRecord, async (msg) => {
    try {
      const p = msg.payload as { id: string; tenantId: string; feasibilityReport: unknown };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await repo.updateApplicationStatus(tx, p.id, p.tenantId, "feasibility_check", {
          feasibilityReport: p.feasibilityReport, updatedBy: msg.actorId,
        });
        await audit(tx, msg, "feasibility", "water_application", p.id);
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "Consumer processing failed");
    }
  });

  queue.subscribe(COMMANDS.waterApplicationApprove, async (msg) => {
    try {
      const p = msg.payload as { id: string; tenantId: string };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await repo.updateApplicationStatus(tx, p.id, p.tenantId, "approved", { updatedBy: msg.actorId });
        await audit(tx, msg, "approve", "water_application", p.id);
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "Consumer processing failed");
    }
  });

  queue.subscribe(COMMANDS.waterApplicationReject, async (msg) => {
    try {
      const p = msg.payload as { id: string; tenantId: string; reason: string };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await repo.updateApplicationStatus(tx, p.id, p.tenantId, "rejected", { updatedBy: msg.actorId });
        await audit(tx, msg, "reject", "water_application", p.id);
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "Consumer processing failed");
    }
  });

  queue.subscribe(COMMANDS.waterConnectionInstall, async (msg) => {
    try {
      const p = msg.payload as {
        id: string; applicationId: string; tenantId: string; meterId?: string; pipeSize?: string;
      };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await repo.updateApplicationStatus(tx, p.applicationId, p.tenantId, "installed", { updatedBy: msg.actorId });
        await repo.insertConnection(tx, {
          id: p.id, tenantId: p.tenantId, connectionNumber: generateConnectionNumber(),
          applicationId: p.applicationId, meterId: p.meterId ?? null,
          status: "active", connectionType: "domestic", pipeSize: p.pipeSize ?? null,
          installationDate: new Date().toISOString().slice(0, 10),
          activationDate: null, address: null,
          createdBy: msg.actorId, updatedBy: msg.actorId,
        });
        await audit(tx, msg, "install", "water_connection", p.id);
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "Consumer processing failed");
    }
  });

  queue.subscribe(COMMANDS.waterConnectionActivate, async (msg) => {
    try {
      const p = msg.payload as { id: string; tenantId: string };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await repo.updateConnectionStatus(tx, p.id, p.tenantId, "active", {
          activationDate: new Date().toISOString().slice(0, 10), updatedBy: msg.actorId,
        });
        await audit(tx, msg, "activate", "water_connection", p.id);
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "Consumer processing failed");
    }
  });
}

async function audit(tx: any, msg: any, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "asset", action, resourceType, resourceId, outcome: "success" },
  });
}
