import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

export const enableMfaBody = z.object({
  method: z.enum(["totp", "sms", "email"]).default("totp"),
});
export type EnableMfaBody = z.infer<typeof enableMfaBody>;

export type Accepted = { id: string; status: string; correlationId: string };

export async function enableMfa(ctx: RequestContext, userId: string, body: EnableMfaBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.enableMfa, {
    messageId: id, type: COMMANDS.enableMfa, tenantId: ctx.tenantId, actorId: ctx.actorId,
    correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, userId, method: body.method, tenantId: ctx.tenantId },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
