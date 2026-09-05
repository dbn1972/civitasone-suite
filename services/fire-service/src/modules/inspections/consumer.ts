import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { cache } from "../../shared/infra.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { emitMunicipalNotification, MUNICIPAL_EVENT_TYPES } from "../../shared/cross-events.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import * as appRepo from "../applications/repo.js";
import { validateFindings } from "./domain.js";

const log = pino({ name: "fire.inspections.consumer" });

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

export function registerInspectionConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.scheduleInspection, async (msg) => {
    const p = msg.payload as { id: string; applicationId: string; inspectorId: string; scheduledDate: string };
    // Recipient-lookup read BEFORE opening the write transaction — never
    // nested inside it (the PR #1028 connection-pool deadlock class:
    // repo.findById below opens its own scopedRead transaction, so calling
    // it from inside db.transaction would nest transactions on the same
    // pool). This service has no citizen-name field anywhere in its schema
    // (see shared/cross-events.ts's file header), so the application's
    // buildingName/createdBy is the best available notification identity.
    const application = await appRepo.findById(msg.tenantId, p.applicationId);
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
      // Citizen-meaningful transition: an inspection has been scheduled
      // against the applicant's building and they need the date. No
      // canonical "inspection scheduled" municipal event type exists (see
      // packages/events/src/municipal-cross.ts's MUNICIPAL_EVENT_TYPES) —
      // statusChanged is the same fallback shop-service/sewerage-service use
      // for intermediate, non-terminal transitions.
      if (application) {
        // recipientId is the application's own id (the stable per-citizen
        // -journey inbox key this schema-less-of-a-citizen-field service
        // uses throughout — see applications/consumer.ts's submitApplication
        // for the full reasoning), not inspectorId/createdBy.
        await emitMunicipalNotification(tx, ctxOf(msg), {
          eventType: MUNICIPAL_EVENT_TYPES.statusChanged,
          recipient: application.buildingName,
          recipientId: p.applicationId,
          variables: { inspectionId: p.id, applicationId: p.applicationId, status: "inspection_scheduled", scheduledDate: p.scheduledDate },
        });
      }
      await writeAudit(tx, ctxOf(msg), { action: "inspection.schedule", resourceType: "fire_inspection", resourceId: p.id });
    });
    log.info({ id: p.id, applicationId: p.applicationId }, "fire inspection scheduled");
  });

  queue.subscribe(COMMANDS.completeInspection, async (msg) => {
    const p = msg.payload as { inspectionId: string; recommendation: string; deficiencies?: unknown[] };
    // Recipient-lookup reads BEFORE opening the write transaction (same
    // deadlock-class reasoning as scheduleInspection above). This command's
    // payload carries no applicationId, so the inspection row must be read
    // first to get it, then the application row for buildingName/createdBy.
    const existingInspection = await repo.findById(msg.tenantId, p.inspectionId);
    const application = existingInspection
      ? await appRepo.findById(msg.tenantId, existingInspection.applicationId)
      : null;
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
      // Citizen-meaningful transition: the inspection outcome (approve/
      // reject/re_inspect) directly determines whether the applicant can
      // move on to NOC issuance — they need to know it happened and what
      // was recommended.
      if (application) {
        await emitMunicipalNotification(tx, ctxOf(msg), {
          eventType: MUNICIPAL_EVENT_TYPES.statusChanged,
          recipient: application.buildingName,
          recipientId: existingInspection!.applicationId,
          variables: {
            inspectionId: p.inspectionId,
            applicationId: existingInspection!.applicationId,
            status: "inspection_completed",
            recommendation: p.recommendation,
          },
        });
      }
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
      // Internal evidence-gathering step, not a status change itself
      // (recordFindings deliberately never flips status — see the CRITICAL
      // fix comment above) — deliberately not notified, mirroring
      // sewerage-service's field_record.create precedent for the same
      // reasoning class.
      await writeAudit(tx, ctxOf(msg), { action: "inspection.record_findings", resourceType: "fire_inspection", resourceId: p.inspectionId });
    });
    if (applied) await cache.invalidate(cache.makeKey(msg.tenantId, "inspection", p.inspectionId));
  });
}
