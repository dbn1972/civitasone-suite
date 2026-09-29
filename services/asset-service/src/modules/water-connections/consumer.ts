/**
 * Water-connections consumer — CQRS write path for the water-connections
 * asset-register module (applications, connections).
 *
 * Before this: water-connections/routes.ts published commands
 * (asset.water.application.*, asset.water.connection.*) with no consumer.ts
 * ever registered in worker.ts, and no migration ever created the
 * `water_connections` schema/tables (see
 * migrations/0027_water_connections_tables.sql). POST returned 202
 * {id,status:"accepted"} but nothing was ever persisted; GET list/by-id hit
 * "relation ... does not exist" (500) or came back empty.
 *
 * Scope: implements the full command surface routes.ts already exposes
 * (application create through connection activate), since repo.ts already
 * had every insert/update function written and unused -- wiring them up is
 * mechanical, not new design. Status-mutation commands apply the target
 * status implied by the command name/domain.ts enum directly and do NOT
 * re-validate domain.ts's VALID_TRANSITIONS graph (e.g. approving an
 * application that was never submitted currently succeeds). There is also no
 * command/route for domain.ts's "under_review" state -- submit and
 * feasibility are the only two exposed steps between draft and
 * approved/rejected, so this consumer does not synthesize one. Deliberate
 * scope cut per "core create+list+get-by-id over complex status
 * transitions"; flagged here as a follow-up, not silently dropped.
 */
import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";
import { generateApplicationNumber, generateConnectionNumber, calculateFeeMinor } from "./domain.js";

const log = pino({ name: "water-connections-consumer" });
const AUDIT_TOPIC = "audit.event.record";
const WATER_APPLICATION_CREATED   = "asset.water.application.created";
const WATER_CONNECTION_INSTALLED  = "asset.water.connection.installed";

export function registerWaterConnectionConsumers(rawQueue: Queue): void {
  // #146 regression fix pattern: run every handler inside the message tenant
  // context so NOBYPASSRLS + FORCE RLS accepts consumer writes.
  const queue = tenantScoped(rawQueue);

  // ── applications ─────────────────────────────────────────────────────────
  queue.subscribe(COMMANDS.waterApplicationCreate, async (msg) => {
    try {
      const p = msg.payload as {
        id: string; tenantId: string; applicantName: string; applicantPhone: string;
        propertyId?: string; connectionType: string; pipeSize?: string;
        address?: Record<string, unknown>; documents?: unknown[];
      };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await repo.insertApplication(tx, {
          id: p.id, tenantId: p.tenantId, applicationNumber: generateApplicationNumber(),
          applicantName: p.applicantName, applicantPhone: p.applicantPhone,
          propertyId: p.propertyId ?? null, connectionType: p.connectionType,
          pipeSize: p.pipeSize ?? null, address: p.address ?? null, documents: p.documents ?? null,
          feeMinor: calculateFeeMinor(p.connectionType, p.pipeSize ?? ""),
          createdBy: msg.actorId, updatedBy: msg.actorId,
        });
        await enqueue(tx, {
          topic: WATER_APPLICATION_CREATED, eventType: WATER_APPLICATION_CREATED,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { applicationId: p.id },
        });
        await audit(tx, msg, "create", "water_application", p.id);
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "waterApplicationCreate failed"); }
  });

  queue.subscribe(COMMANDS.waterApplicationSubmit, async (msg) => {
    try {
      const p = msg.payload as { id: string; tenantId: string };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await repo.updateApplicationStatus(tx, p.id, p.tenantId, "submitted", { updatedBy: msg.actorId });
        await audit(tx, msg, "submit", "water_application", p.id);
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "waterApplicationSubmit failed"); }
  });

  queue.subscribe(COMMANDS.waterFeasibilityRecord, async (msg) => {
    try {
      const p = msg.payload as { id: string; tenantId: string; feasibilityReport: Record<string, unknown> };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await repo.updateApplicationStatus(tx, p.id, p.tenantId, "feasibility_check", {
          feasibilityReport: p.feasibilityReport, updatedBy: msg.actorId,
        });
        await audit(tx, msg, "feasibility_record", "water_application", p.id);
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "waterFeasibilityRecord failed"); }
  });

  queue.subscribe(COMMANDS.waterApplicationApprove, async (msg) => {
    try {
      const p = msg.payload as { id: string; tenantId: string };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await repo.updateApplicationStatus(tx, p.id, p.tenantId, "approved", { updatedBy: msg.actorId });
        await audit(tx, msg, "approve", "water_application", p.id);
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "waterApplicationApprove failed"); }
  });

  queue.subscribe(COMMANDS.waterApplicationReject, async (msg) => {
    try {
      const p = msg.payload as { id: string; tenantId: string; reason: string };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await repo.updateApplicationStatus(tx, p.id, p.tenantId, "rejected", {
          rejectionReason: p.reason, updatedBy: msg.actorId,
        });
        await audit(tx, msg, "reject", "water_application", p.id);
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "waterApplicationReject failed"); }
  });

  // ── connections ──────────────────────────────────────────────────────────
  queue.subscribe(COMMANDS.waterConnectionInstall, async (msg) => {
    try {
      const p = msg.payload as {
        id: string; applicationId: string; tenantId: string; meterId?: string; pipeSize?: string;
      };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const application = await repo.findApplicationByIdTx(tx, p.applicationId, p.tenantId);
        if (!application) {
          log.error({ messageId: msg.messageId, applicationId: p.applicationId }, "waterConnectionInstall: application not found for tenant");
          return;
        }
        await repo.insertConnection(tx, {
          id: p.id, tenantId: p.tenantId, connectionNumber: generateConnectionNumber(),
          applicationId: p.applicationId, meterId: p.meterId ?? null,
          connectionType: application.connectionType, pipeSize: p.pipeSize ?? application.pipeSize ?? null,
          installationDate: new Date().toISOString().slice(0, 10),
          address: application.address,
          createdBy: msg.actorId, updatedBy: msg.actorId,
        });
        await enqueue(tx, {
          topic: WATER_CONNECTION_INSTALLED, eventType: WATER_CONNECTION_INSTALLED,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { connectionId: p.id, applicationId: p.applicationId },
        });
        await audit(tx, msg, "install", "water_connection", p.id);
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "waterConnectionInstall failed"); }
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
    } catch (err) { log.error({ err, messageId: msg.messageId }, "waterConnectionActivate failed"); }
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
