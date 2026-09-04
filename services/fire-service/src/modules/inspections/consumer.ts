import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { cache } from "../../shared/infra.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { validateFindings } from "./domain.js";

const log = pino({ name: "fire.inspections.consumer" });

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

export function registerInspectionConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.scheduleInspection, async (msg) => {
    const p = msg.payload as { id: string; applicationId: string; inspectorId: string; scheduledDate: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insert(tx, {
        id: p.id,
        tenantId: msg.tenantId,
        applicationId: p.applicationId,
        inspectorId: p.inspectorId,
        scheduledDate: p.scheduledDate,
        status: "scheduled",
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.inspectionScheduled,
        eventType: EVENTS.inspectionScheduled,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { inspectionId: p.id, applicationId: p.applicationId, scheduledDate: p.scheduledDate },
      });
      await writeAudit(tx, ctxOf(msg), { action: "inspection.schedule", resourceType: "fire_inspection", resourceId: p.id });
    });
    log.info({ id: p.id, applicationId: p.applicationId }, "fire inspection scheduled");
  });

  queue.subscribe(COMMANDS.completeInspection, async (msg) => {
    const p = msg.payload as { inspectionId: string; recommendation: string; deficiencies?: unknown[] };
    let applied = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // fromStatuses=["scheduled"]: previously no status guard at all existed
      // here beyond the route's own racy pre-check.
      const row = await repo.updateStatus(tx, msg.tenantId, p.inspectionId, "completed", {
        recommendation: p.recommendation,
        deficiencies: p.deficiencies ?? null,
        inspectedAt: new Date(),
      }, ["scheduled"], msg.actorId);
      if (!row) return;
      applied = true;
      await enqueue(tx, {
        topic: EVENTS.inspectionCompleted,
        eventType: EVENTS.inspectionCompleted,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { inspectionId: p.inspectionId, recommendation: p.recommendation },
      });
      await writeAudit(tx, ctxOf(msg), { action: "inspection.complete", resourceType: "fire_inspection", resourceId: p.inspectionId });
    });
    // BUG FIX: same cache-invalidation gap as applications/consumer.ts (see
    // that file's comment) -- GET /v1/fire/inspections/:id is read-through
    // cached and nothing invalidated it on write.
    if (applied) await cache.invalidate(cache.makeKey(msg.tenantId, "inspection", p.inspectionId));
  });

  queue.subscribe(COMMANDS.recordFindings, async (msg) => {
    const p = msg.payload as { inspectionId: string; findings: unknown[] };
    // CRITICAL fix: this handler previously set status="completed" directly —
    // the SAME terminal status completeInspection sets — but with
    // recommendation left NULL. Calling POST .../findings alone, without ever
    // calling .../complete, flipped an inspection straight to "completed"
    // with no recommendation at all, completely bypassing the intended
    // recommend/approve gate (and, downstream, nocs' eligibility check in
    // this same PR looks for a completed inspection WITH an "approve"
    // recommendation — a findings-only "completion" could never satisfy that,
    // silently blocking legitimate NOC issuance forever for that
    // application). Findings are evidence gathered during the visit; only
    // /complete (with an explicit recommendation) actually completes an
    // inspection. This now updates findings without touching status, and
    // requires the inspection is still "scheduled" (same precondition
    // /complete has) via the same atomic guard.
    if (!validateFindings(p.findings)) {
      log.error({ inspectionId: p.inspectionId }, "invalid findings shape; refusing to record");
      return;
    }
    let applied = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const row = await repo.updateStatus(tx, msg.tenantId, p.inspectionId, "scheduled", {
        findings: p.findings,
      }, ["scheduled"], msg.actorId);
      if (!row) return;
      applied = true;
      await enqueue(tx, {
        topic: EVENTS.findingsRecorded,
        eventType: EVENTS.findingsRecorded,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { inspectionId: p.inspectionId },
      });
      await writeAudit(tx, ctxOf(msg), { action: "inspection.record_findings", resourceType: "fire_inspection", resourceId: p.inspectionId });
    });
    if (applied) await cache.invalidate(cache.makeKey(msg.tenantId, "inspection", p.inspectionId));
  });
}
