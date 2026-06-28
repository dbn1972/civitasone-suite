import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CreateEmployeeBody, ConfirmEmployeeBody, UpdateEmployeeBody } from "./validators.js";
import type { TransferBody, SeparateBody, PromotionBody } from "../lifecycle/validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createEmployee(ctx: RequestContext, body: CreateEmployeeBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.employeeCreate, {
    messageId: id, type: COMMANDS.employeeCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  await cache.put(cache.makeKey(ctx.tenantId, "employee", id), { id, ...body, status: "probation" });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function confirmEmployee(ctx: RequestContext, id: string, body: ConfirmEmployeeBody): Promise<Accepted> {
  await queue.publish(COMMANDS.employeeConfirm, {
    type: COMMANDS.employeeConfirm,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { ...body, id, tenantId: ctx.tenantId },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "employee", id));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function transferEmployee(ctx: RequestContext, id: string, body: TransferBody): Promise<Accepted> {
  await queue.publish(COMMANDS.employeeTransfer, {
    type: COMMANDS.employeeTransfer,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { ...body, employeeId: id, tenantId: ctx.tenantId },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "employee", id));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

/**
 * Submit an employee transfer to eOffice for administrative approval. Instead
 * of mutating the employee master directly (as `transferEmployee` does), this
 * records a transfer request in `pending_approval` state and returns its id.
 * The eFile is raised against that id (source_ref_type "hr_transfer"); the
 * decision returns on `hrms.transfer.file_decided` and the eoffice-consumer
 * either executes the posting (approved) or cancels the request (rejected).
 */
export async function submitTransferForApproval(ctx: RequestContext, id: string, body: TransferBody): Promise<Accepted> {
  const transferId = randomUUID();
  await queue.publish(COMMANDS.employeeTransferSubmitApproval, {
    messageId: transferId, type: COMMANDS.employeeTransferSubmitApproval,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { ...body, id: transferId, employeeId: id, tenantId: ctx.tenantId },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "transfer", transferId));
  return { id: transferId, status: "accepted", correlationId: ctx.correlationId };
}

/**
 * Submit an employee promotion to eOffice for administrative approval. Mirrors
 * `submitTransferForApproval`: rather than mutating the employee master, it
 * records a promotion request in `pending_approval` state and returns its id.
 * The eFile is raised against that id (source_ref_type "hr_promotion"); the
 * decision returns on `hrms.promotion.file_decided` and the eoffice-consumer
 * either effects the promotion (approved → new designation/pay) or cancels the
 * request (rejected).
 */
export async function submitPromotionForApproval(ctx: RequestContext, id: string, body: PromotionBody): Promise<Accepted> {
  const promotionId = randomUUID();
  await queue.publish(COMMANDS.employeePromotionSubmitApproval, {
    messageId: promotionId, type: COMMANDS.employeePromotionSubmitApproval,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { ...body, id: promotionId, employeeId: id, tenantId: ctx.tenantId },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "promotion", promotionId));
  return { id: promotionId, status: "accepted", correlationId: ctx.correlationId };
}

export async function separateEmployee(ctx: RequestContext, id: string, body: SeparateBody): Promise<Accepted> {
  await queue.publish(COMMANDS.employeeSeparate, {
    type: COMMANDS.employeeSeparate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { ...body, employeeId: id, tenantId: ctx.tenantId },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "employee", id));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function updateEmployee(ctx: RequestContext, id: string, body: UpdateEmployeeBody): Promise<Accepted> {
  const messageId = randomUUID();
  await queue.publish(COMMANDS.employeeUpdate, {
    messageId, type: COMMANDS.employeeUpdate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: {
      id, tenantId: ctx.tenantId,
      mobile: body.mobile,
      email: body.email,
      bankAccountNo: body.bankAccountNo,
      bankIfsc: body.bankIfsc,
      basicMinor: body.basicMinor !== undefined ? body.basicMinor.toString() : undefined,
      payStructureId: body.payStructureId,
      managerId: body.managerId,
    },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "employee", id));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
