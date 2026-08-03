/** Auto-generated F3 apply (change). */
import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError, TENANT_ADMIN_ROLES } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import type { ChangeRequestRow } from "./schema.js";
import {
  ChangeError,
  assertTransition,
  assertApproverDistinct,
  assertRollbackPlan,
  assertValidWindow,
  assertNoFreezeConflict,
  statusForPir,
  type ChangeStatus,
  type FreezeWindow,
} from "./domain.js";
import {
  idParam,
  listQuery,
  createChangeBody,
  rollbackPlanBody,
  approveBody,
  rejectBody,
  scheduleBody,
  completeBody,
  createFreezeBody,
} from "./validators.js";


const AUDIT_TOPIC = "audit.event.record";
// Cross-service release-notes / user-communication broadcast (→ notification-service).
const BROADCAST_TOPIC = "notification.broadcast.send";

// Change/release management is a platform + tenant admin governed process.
const CHANGE_ROLES = [...TENANT_ADMIN_ROLES];

// The scoped transaction handed to db.transaction(async (tx) => …); it satisfies
// both repo.Writer and the outbox enqueue() DrizzleTx contract.
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Persist a state transition to the immutable change_audit trail AND enqueue a
 * cross-service audit event, inside the same transaction as the state change.
 */
async function recordTransition(
  tx: Tx,
  args: {
    tenantId: string; changeId: string; from: ChangeStatus | null; to: ChangeStatus;
    actorId: string; correlationId: string; note?: string | undefined; action: string;
  },
): Promise<void> {
  await repo.insertAudit(tx, {
    tenantId: args.tenantId,
    changeId: args.changeId,
    fromStatus: args.from,
    toStatus: args.to,
    actorId: args.actorId,
    note: args.note ?? null,
    correlationId: args.correlationId,
  });
  await enqueue(tx, {
    topic: AUDIT_TOPIC,
    eventType: AUDIT_TOPIC,
    tenantId: args.tenantId,
    actorId: args.actorId,
    correlationId: args.correlationId,
    payload: {
      service: "admin",
      action: args.action,
      resourceType: "change_request",
      resourceId: args.changeId,
      outcome: "success",
    },
  });
}

function serialize(row: ChangeRequestRow): Record<string, unknown> {
  return {
    id: row.id,
    title: row.title,
    type: row.type,
    risk: row.risk,
    affectedServices: row.affectedServices,
    description: row.description,
    rollbackPlan: row.rollbackPlan,
    status: row.status,
    requestedBy: row.requestedBy,
    approvedBy: row.approvedBy,
    approvedAt: row.approvedAt?.toISOString() ?? null,
    rejectedReason: row.rejectedReason,
    windowStart: row.windowStart?.toISOString() ?? null,
    windowEnd: row.windowEnd?.toISOString() ?? null,
    releaseNotes: row.releaseNotes,
    pirOutcome: row.pirOutcome,
    pirNotes: row.pirNotes,
    pirAt: row.pirAt?.toISOString() ?? null,
    createdAt: row.createdAt?.toISOString?.() ?? String(row.createdAt),
    updatedAt: row.updatedAt?.toISOString?.() ?? String(row.updatedAt),
    version: row.version,
  };
}

export async function apply_change_0(ctx: any, req: { body: unknown; params: unknown; query: unknown }): Promise<void> {
  // post:"/v1/admin/change/requests"
    const body = createChangeBody.parse(req.body);
    const id = randomUUID();
    await db.transaction(async (tx) => {
      await repo.insertRequest(tx, {
        id,
        tenantId: ctx.tenantId,
        title: body.title,
        type: body.type,
        risk: body.risk,
        affectedServices: body.affectedServices,
        description: body.description,
        rollbackPlan: body.rollbackPlan ?? null,
        status: "draft",
        requestedBy: ctx.actorId,
        createdBy: ctx.actorId,
        updatedBy: ctx.actorId,
      });
      await recordTransition(tx, {
        tenantId: ctx.tenantId, changeId: id, from: null, to: "draft",
        actorId: ctx.actorId, correlationId: ctx.correlationId, action: "change_create",
      });
    });
    return;
  
}

export async function apply_change_1(ctx: any, req: { body: unknown; params: unknown; query: unknown }): Promise<void> {
  // post:"/v1/admin/change/requests/:id/rollback-plan"
    const { id } = idParam.parse(req.params);
    const body = rollbackPlanBody.parse(req.body);
    await db.transaction(async (tx) => {
      const cur = await repo.findRequestByIdTx(tx, id, ctx.tenantId);
      if (!cur) throw new HttpError(404, "NOT_FOUND", "change request not found");
      await repo.updateRequest(tx, id, ctx.tenantId, {
        rollbackPlan: body.rollbackPlan, updatedBy: ctx.actorId, version: cur.version + 1,
      });
    });
    return;
  
}

