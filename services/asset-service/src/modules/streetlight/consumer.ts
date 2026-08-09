import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";
import { generateFaultNumber, generateRequestNumber } from "./domain.js";

const log = pino({ name: "asset-streetlight-consumer" });
const AUDIT_TOPIC = "audit.event.record";

export function registerStreetlightConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.streetlightCreate, async (msg) => {
    try {
      const p = msg.payload as {
        id: string; tenantId: string; poleId: string; location?: unknown;
        lampType: string; wattage: number; installationDate?: string; circuitId?: string;
      };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await repo.insertStreetlight(tx, {
          id: p.id, tenantId: p.tenantId, poleId: p.poleId,
          location: p.location ?? null, lampType: p.lampType, wattage: p.wattage,
          installationDate: p.installationDate ?? null, status: "operational",
          lastMaintenanceDate: null, circuitId: p.circuitId ?? null,
          createdBy: msg.actorId, updatedBy: msg.actorId,
        });
        await audit(tx, msg, "create", "streetlight", p.id);
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "Consumer processing failed");
    }
  });

  queue.subscribe(COMMANDS.streetlightStatusUpdate, async (msg) => {
    try {
      const p = msg.payload as { id: string; tenantId: string; status: string };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await repo.updateStreetlightStatus(tx, p.id, p.tenantId, p.status, { updatedBy: msg.actorId });
        await audit(tx, msg, "status_update", "streetlight", p.id);
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "Consumer processing failed");
    }
  });

  queue.subscribe(COMMANDS.streetlightFaultReport, async (msg) => {
    try {
      const p = msg.payload as {
        id: string; tenantId: string; streetlightId: string;
        faultType: string; description?: string; photo?: string;
      };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await repo.insertFault(tx, {
          id: p.id, tenantId: p.tenantId, streetlightId: p.streetlightId,
          faultNumber: generateFaultNumber(), reportedBy: msg.actorId,
          faultType: p.faultType, description: p.description ?? null,
          photo: p.photo ?? null, status: "reported",
          assignedTo: null, resolvedAt: null, resolution: null,
          createdBy: msg.actorId, updatedBy: msg.actorId,
        });
        await audit(tx, msg, "report", "streetlight_fault", p.id);
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "Consumer processing failed");
    }
  });

  queue.subscribe(COMMANDS.streetlightFaultAssign, async (msg) => {
    try {
      const p = msg.payload as { id: string; tenantId: string; assignedTo: string };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await repo.updateFaultStatus(tx, p.id, p.tenantId, "assigned", {
          assignedTo: p.assignedTo, updatedBy: msg.actorId,
        });
        await audit(tx, msg, "assign", "streetlight_fault", p.id);
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "Consumer processing failed");
    }
  });

  queue.subscribe(COMMANDS.streetlightFaultResolve, async (msg) => {
    try {
      const p = msg.payload as { id: string; tenantId: string; resolution: string };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await repo.updateFaultStatus(tx, p.id, p.tenantId, "resolved", {
          resolvedAt: new Date(), resolution: p.resolution, updatedBy: msg.actorId,
        });
        await audit(tx, msg, "resolve", "streetlight_fault", p.id);
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "Consumer processing failed");
    }
  });

  queue.subscribe(COMMANDS.streetlightRequestCreate, async (msg) => {
    try {
      const p = msg.payload as {
        id: string; tenantId: string; requestType: string;
        location?: unknown; justification?: string;
      };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await repo.insertRequest(tx, {
          id: p.id, tenantId: p.tenantId, requestNumber: generateRequestNumber(),
          requestedBy: msg.actorId, requestType: p.requestType,
          location: p.location ?? null, justification: p.justification ?? null,
          status: "submitted", surveyReport: null, approvedBy: null,
          createdBy: msg.actorId, updatedBy: msg.actorId,
        });
        await audit(tx, msg, "create", "streetlight_request", p.id);
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "Consumer processing failed");
    }
  });

  queue.subscribe(COMMANDS.streetlightRequestSurvey, async (msg) => {
    try {
      const p = msg.payload as { id: string; tenantId: string; surveyReport: unknown };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await repo.updateRequestStatus(tx, p.id, p.tenantId, "surveyed", {
          surveyReport: p.surveyReport, updatedBy: msg.actorId,
        });
        await audit(tx, msg, "survey", "streetlight_request", p.id);
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "Consumer processing failed");
    }
  });

  queue.subscribe(COMMANDS.streetlightRequestApprove, async (msg) => {
    try {
      const p = msg.payload as { id: string; tenantId: string };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await repo.updateRequestStatus(tx, p.id, p.tenantId, "approved", {
          approvedBy: msg.actorId, updatedBy: msg.actorId,
        });
        await audit(tx, msg, "approve", "streetlight_request", p.id);
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
