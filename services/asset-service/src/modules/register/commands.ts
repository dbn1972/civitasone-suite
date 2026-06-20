import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CreateAssetBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createAsset(ctx: RequestContext, body: CreateAssetBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.assetCreate, {
    messageId: id, type: COMMANDS.assetCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
