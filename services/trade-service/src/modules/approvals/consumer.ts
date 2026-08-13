import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import * as appRepo from "../applications/repo.js";
import { validateScrutinyComplete, type ScrutinyFinding } from "./domain.js";

const log = pino({ name: "trade.approvals.consumer" });

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

export function registerApprovalConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.initiateScrutiny, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; applicationId: string; scrutinyType: string; officerId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertScrutiny(tx, {
        id: p.id, tenantId: msg.tenantId, applicationId: p.applicationId, scrutinyType: p.scrutinyType, officerId: p.officerId, status: "pending", createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await appRepo.updateStatus(tx, p.applicationId, msg.tenantId, "under_scrutiny", msg.actorId);
      await enqueue(tx, { topic: EVENTS.scrutinyInitiated, eventType: EVENTS.scrutinyInitiated, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { scrutinyId: p.id, applicationId: p.applicationId, scrutinyType: p.scrutinyType, officerId: p.officerId } });
      await writeAudit(tx, ctxOf(msg), { action: "scrutiny.initiate", resourceType: "trade_scrutiny_record", resourceId: p.id });
    });
    log.info({ id: p.id, applicationId: p.applicationId }, "trade scrutiny initiated");
  });

  queue.subscribe(COMMANDS.completeScrutiny, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; findings: Record<string, unknown>; deficiencyDetails?: string };
    const findingsList = (p.findings["items"] ?? []) as ScrutinyFinding[];
    const { allPassed, deficiencies } = validateScrutinyComplete(findingsList);
    const status = allPassed ? "completed" : "deficiency_found";
    const defText = deficiencies.length > 0 ? deficiencies.join("; ") : (p.deficiencyDetails ?? null);
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.completeScrutiny(tx, p.id, msg.tenantId, status, p.findings, defText, msg.actorId);
      await enqueue(tx, { topic: EVENTS.scrutinyCompleted, eventType: EVENTS.scrutinyCompleted, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { scrutinyId: p.id, status, deficiencies } });
      await writeAudit(tx, ctxOf(msg), { action: "scrutiny.complete", resourceType: "trade_scrutiny_record", resourceId: p.id });
    });
  });

  queue.subscribe(COMMANDS.decideApplication, async (msg) => {
    const p = msg.payload as { applicationId: string; tenantId: string; decision: string; reason?: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await appRepo.updateStatus(tx, p.applicationId, msg.tenantId, p.decision, msg.actorId);
      await enqueue(tx, { topic: EVENTS.applicationDecided, eventType: EVENTS.applicationDecided, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { applicationId: p.applicationId, decision: p.decision, reason: p.reason, decidedBy: msg.actorId } });
      await writeAudit(tx, ctxOf(msg), { action: `application.${p.decision}`, resourceType: "trade_application", resourceId: p.applicationId });
    });
    log.info({ applicationId: p.applicationId, decision: p.decision }, "trade application decided");
  });
}
