import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CreateStoreBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createStore(ctx: RequestContext, body: CreateStoreBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.storeCreate, {
    messageId: id, type: COMMANDS.storeCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
