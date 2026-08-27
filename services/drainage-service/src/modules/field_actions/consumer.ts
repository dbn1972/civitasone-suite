import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import * as complaintsRepo from "../complaints/repo.js";
import { FIELD_ACTION_ELIGIBLE_COMPLAINT_STATUSES } from "./domain.js";

const log = pino({ name: "drainage.field_actions.consumer" });

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

export function registerFieldActionConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.fieldActionCreate, async (msg) => {
    const p = msg.payload as any;
    let applied = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // Defensive backstop mirroring the route-level check in routes.ts (which
      // can go stale between the HTTP read and this message being processed).
      const complaint = await complaintsRepo.findByIdTx(tx, p.complaintId, msg.tenantId);
      if (!complaint) {
        log.warn({ complaintId: p.complaintId }, "field action references missing complaint, skipping");
        return;
      }
      if (!FIELD_ACTION_ELIGIBLE_COMPLAINT_STATUSES.includes(complaint.status)) {
        log.warn({ complaintId: p.complaintId, status: complaint.status }, "complaint no longer actionable, skipping field action");
        return;
      }
      // Field work starting is what actually makes a complaint "in_progress".
      // Not checking the CAS result: a lost race here just means another
      // concurrent field action already made this same transition, which is
      // the desired end state either way — the field action log entry below
      // is still valid to record regardless of who won that race.
      if (complaint.status === "assigned") {
        await complaintsRepo.update(tx, p.complaintId, msg.tenantId, { status: "in_progress", updatedBy: msg.actorId }, complaint.version);
      }
      await repo.insert(tx, {
        id: p.id, tenantId: msg.tenantId, complaintId: p.complaintId,
        actionType: p.actionType, performedBy: p.performedBy,
        drainAssetRef: p.drainAssetRef, notes: p.notes,
        beforePhoto: p.beforePhoto, afterPhoto: p.afterPhoto,
        durationMinutes: p.durationMinutes,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      applied = true;
      await enqueue(tx, {
        topic: EVENTS.fieldActionCreated, eventType: EVENTS.fieldActionCreated,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { fieldActionId: p.id, complaintId: p.complaintId, actionType: p.actionType },
      });
      await writeAudit(tx, ctxOf(msg), { action: "field_action.create", resourceType: "drainage_field_action", resourceId: p.id });
    });
    // `applied` also fixes a pre-existing (pre-this-fix) sibling-inconsistency:
    // this handler used to log "field action created" unconditionally, unlike
    // complaintAssign/Resolve/Close in the neighboring consumer, which all
    // already gate their success log behind an `applied` flag.
    if (applied) log.info({ id: p.id }, "field action created");
  });
}
