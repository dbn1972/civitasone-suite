import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

export type Accepted = { id: string; status: string; correlationId: string };

/**
 * GAP-PROJECTS-ESCALATIONS-02: enqueue an escalation action
 * (acknowledge | reassign | clear) against a project's escalation. The route
 * has already validated the action and that a reason/assignee is present where
 * required; the consumer re-checks the source status + optimistic version and
 * writes the audit event in the same transaction.
 */
export async function actOnEscalation(
  ctx: RequestContext,
  projectId: string,
  action: "acknowledge" | "reassign" | "clear",
  body: { reason?: string | undefined; escalatedTo?: string | undefined; severity?: string | undefined; issue?: string | undefined },
): Promise<Accepted> {
  await queue.publish(COMMANDS.escalationAct, {
    messageId: randomUUID(), type: COMMANDS.escalationAct,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: {
      projectId, tenantId: ctx.tenantId, action,
      reason: body.reason ?? null,
      escalatedTo: body.escalatedTo ?? null,
      severity: body.severity ?? null,
      issue: body.issue ?? null,
    },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "project", "escalations"));
  return { id: projectId, status: "accepted", correlationId: ctx.correlationId };
}
