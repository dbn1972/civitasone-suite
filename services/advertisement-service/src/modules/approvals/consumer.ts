import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { cache } from "../../shared/infra.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import * as appRepo from "../applications/repo.js";

const log = pino({ name: "advertisement.approvals.consumer" });

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

export function registerApprovalConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.initiateScrutiny, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      applicationId: string;
      scrutinyType: string;
      officerId: string;
    };

    let applied = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // appRepo.updateStatus's boolean return (application actually matched
      // tenant+id) was previously discarded, so a scrutiny record could get
      // inserted, and a scrutinyInitiated event + audit record published,
      // for an application that was never actually moved to "under_review".
      // Check it FIRST so a failed precondition creates no orphaned scrutiny
      // record at all (same pattern already fixed in building-service).
      const ok = await appRepo.updateStatus(tx, p.applicationId, msg.tenantId, "under_review", msg.actorId);
      if (!ok) return;
      applied = true;
      await repo.insertScrutiny(tx, {
        id: p.id,
        tenantId: msg.tenantId,
        applicationId: p.applicationId,
        scrutinyType: p.scrutinyType,
        officerId: p.officerId,
        status: "pending",
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.scrutinyInitiated,
        eventType: EVENTS.scrutinyInitiated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { scrutinyId: p.id, applicationId: p.applicationId, scrutinyType: p.scrutinyType },
      });
      await writeAudit(tx, ctxOf(msg), { action: "scrutiny.initiate", resourceType: "adv_scrutiny", resourceId: p.id });
    });
    // GET /v1/advertisement/applications/:id reads through a cache that only
    // this write path can invalidate (CLAUDE.md §6).
    if (applied) await cache.invalidate(cache.makeKey(msg.tenantId, "application", p.applicationId));
    if (applied) log.info({ id: p.id, applicationId: p.applicationId }, "scrutiny initiated");
  });

  queue.subscribe(COMMANDS.completeScrutiny, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; findings: Record<string, unknown>; deficiencyDetails?: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.completeScrutiny(tx, p.id, msg.tenantId, p.findings, msg.actorId);
      if (!ok) return;
      await enqueue(tx, { topic: EVENTS.scrutinyCompleted, eventType: EVENTS.scrutinyCompleted, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { scrutinyId: p.id } });
      await writeAudit(tx, ctxOf(msg), { action: "scrutiny.complete", resourceType: "adv_scrutiny", resourceId: p.id });
    });
  });

  queue.subscribe(COMMANDS.decideApplication, async (msg) => {
    const p = msg.payload as { applicationId: string; tenantId: string; decision: string; reason?: string };
    let applied = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await appRepo.updateStatus(tx, p.applicationId, msg.tenantId, p.decision, msg.actorId);
      if (!ok) return;
      applied = true;
      await enqueue(tx, { topic: EVENTS.applicationDecided, eventType: EVENTS.applicationDecided, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { applicationId: p.applicationId, decision: p.decision, reason: p.reason } });
      await writeAudit(tx, ctxOf(msg), { action: "application.decide", resourceType: "adv_application", resourceId: p.applicationId, details: { decision: p.decision } });
    });
    if (applied) await cache.invalidate(cache.makeKey(msg.tenantId, "application", p.applicationId));
  });
}
