import { randomUUID } from "node:crypto";
import type { RequestContext, ReceiptPolicy } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function updateReceiptPolicy(
  ctx: RequestContext, body: { policy: ReceiptPolicy; reason: string | null },
): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.reimbursementReceiptPolicyUpdate, {
    messageId: id, type: COMMANDS.reimbursementReceiptPolicyUpdate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, policy: body.policy, reason: body.reason },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
