/**
 * Streetlight consumer — CQRS write path for the streetlight asset-register
 * module (streetlights, faults, requests).
 *
 * Before this: streetlight/routes.ts published commands (asset.streetlight.*)
 * with no consumer.ts ever registered in worker.ts, and no migration ever
 * created the `streetlight` schema/tables (see
 * migrations/0030_streetlight_tables.sql). POST returned 202
 * {id,status:"accepted"} but nothing was ever persisted; GET list/by-id hit
 * "relation ... does not exist" (500) or came back empty.
 *
 * Scope: implements the full command surface streetlight/routes.ts already
 * exposes (create + status/fault/request lifecycle), since streetlight/repo.ts
 * already had every insert-and-update function written and unused -- wiring
 * them up is mechanical, not new design. The status-mutation commands
 * (status.update, fault.assign, fault.resolve, request.survey,
 * request.approve) apply the target status implied by the command directly
 * and do NOT re-validate the transition graph in domain.ts
 * (assertFaultTransition / assertRequestTransition) -- e.g. resolving a fault
 * that was never assigned currently succeeds rather than being rejected with
 * a domain error. Deliberate scope cut per "core create+list+get-by-id over
 * complex status transitions"; flagged here as a follow-up, not silently
 * dropped.
 */
import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";
import { generateFaultNumber, generateRequestNumber } from "./domain.js";

const log = pino({ name: "streetlight-consumer" });
const AUDIT_TOPIC = "audit.event.record";
const STREETLIGHT_CREATED         = "asset.streetlight.created";
const STREETLIGHT_FAULT_REPORTED  = "asset.streetlight.fault.reported";
const STREETLIGHT_REQUEST_CREATED = "asset.streetlight.request.created";

export function registerStreetlightConsumers(rawQueue: Queue): void {
  // #146 regression fix pattern: run every handler inside the message tenant
  // context so NOBYPASSRLS + FORCE RLS accepts consumer writes (see
  // register/consumer.ts, condemnation/consumer.ts).
  const queue = tenantScoped(rawQueue);

  // ── streetlights ─────────────────────────────────────────────────────────
  queue.subscribe(COMMANDS.streetlightCreate, async (msg) => {
    try {
      const p = msg.payload as {
        id: string; tenantId: string; poleId: string;
        location?: Record<string, unknown>; lampType: string; wattage: number;
        installationDate?: string; circuitId?: string;
      };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await repo.insertStreetlight(tx, {
          id: p.id, tenantId: p.tenantId, poleId: p.poleId,
          location: p.location ?? null, lampType: p.lampType, wattage: p.wattage,
          installationDate: p.installationDate ?? null, circuitId: p.circuitId ?? null,
          createdBy: msg.actorId, updatedBy: msg.actorId,
        });
        await enqueue(tx, {
          topic: STREETLIGHT_CREATED, eventType: STREETLIGHT_CREATED,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { streetlightId: p.id, poleId: p.poleId },
        });
        await audit(tx, msg, "create", "streetlight", p.id);
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "streetlightCreate failed"); }
  });

  queue.subscribe(COMMANDS.streetlightStatusUpdate, async (msg) => {
    try {
      const p = msg.payload as { id: string; tenantId: string; status: string };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await repo.updateStreetlightStatus(tx, p.id, p.tenantId, p.status, { updatedBy: msg.actorId });
        await audit(tx, msg, "status_update", "streetlight", p.id);
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "streetlightStatusUpdate failed"); }
  });

  // ── faults ───────────────────────────────────────────────────────────────
  queue.subscribe(COMMANDS.streetlightFaultReport, async (msg) => {
    try {
      const p = msg.payload as {
        id: string; tenantId: string; streetlightId: string; faultType: string;
        description?: string; photo?: string;
      };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await repo.insertFault(tx, {
          id: p.id, tenantId: p.tenantId, streetlightId: p.streetlightId,
          faultNumber: generateFaultNumber(), reportedBy: msg.actorId,
          faultType: p.faultType, description: p.description ?? null, photo: p.photo ?? null,
          createdBy: msg.actorId, updatedBy: msg.actorId,
        });
        await enqueue(tx, {
          topic: STREETLIGHT_FAULT_REPORTED, eventType: STREETLIGHT_FAULT_REPORTED,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { faultId: p.id, streetlightId: p.streetlightId },
        });
        await audit(tx, msg, "fault_report", "streetlight_fault", p.id);
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "streetlightFaultReport failed"); }
  });

  queue.subscribe(COMMANDS.streetlightFaultAssign, async (msg) => {
    try {
      const p = msg.payload as { id: string; tenantId: string; assignedTo: string };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await repo.updateFaultStatus(tx, p.id, p.tenantId, "assigned", { assignedTo: p.assignedTo, updatedBy: msg.actorId });
        await audit(tx, msg, "fault_assign", "streetlight_fault", p.id);
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "streetlightFaultAssign failed"); }
  });

  queue.subscribe(COMMANDS.streetlightFaultResolve, async (msg) => {
    try {
      const p = msg.payload as { id: string; tenantId: string; resolution: string };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await repo.updateFaultStatus(tx, p.id, p.tenantId, "resolved", {
          resolution: p.resolution, resolvedAt: new Date(), updatedBy: msg.actorId,
        });
        await audit(tx, msg, "fault_resolve", "streetlight_fault", p.id);
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "streetlightFaultResolve failed"); }
  });

  // ── requests ─────────────────────────────────────────────────────────────
  queue.subscribe(COMMANDS.streetlightRequestCreate, async (msg) => {
    try {
      const p = msg.payload as {
        id: string; tenantId: string; requestType: string;
        location?: Record<string, unknown>; justification?: string;
      };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await repo.insertRequest(tx, {
          id: p.id, tenantId: p.tenantId, requestNumber: generateRequestNumber(),
          requestedBy: msg.actorId, requestType: p.requestType,
          location: p.location ?? null, justification: p.justification ?? null,
          createdBy: msg.actorId, updatedBy: msg.actorId,
        });
        await enqueue(tx, {
          topic: STREETLIGHT_REQUEST_CREATED, eventType: STREETLIGHT_REQUEST_CREATED,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { requestId: p.id },
        });
        await audit(tx, msg, "request_create", "streetlight_request", p.id);
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "streetlightRequestCreate failed"); }
  });

  queue.subscribe(COMMANDS.streetlightRequestSurvey, async (msg) => {
    try {
      const p = msg.payload as { id: string; tenantId: string; surveyReport: Record<string, unknown> };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await repo.updateRequestStatus(tx, p.id, p.tenantId, "surveyed", { surveyReport: p.surveyReport, updatedBy: msg.actorId });
        await audit(tx, msg, "request_survey", "streetlight_request", p.id);
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "streetlightRequestSurvey failed"); }
  });

  queue.subscribe(COMMANDS.streetlightRequestApprove, async (msg) => {
    try {
      const p = msg.payload as { id: string; tenantId: string };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await repo.updateRequestStatus(tx, p.id, p.tenantId, "approved", { approvedBy: msg.actorId, updatedBy: msg.actorId });
        await audit(tx, msg, "request_approve", "streetlight_request", p.id);
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "streetlightRequestApprove failed"); }
  });
}

async function audit(
  tx: Parameters<typeof enqueue>[0],
  msg: { tenantId: string; actorId: string; correlationId: string },
  action: string, resourceType: string, resourceId: string,
): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "asset", action, resourceType, resourceId, outcome: "success" },
  });
}
