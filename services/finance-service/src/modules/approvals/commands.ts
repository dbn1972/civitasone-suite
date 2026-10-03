import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { HttpError } from "../../shared/context.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";
import type { ChangeRequestKind } from "./domain.js";

export type Accepted = { id: string; status: string; correlationId: string };

/**
 * Raise a pending maker-checker request. The messageId is a fresh uuid: a
 * deterministic id would make a second request for the same subject (after the
 * first was rejected) look like a redelivery and be dropped silently.
 */
export async function submitChangeRequest(
  ctx: RequestContext, kind: ChangeRequestKind, subjectKey: string,
  payload: Record<string, unknown>, reason: string,
): Promise<Accepted> {
  if (await repo.findPendingBySubject(ctx.tenantId, kind, subjectKey)) {
    throw new HttpError(409, "CHANGE_REQUEST_PENDING", "a change for this item is already awaiting approval");
  }
  const id = randomUUID();
  await queue.publish(COMMANDS.changeRequestSubmit, {
    messageId: id, type: COMMANDS.changeRequestSubmit,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, kind, subjectKey, payload, reason },
  });
  return { id, status: "pending_approval", correlationId: ctx.correlationId };
}

export async function decideChangeRequest(
  ctx: RequestContext, requestId: string, decision: "approve" | "reject" | "cancel", note: string | null,
): Promise<Accepted> {
  const messageId = randomUUID();
  await queue.publish(COMMANDS.changeRequestDecide, {
    messageId, type: COMMANDS.changeRequestDecide,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { requestId, tenantId: ctx.tenantId, decision, note },
  });
  return { id: requestId, status: "accepted", correlationId: ctx.correlationId };
}
