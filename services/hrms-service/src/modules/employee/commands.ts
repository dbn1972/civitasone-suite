import { randomUUID } from "node:crypto";
import { putObject, StorageNotConfiguredError } from "@civitasone/storage";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CreateEmployeeBody, ConfirmEmployeeBody, UpdateEmployeeBody } from "./validators.js";
import type { TransferBody, SeparateBody, PromotionBody } from "../lifecycle/validators.js";
import { db, scopedRead } from "../../shared/db.js";
import { hrmsEmployees } from "./schema.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createEmployee(ctx: RequestContext, body: CreateEmployeeBody): Promise<Accepted> {
  let photoKey: string | null = null;
  if (body.photoDataUrl) {
    const m = body.photoDataUrl.match(/^data:(image\/[^;]+);base64,(.+)$/);
    if (m) {
      const mimeType = m[1] as string;
      const ext = (mimeType.split("/")[1] ?? "jpg").replace("jpeg", "jpg");
      const key = `${ctx.tenantId}/hrms/employees/${randomUUID()}/photo/${Date.now()}.${ext}`;
      try {
        await putObject(key, Buffer.from(m[2] as string, "base64"), mimeType);
        photoKey = key;
      } catch (err) {
        if (!(err instanceof StorageNotConfiguredError)) throw err;
      }
    }
  }

  const [row] = await scopedRead((tx) =>
    tx.insert(hrmsEmployees).values({
      tenantId:       ctx.tenantId,
      employeeNo:     body.employeeNo,
      fullName:       body.fullName,
      departmentId:   body.departmentId,
      designationId:  body.designationId,
      dateOfJoining:  body.dateOfJoining,
      dateOfBirth:    body.dateOfBirth ?? null,
      gender:         body.gender ?? null,
      mobile:         body.mobile ?? null,
      email:          body.email ?? null,
      photoKey,
      employeeType:   body.employeeType ?? "permanent",
      basicMinor:     BigInt(body.basicMinor ?? 0),
      currency:       body.currency ?? "INR",
      payStructureId: body.payStructureId ?? null,
      legalEntityId:  body.legalEntityId ?? null,
      costCenterId:   body.costCenterId ?? null,
      locationId:     body.locationId ?? null,
      createdBy:      ctx.actorId,
      updatedBy:      ctx.actorId,
    }).returning({ id: hrmsEmployees.id })
  );
  const id = row!.id;
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
      esicIpNumber: body.esicIpNumber,
      uanNumber: body.uanNumber,
      pran: body.pran,
      gstin: body.gstin,
      sacCode: body.sacCode,
      agencyRef: body.agencyRef,
      napsId: body.napsId,
    },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "employee", id));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
