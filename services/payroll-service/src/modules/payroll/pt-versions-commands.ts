/**
 * GAP-PAYROLL-STATUTORY-PT-04: command publisher for a new PT slab version.
 * The route validates + runs read-only guards, then calls this and returns 202;
 * the write is the idempotent consumer in pt-versions-consumer.ts.
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CreatePtVersionBody } from "./pt-versions-domain.js";

export type Accepted = { id: string; status: string; correlationId: string };

function envelope(ctx: RequestContext, type: string, payload: Record<string, unknown>, messageId: string = randomUUID()) {
  return {
    messageId, type,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { tenantId: ctx.tenantId, ...payload },
  };
}

/** A DIFFERENT administrator approves / rejects a pending request (maker != checker, enforced in the consumer). */
export async function decidePtRequest(ctx: RequestContext, id: string, decision: "approved" | "rejected", note: string | null): Promise<Accepted> {
  await queue.publish(COMMANDS.ptVersionDecide, envelope(ctx, COMMANDS.ptVersionDecide, { id, decision, note }));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

/** Turn the second-approver switch on (immediate) or off (a pending request needing another approver). */
export async function setPtMakerChecker(ctx: RequestContext, enabled: boolean, reason: string | null): Promise<Accepted> {
  const messageId = randomUUID();
  await queue.publish(COMMANDS.ptCheckerSet, envelope(ctx, COMMANDS.ptCheckerSet, { enabled, reason }, messageId));
  return { id: messageId, status: "accepted", correlationId: ctx.correlationId };
}

export async function createPtVersion(ctx: RequestContext, body: CreatePtVersionBody): Promise<Accepted> {
  const messageId = randomUUID();
  await queue.publish(COMMANDS.ptVersionCreate, {
    messageId, type: COMMANDS.ptVersionCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { tenantId: ctx.tenantId, ...body },
  });
  // The id is the command's message id: GET .../pt/versions/requests/:id reports its outcome.
  return { id: messageId, status: "accepted", correlationId: ctx.correlationId };
}
