import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import { canAmendGrn, canInspectGrn, assertDistinctReceiverInspector, DomainError } from "./domain.js";
import type { CreateGrnBody, AmendGrnBody, AcceptGrnBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createGrn(ctx: RequestContext, body: CreateGrnBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.grnCreate, {
    messageId: id, type: COMMANDS.grnCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

/**
 * DOM-002 — separation of duties, checked synchronously at the route
 * boundary before anything is queued (mirrors po/amendment-commands.ts's
 * approveAmendment / assertDistinctMakerChecker pattern). The inspector is
 * `ctx.actorId` of THIS call — the accept/reject caller's own authenticated
 * identity — never a client-supplied field, and must differ from
 * `grn.createdBy` (the actor who made the earlier, independent CREATE call).
 * A same-actor attempt is rejected with 403 before it ever reaches the
 * queue. The consumer (see grn/consumer.ts) re-checks both the status and
 * the SoD rule again under the DB transaction lock for defense-in-depth,
 * since this route-level check and the consumer's write are not atomic.
 */
async function guardInspectable(ctx: RequestContext, id: string): Promise<void> {
  const grn = await repo.findGrnById(id);
  if (!grn || grn.tenantId !== ctx.tenantId) throw new HttpError(404, "NOT_FOUND", "GRN not found");
  try {
    if (!canInspectGrn(grn)) {
      throw new DomainError("GRN_NOT_INSPECTABLE", `GRN in status '${grn.status}' cannot be inspected`);
    }
    assertDistinctReceiverInspector(grn.createdBy, ctx.actorId);
  } catch (err) {
    if (err instanceof DomainError) {
      throw new HttpError(err.code === "SOD_VIOLATION" ? 403 : 409, err.code, err.message);
    }
    throw err;
  }
}

/**
 * DOM-002 — wires the real inspection "pass" path. `remarks` is the only
 * client-supplied field; the inspector identity is ctx.actorId, established
 * by this call's own auth, not by anything in the request body.
 */
export async function acceptGrn(ctx: RequestContext, id: string, body: AcceptGrnBody): Promise<Accepted> {
  await guardInspectable(ctx, id);
  const msgId = randomUUID();
  await queue.publish(COMMANDS.grnAccept, {
    messageId: msgId, type: COMMANDS.grnAccept,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, remarks: body.remarks },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "grn", id));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

/**
 * DOM-002 — wires the real inspection "fail" path. Same identity rule as
 * acceptGrn: the inspector is ctx.actorId, `reason` is the only
 * client-supplied field.
 */
export async function rejectGrn(ctx: RequestContext, id: string, reason: string): Promise<Accepted> {
  await guardInspectable(ctx, id);
  const msgId = randomUUID();
  await queue.publish(COMMANDS.grnReject, {
    messageId: msgId, type: COMMANDS.grnReject,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, reason },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "grn", id));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

/**
 * Req 1.2 — GRN partial-delivery amendment. The amendability guard runs
 * synchronously at the route boundary (not inside the consumer) so the
 * caller gets an immediate 409 GRN_NOT_AMENDABLE instead of a queued command
 * that silently no-ops. Mirrors the PO amendment route guard pattern.
 */
export async function amendGrn(ctx: RequestContext, id: string, body: AmendGrnBody): Promise<Accepted> {
  const grn = await repo.findGrnById(id);
  if (!grn || grn.tenantId !== ctx.tenantId) throw new HttpError(404, "NOT_FOUND", "GRN not found");
  if (!canAmendGrn(grn)) {
    throw new HttpError(409, "GRN_NOT_AMENDABLE", `GRN in status '${grn.status}' cannot be amended`);
  }
  const msgId = randomUUID();
  await queue.publish(COMMANDS.grnAmend, {
    messageId: msgId, type: COMMANDS.grnAmend,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, lines: body.lines },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "grn", id));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
