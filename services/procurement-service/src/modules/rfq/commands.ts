import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CreateRfqBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

/** Queue-first RFQ issuance — mirrors indent/commands.ts createIndent(). */
export async function createRfq(ctx: RequestContext, body: CreateRfqBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.rfqCreate, {
    messageId: id, type: COMMANDS.rfqCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

/** Queue-first vendor response to an RFQ. */
export async function respondToRfq(ctx: RequestContext, rfqId: string, body: import("./validators.js").RfqRespondBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.rfqRespond, {
    messageId: id, type: COMMANDS.rfqRespond,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, rfqId, vendorId: ctx.actorId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
