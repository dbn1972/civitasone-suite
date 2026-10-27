import { randomUUID } from "node:crypto";
import { publishCommand } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";
import type { RequestContext } from "../../shared/context.js";

/** The proposal id is allocated here and returned, so a 202 caller can address it (preview, decide). */
export async function proposeConfigChange(ctx: RequestContext, payload: Record<string, unknown>) {
  const id = randomUUID();
  const { messageId } = await publishCommand(COMMANDS.rateConfigPropose, ctx, { ...payload, id });
  return { messageId, id };
}

export function decideConfigProposal(ctx: RequestContext, proposalId: string, payload: Record<string, unknown>) {
  // actorRoles is taken from the verified token AFTER the body spread, so a client can never supply its own.
  return publishCommand(COMMANDS.rateConfigDecide, ctx, { ...payload, proposalId, actorRoles: ctx.roles ?? [] });
}
