import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import type {
  AssignCategoryBody, RecordDisposalBody, ProposeWeedoutBody,
  RejectWeedoutBody, DestroyWeedoutBody,
  TransferToRecordRoomBody, RequisitionRecordBody, ReturnRecordBody,
} from "./validators.js";

/**
 * Local command topic constants for the records module (deliberately NOT added
 * to the shared topics.ts — this is a self-contained, additively-introduced
 * module per the compliance-remediation brief).
 */
export const COMMANDS = {
  assignCategory:  "estab.record.assign_category",
  recordDisposal:  "estab.record.record_disposal",
  weedoutPropose:  "estab.weedout.propose",
  weedoutApprove:  "estab.weedout.approve",
  weedoutReject:   "estab.weedout.reject",
  weedoutDestroy:  "estab.weedout.destroy",
  // R4 record-room
  transferToRecordRoom: "estab.record.transfer_to_record_room",
  requisitionRecord:    "estab.record.requisition",
  returnRecord:         "estab.record.return",
} as const;

export type Accepted = { id: string; status: string; correlationId: string };

export async function assignCategory(ctx: RequestContext, fileId: string, body: AssignCategoryBody): Promise<Accepted> {
  await queue.publish(COMMANDS.assignCategory, {
    type: COMMANDS.assignCategory,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { fileId, tenantId: ctx.tenantId, category: body.category, disposalAction: body.disposalAction },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "file_record", fileId));
  return { id: fileId, status: "accepted", correlationId: ctx.correlationId };
}

export async function recordDisposal(ctx: RequestContext, fileId: string, body: RecordDisposalBody): Promise<Accepted> {
  await queue.publish(COMMANDS.recordDisposal, {
    type: COMMANDS.recordDisposal,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { fileId, tenantId: ctx.tenantId, disposalAction: body.disposalAction },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "file_record", fileId));
  return { id: fileId, status: "accepted", correlationId: ctx.correlationId };
}

export async function proposeWeedout(ctx: RequestContext, body: ProposeWeedoutBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.weedoutPropose, {
    messageId: id, type: COMMANDS.weedoutPropose,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, fileId: body.fileId, tenantId: ctx.tenantId, reason: body.reason },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function approveWeedout(ctx: RequestContext, weedoutId: string): Promise<Accepted> {
  await queue.publish(COMMANDS.weedoutApprove, {
    type: COMMANDS.weedoutApprove,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id: weedoutId, tenantId: ctx.tenantId },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "weedout", weedoutId));
  return { id: weedoutId, status: "accepted", correlationId: ctx.correlationId };
}

export async function rejectWeedout(ctx: RequestContext, weedoutId: string, body: RejectWeedoutBody): Promise<Accepted> {
  await queue.publish(COMMANDS.weedoutReject, {
    type: COMMANDS.weedoutReject,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id: weedoutId, tenantId: ctx.tenantId, reason: body.reason },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "weedout", weedoutId));
  return { id: weedoutId, status: "accepted", correlationId: ctx.correlationId };
}

export async function destroyWeedout(ctx: RequestContext, weedoutId: string, body: DestroyWeedoutBody): Promise<Accepted> {
  await queue.publish(COMMANDS.weedoutDestroy, {
    type: COMMANDS.weedoutDestroy,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id: weedoutId, tenantId: ctx.tenantId, destructionCertRef: body.destructionCertRef },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "weedout", weedoutId));
  return { id: weedoutId, status: "accepted", correlationId: ctx.correlationId };
}


// ── R4 record-room ────────────────────────────────────────────────────────

export async function transferToRecordRoom(ctx: RequestContext, fileId: string, body: TransferToRecordRoomBody): Promise<Accepted> {
  await queue.publish(COMMANDS.transferToRecordRoom, {
    type: COMMANDS.transferToRecordRoom,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { fileId, tenantId: ctx.tenantId, ...body },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "file_record", fileId));
  return { id: fileId, status: "accepted", correlationId: ctx.correlationId };
}

export async function requisitionRecord(ctx: RequestContext, body: RequisitionRecordBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.requisitionRecord, {
    messageId: id, type: COMMANDS.requisitionRecord,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, fileId: body.fileId, purpose: body.purpose ?? null, dueBack: body.dueBack ?? null },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function returnRecord(ctx: RequestContext, body: ReturnRecordBody): Promise<Accepted> {
  await queue.publish(COMMANDS.returnRecord, {
    type: COMMANDS.returnRecord,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { requisitionId: body.requisitionId, tenantId: ctx.tenantId },
  });
  return { id: body.requisitionId, status: "accepted", correlationId: ctx.correlationId };
}
