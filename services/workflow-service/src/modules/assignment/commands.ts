import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
export type Accepted = { id: string; status: string; correlationId: string };
async function publish(ctx: RequestContext, type: string, payload: Record<string, unknown>): Promise<Accepted> {
  const id = (payload.id as string | undefined) ?? randomUUID();
  await queue.publish(type, { messageId: randomUUID(), type, tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0", payload: { ...payload, id, tenantId: ctx.tenantId } });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
export const createMatrixRule = (ctx: RequestContext, body: Record<string, unknown>) => publish(ctx, COMMANDS.createMatrixRule, body);
export const deactivateMatrixRule = (ctx: RequestContext, id: string) => publish(ctx, COMMANDS.deactivateMatrixRule, { id });
export const createSubstitution = (ctx: RequestContext, body: Record<string, unknown>) => publish(ctx, COMMANDS.createSubstitution, body);
export const deactivateSubstitution = (ctx: RequestContext, id: string) => publish(ctx, COMMANDS.deactivateSubstitution, { id });
