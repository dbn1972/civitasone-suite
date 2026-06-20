import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { z } from "zod";
import type { createPlanBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };
type Body = z.infer<typeof createPlanBody>;

export async function createPlan(ctx: RequestContext, body: Body): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.planCreate, {
    messageId: id, type: COMMANDS.planCreate, tenantId: "00000000-0000-0000-0000-000000000000",
    actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, ...body },
  });
  await cache.invalidate("billing:platform:plans");
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
