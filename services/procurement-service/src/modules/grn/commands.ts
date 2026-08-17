import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import { canAmendGrn } from "./domain.js";
import type { CreateGrnBody } from "./validators.js";
import type { AmendGrnBody } from "./validators.js";

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

export async function acceptGrn(ctx: RequestContext, id: string): Promise<Accepted> {
  const msgId = randomUUID();
  await queue.publish(COMMANDS.grnAccept, {
    messageId: msgId, type: COMMANDS.grnAccept,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function rejectGrn(ctx: RequestContext, id: string, reason: string): Promise<Accepted> {
  const msgId = randomUUID();
  await queue.publish(COMMANDS.grnReject, {
    messageId: msgId, type: COMMANDS.grnReject,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, reason },
  });
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
