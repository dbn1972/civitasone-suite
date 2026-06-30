import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import type { SetSignConfigBody, SignBody } from "./validators.js";

export const COMMANDS = {
  esignConfigSet: "estab.esign.config_set",
  esignSign:      "estab.esign.sign",
} as const;

export type Accepted = { id: string; status: string; correlationId: string };

export async function setSignConfig(ctx: RequestContext, body: SetSignConfigBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.esignConfigSet, {
    messageId: id, type: COMMANDS.esignConfigSet,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { tenantId: ctx.tenantId, ...body },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "esign_config", "_"));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function sign(ctx: RequestContext, body: SignBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.esignSign, {
    messageId: id, type: COMMANDS.esignSign,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, signerId: ctx.actorId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
