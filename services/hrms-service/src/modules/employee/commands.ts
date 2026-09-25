import { randomUUID } from "node:crypto";
import { putObject, StorageNotConfiguredError } from "@civitasone/storage";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { HttpError } from "../../shared/context.js";
import { isMaskedValue } from "../../shared/pii-mask.js";
import type { CreateEmployeeBody, ConfirmEmployeeBody, UpdateEmployeeBody } from "./validators.js";
import type { TransferBody, SeparateBody, PromotionBody } from "../lifecycle/validators.js";
import { db, scopedRead } from "../../shared/db.js";
import { hrmsEmployees } from "./schema.js";
import { idempotentId } from "@civitasone/auth";

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
      // Previously validated by createEmployeeBody + present as real columns on
      // hrmsEmployees, but never mapped into this insert -- silently discarded on
      // every create (HR-A deep-verify finding). See employee/schema.ts for columns.
      pan:            body.pan ?? null,
      aadhaarRef:     body.aadhaarRef ?? null,
      bankAccountNo:  body.bankAccountNo ?? null,
      bankIfsc:       body.bankIfsc ?? null,
      esicIpNumber:   body.esicIpNumber ?? null,
      uanNumber:      body.uanNumber ?? null,
      pran:           body.pran ?? null,
      gstin:          body.gstin ?? null,
      sacCode:        body.sacCode ?? null,
      agencyRef:      body.agencyRef ?? null,
      napsId:         body.napsId ?? null,
      managerId:      body.managerId ?? null,
      station:        body.station ?? null,
      category:       body.category ?? null,
      disability:     body.disability ?? false,
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

/**
 * MEDIUM finding: this used to publish via bare queue.publish() with no
 * explicit messageId -- exactly the same "queue auto-mints a fresh random
 * one per call" gap separateEmployee below had (see its own doc comment)
 * before PR #1539, except this one was never fixed. A retried or
 * double-clicked Transfer for the SAME employee produced a second,
 * unrelated messageId that sailed straight past markProcessed's dedup, so
 * the consumer (employee/consumer.ts) re-ran the whole transfer a second
 * time and republished EVENTS.employeeTransferred -- consumed downstream
 * for posting/allowance changes (see topics.ts) -- twice, for one HR
 * action. Transfer is one of the Recruitment -> HRMS -> Payroll
 * integration-seam publishes this fix scopes to (hire/transfer/separation/
 * salary-revision), so it's keyed via idempotentId() (@civitasone/auth,
 * tenant-scoped since PR #1565) -- same mechanism as hireApplication and
 * separateEmployee.
 *
 * Keyed on employeeId + effectiveDate, NOT employeeId alone, mirroring
 * separateEmployee's own precedent immediately below: a transfer is not a
 * one-time-use action (an employee can legitimately be transferred many
 * times over a career), so keying on employeeId alone would make a second,
 * genuine later transfer collide with -- and be silently dropped by -- the
 * dedup guard for an earlier one. Two really-retried requests for the SAME
 * transfer always carry the same effectiveDate.
 */
export async function transferEmployee(ctx: RequestContext, id: string, body: TransferBody): Promise<Accepted> {
  // Prefers a genuine client-supplied key (ctx.idempotencyKey, from the
  // x-idempotency-key header) when sent; falls back to this deterministic
  // domain key otherwise -- see hireApplication's identical comment.
  const messageId = idempotentId({ idempotencyKey: ctx.idempotencyKey ?? `employee.transfer:${id}:${body.effectiveDate}`, tenantId: ctx.tenantId });
  await queue.publish(COMMANDS.employeeTransfer, {
    messageId, type: COMMANDS.employeeTransfer,
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

/**
 * HIGH fix: this used to publish via bare queue.publish() with no explicit
 * messageId -- the queue auto-mints a fresh random one per call, so a
 * retried or double-clicked Separate action for the SAME employee produced
 * a SECOND, unrelated messageId that sailed straight past the queue's own
 * idempotency dedup (markProcessed). The consumer (employee/consumer.ts)
 * then re-ran the whole separation transaction a second time, republishing
 * EVENTS.employeeSeparated -- which payroll-service's integration/consumer.ts
 * reacts to by publishing payroll.fnf.compute, so a duplicate separation
 * command risked a duplicate Full & Final settlement for one exit.
 *
 * Fix mirrors the now-merged pattern in recruitment/commands.ts's
 * hireApplication() (PR #1542): derive a STABLE messageId instead of a
 * fresh randomUUID() per call. MEDIUM finding follow-up: that derivation
 * used the ad hoc uuidV5() helper directly; separation is one of the
 * Recruitment -> HRMS -> Payroll integration-seam publishes this fix scopes
 * to, so it's now derived through idempotentId() (@civitasone/auth,
 * tenant-scoped since PR #1565) instead -- same determinism guarantee, via
 * the shared mechanism the rest of the codebase's cross-service commands
 * already use.
 *
 * Deliberately keyed on employeeId + effectiveDate, NOT employeeId alone --
 * unlike hireApplication's applicationId (which can only ever be hired
 * once), an employeeId is NOT a one-time-use key here: lifecycle/consumer.ts's
 * COMMANDS.lifecycleReinstate lets a terminated/separated/retired employee
 * return to active service, after which they can legitimately be separated
 * again, with a different (later) effectiveDate. Keying on employeeId alone
 * would make that second, genuine separation collide with -- and be
 * silently dropped by -- the dedup guard for the first. Two really-retried
 * requests for the SAME separation always carry the same effectiveDate, so
 * this still dedupes the actual bug (double-click / redelivery) without
 * that false-collision risk.
 *
 * Defense in depth against the same duplicate-settlement outcome via a
 * DIFFERENT path (e.g. payroll-service's own POST /v1/payroll/fnf/compute
 * called twice) is a unique constraint on payroll.fnf_settlements(tenant_id,
 * employee_id) -- see payroll-service/migrations/0044_fnf_settlements_unique.sql
 * and fnf/consumer.ts's onConflictDoNothing.
 */
export async function separateEmployee(ctx: RequestContext, id: string, body: SeparateBody): Promise<Accepted> {
  const messageId = idempotentId({ idempotencyKey: ctx.idempotencyKey ?? `employee.separate:${id}:${body.effectiveDate}`, tenantId: ctx.tenantId });
  await queue.publish(COMMANDS.employeeSeparate, {
    messageId, type: COMMANDS.employeeSeparate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { ...body, employeeId: id, tenantId: ctx.tenantId },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "employee", id));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function updateEmployee(ctx: RequestContext, id: string, body: UpdateEmployeeBody): Promise<Accepted> {
  // Data-corruption guard (defense in depth): bankAccountNo/bankIfsc are
  // masked on read (pii-mask.ts maskValue, e.g. "*******1234"), and this
  // command is the single choke point every caller of
  // PATCH /v1/hrms/employees/:id goes through. A caller that echoes an
  // unmodified masked value back here -- e.g. the EditEmployeeForm.tsx bug
  // fixed alongside this guard, or any future/other caller with the same
  // mistake -- must never have that placeholder persisted over the real
  // stored value. Reject synchronously, before the update is even queued, so
  // the caller gets an immediate error instead of a silent no-op overwrite.
  if (isMaskedValue(body.bankAccountNo) || isMaskedValue(body.bankIfsc)) {
    throw new HttpError(
      400,
      "MASKED_VALUE_REJECTED",
      "bankAccountNo/bankIfsc looks like a masked placeholder, not a real value -- refusing to persist it.",
    );
  }

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
