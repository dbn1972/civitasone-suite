import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";
import { HttpError } from "../../shared/context.js";
export type Accepted = { id: string; status: string; correlationId: string };
async function publish(ctx: RequestContext, type: string, payload: Record<string, unknown>): Promise<Accepted> {
  const id = (payload.id as string | undefined) ?? randomUUID();
  await queue.publish(type, { messageId: randomUUID(), type, tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0", payload: { ...payload, id, tenantId: ctx.tenantId } });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
export const createDecision = (ctx: RequestContext, body: Record<string, unknown>) => publish(ctx, COMMANDS.createDecision, body);
export async function deployDecision(ctx: RequestContext, id: string): Promise<Accepted> {
  const row = await repo.findById(id, ctx.tenantId);
  if (!row) throw new HttpError(404, "NOT_FOUND", "decision table not found");
  if (row.status === "active") throw new HttpError(409, "ALREADY_DEPLOYED", "decision table already deployed");
  return publish(ctx, COMMANDS.deployDecision, { id });
}
