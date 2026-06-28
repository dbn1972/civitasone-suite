import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { EnrolOperatorBody, UpdateOperatorBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function enrolOperator(ctx: RequestContext, body: EnrolOperatorBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.operatorEnrol, {
    messageId: id, type: COMMANDS.operatorEnrol,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId,
    schemaVersion: "1.0", payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function updateOperator(ctx: RequestContext, id: string, body: UpdateOperatorBody): Promise<Accepted> {
  await queue.publish(COMMANDS.operatorUpdate, {
    messageId: randomUUID(), type: COMMANDS.operatorUpdate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId,
    schemaVersion: "1.0", payload: { id, tenantId: ctx.tenantId, patch: body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
