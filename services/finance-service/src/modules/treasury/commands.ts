import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CreateChallanBody, CreateDepositBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createChallan(ctx: RequestContext, body: CreateChallanBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.challanCreate, {
    messageId: id, type: COMMANDS.challanCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function createDeposit(ctx: RequestContext, body: CreateDepositBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.depositCreate, {
    messageId: id, type: COMMANDS.depositCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
