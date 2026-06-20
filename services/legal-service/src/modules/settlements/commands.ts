import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CreateSettlementBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createSettlement(ctx: RequestContext, body: CreateSettlementBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.settlementCreate, {
    messageId: id, type: COMMANDS.settlementCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
