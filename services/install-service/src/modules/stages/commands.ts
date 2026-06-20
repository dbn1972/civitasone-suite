import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS, RESOURCE } from "../../topics.js";
import type { CreateStageBody } from "./validators.js";
import type { StageView } from "./schema.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createStage(ctx: RequestContext, body: CreateStageBody): Promise<Accepted> {
  const id = randomUUID();
  const projected: StageView = {
    id,
    tenantId: ctx.tenantId,
    name: body.name,
    stepNumber: body.stepNumber,
    description: body.description ?? null,
    status: "active",
    version: 1,
  };

  await cache.put(cache.makeKey(ctx.tenantId, RESOURCE, id), projected);
  await queue.publish(COMMANDS.createStage, {
    messageId: id,
    type: COMMANDS.createStage,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: projected,
  });

  return { id, status: "accepted", correlationId: ctx.correlationId };
}