export async function apply_change_2(ctx: any, req: { body: unknown; params: unknown; query: unknown }): Promise<void> {
  // post:"/v1/admin/change/requests/:id/submit"
    const { id } = idParam.parse(req.params);
    await db.transaction(async (tx) => {
      const cur = await repo.findRequestByIdTx(tx, id, ctx.tenantId);
      if (!cur) throw new HttpError(404, "NOT_FOUND", "change request not found");
      assertTransition(cur.status as ChangeStatus, "submitted");
      await repo.updateRequest(tx, id, ctx.tenantId, {
        status: "submitted", updatedBy: ctx.actorId, version: cur.version + 1,
      });
      await recordTransition(tx, {
        tenantId: ctx.tenantId, changeId: id, from: cur.status as ChangeStatus, to: "submitted",
        actorId: ctx.actorId, correlationId: ctx.correlationId, action: "change_submit",
      });
    });
    return;
  
}

export async function apply_change_3(ctx: any, req: { body: unknown; params: unknown; query: unknown }): Promise<void> {
  // post:"/v1/admin/change/requests/:id/approve"
    const { id } = idParam.parse(req.params);
    const body = approveBody.parse(req.body ?? {});
    await db.transaction(async (tx) => {
      const cur = await repo.findRequestByIdTx(tx, id, ctx.tenantId);
      if (!cur) throw new HttpError(404, "NOT_FOUND", "change request not found");
      assertTransition(cur.status as ChangeStatus, "approved");
      // Maker-checker: approver must differ from requester.
      assertApproverDistinct(cur.requestedBy, ctx.actorId);
      // A rollback plan must exist before approval.
      assertRollbackPlan(cur.rollbackPlan);
      await repo.updateRequest(tx, id, ctx.tenantId, {
        status: "approved", approvedBy: ctx.actorId, approvedAt: new Date(),
        updatedBy: ctx.actorId, version: cur.version + 1,
      });
      await recordTransition(tx, {
        tenantId: ctx.tenantId, changeId: id, from: cur.status as ChangeStatus, to: "approved",
        actorId: ctx.actorId, correlationId: ctx.correlationId, note: body.note, action: "change_approve",
      });
      await enqueue(tx, {
        topic: EVENTS.changeApproved, eventType: EVENTS.changeApproved,
        tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId,
        payload: { changeId: id, approvedBy: ctx.actorId, type: cur.type, risk: cur.risk },
      });
    });
    return;
  
}

export async function apply_change_4(ctx: any, req: { body: unknown; params: unknown; query: unknown }): Promise<void> {
  // post:"/v1/admin/change/requests/:id/reject"
    const { id } = idParam.parse(req.params);
    const body = rejectBody.parse(req.body);
    await db.transaction(async (tx) => {
      const cur = await repo.findRequestByIdTx(tx, id, ctx.tenantId);
      if (!cur) throw new HttpError(404, "NOT_FOUND", "change request not found");
      assertTransition(cur.status as ChangeStatus, "rejected");
      assertApproverDistinct(cur.requestedBy, ctx.actorId);
      await repo.updateRequest(tx, id, ctx.tenantId, {
        status: "rejected", rejectedReason: body.reason, updatedBy: ctx.actorId, version: cur.version + 1,
      });
      await recordTransition(tx, {
        tenantId: ctx.tenantId, changeId: id, from: cur.status as ChangeStatus, to: "rejected",
        actorId: ctx.actorId, correlationId: ctx.correlationId, note: body.reason, action: "change_reject",
      });
    });
    return;
  
}

