import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "./infra.js";
import { COMMANDS } from "../topics.js";

export type Accepted = { id: string; status: string; correlationId: string };

/** Returns Accepted; typed loosely so leftover optimistic response shaping still typechecks. */
export async function publishF3Write(
  ctx: RequestContext,
  op: string,
  id: string,
  payload: Record<string, unknown>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  await queue.publish(COMMANDS.f3RouteWrite, {
    messageId: randomUUID(),
    type: COMMANDS.f3RouteWrite,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { op, id, tenantId: ctx.tenantId, ...payload },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
