import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CreateRcBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createRateContract(ctx: RequestContext, body: CreateRcBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.rcCreate, {
    messageId: id, type: COMMANDS.rcCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