export async function apply_change_5(ctx: any, req: { body: unknown; params: unknown; query: unknown }): Promise<void> {
  // post:"/v1/admin/change/requests/:id/schedule"
    const { id } = idParam.parse(req.params);
    const body = scheduleBody.parse(req.body);
    const start = new Date(body.windowStart);
    const end = new Date(body.windowEnd);
    assertValidWindow(start, end);
    await db.transaction(async (tx) => {
      const cur = await repo.findRequestByIdTx(tx, id, ctx.tenantId);
      if (!cur) throw new HttpError(404, "NOT_FOUND", "change request not found");
      assertTransition(cur.status as ChangeStatus, "scheduled");
      // Freeze check: the window must not overlap any active change freeze.
      const freezes = await repo.listFreezesTx(tx, ctx.tenantId);
      const windows: FreezeWindow[] = freezes.map((f) => ({
        id: f.id, name: f.name, startsAt: f.startsAt, endsAt: f.endsAt,
      }));
      assertNoFreezeConflict(start, end, windows);
      await repo.updateRequest(tx, id, ctx.tenantId, {
        status: "scheduled", windowStart: start, windowEnd: end,
        updatedBy: ctx.actorId, version: cur.version + 1,
      });
      await recordTransition(tx, {
        tenantId: ctx.tenantId, changeId: id, from: cur.status as ChangeStatus, to: "scheduled",
        actorId: ctx.actorId, correlationId: ctx.correlationId, action: "change_schedule",
      });
      await enqueue(tx, {
        topic: EVENTS.changeScheduled, eventType: EVENTS.changeScheduled,
        tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId,
        payload: { changeId: id, windowStart: start.toISOString(), windowEnd: end.toISOString() },
      });
    });
    return;
  
}

export async function apply_change_6(ctx: any, req: { body: unknown; params: unknown; query: unknown }): Promise<void> {
  // post:"/v1/admin/change/requests/:id/start"
    const { id } = idParam.parse(req.params);
    await db.transaction(async (tx) => {
      const cur = await repo.findRequestByIdTx(tx, id, ctx.tenantId);
      if (!cur) throw new HttpError(404, "NOT_FOUND", "change request not found");
      assertTransition(cur.status as ChangeStatus, "in_progress");
      await repo.updateRequest(tx, id, ctx.tenantId, {
        status: "in_progress", updatedBy: ctx.actorId, version: cur.version + 1,
      });
      await recordTransition(tx, {
        tenantId: ctx.tenantId, changeId: id, from: cur.status as ChangeStatus, to: "in_progress",
        actorId: ctx.actorId, correlationId: ctx.correlationId, action: "change_start",
      });
    });
    return;
  
}

export async function apply_change_7(ctx: any, req: { body: unknown; params: unknown; query: unknown }): Promise<void> {
  // post:"/v1/admin/change/requests/:id/complete"
    const { id } = idParam.parse(req.params);
    const body = completeBody.parse(req.body);
    const target = statusForPir(body.outcome);
    await db.transaction(async (tx) => {
      const cur = await repo.findRequestByIdTx(tx, id, ctx.tenantId);
      if (!cur) throw new HttpError(404, "NOT_FOUND", "change request not found");
      assertTransition(cur.status as ChangeStatus, target);
      await repo.updateRequest(tx, id, ctx.tenantId, {
        status: target, pirOutcome: body.outcome, pirNotes: body.notes, pirAt: new Date(),
        releaseNotes: body.releaseNotes ?? cur.releaseNotes ?? null,
        updatedBy: ctx.actorId, version: cur.version + 1,
      });
      await recordTransition(tx, {
        tenantId: ctx.tenantId, changeId: id, from: cur.status as ChangeStatus, to: target,
        actorId: ctx.actorId, correlationId: ctx.correlationId, note: body.notes,
        action: body.outcome === "success" ? "change_complete" : "change_rollback",
      });
      await enqueue(tx, {
        topic: body.outcome === "success" ? EVENTS.changeCompleted : EVENTS.changeRolledBack,
        eventType: body.outcome === "success" ? EVENTS.changeCompleted : EVENTS.changeRolledBack,
        tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId,
        payload: { changeId: id, outcome: body.outcome },
      });
      // Release-notes / user-communication broadcast — only on a successful release
      // with notes to publish. Fanned out to notification-service via the outbox relay.
      const notes = body.releaseNotes ?? cur.releaseNotes;
      if (body.outcome === "success" && notes && notes.trim().length > 0) {
        await enqueue(tx, {
          topic: BROADCAST_TOPIC, eventType: BROADCAST_TOPIC,
          tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId,
          payload: {
            channel: "release_notes", changeId: id, title: cur.title,
            releaseNotes: notes, affectedServices: cur.affectedServices,
          },
        });
      }
    });
    return;
  
}

export async function apply_change_8(ctx: any, req: { body: unknown; params: unknown; query: unknown }): Promise<void> {
  // post:"/v1/admin/change/freezes"
    const body = createFreezeBody.parse(req.body);
    const start = new Date(body.startsAt);
    const end = new Date(body.endsAt);
    assertValidWindow(start, end);
    const id = randomUUID();
    await db.transaction(async (tx) => {
      await repo.insertFreeze(tx, {
        id, tenantId: ctx.tenantId, name: body.name, startsAt: start, endsAt: end,
        reason: body.reason, createdBy: ctx.actorId, updatedBy: ctx.actorId,
      });
    });
    return;
  
}

