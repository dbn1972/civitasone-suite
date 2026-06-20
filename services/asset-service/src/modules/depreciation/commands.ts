import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CreateDepScheduleBody, RunDepBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createDepSchedule(ctx: RequestContext, assetId: string, body: CreateDepScheduleBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.depSchedule, {
    messageId: id, type: COMMANDS.depSchedule,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, assetId, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function runDepreciation(ctx: RequestContext, body: RunDepBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.depRun, {
    messageId: id, type: COMMANDS.depRun,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, period: body.period },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
