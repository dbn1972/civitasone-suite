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

export async function createPtVersion(ctx: RequestContext, body: CreatePtVersionBody): Promise<Accepted> {
  const messageId = randomUUID();
  await queue.publish(COMMANDS.ptVersionCreate, {
    messageId, type: COMMANDS.ptVersionCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { tenantId: ctx.tenantId, ...body },
  });
  return { id: `${body.stateCode}:${body.effectiveFrom}`, status: "accepted", correlationId: ctx.correlationId };
}
