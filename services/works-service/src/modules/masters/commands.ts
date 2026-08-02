import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

export type Accepted = { id: string; status: "accepted"; correlationId: string };

/**
 * Publish a master-create command for the given master type (registry prefix,
 * e.g. "authorities", "sr-items").
 *
 * CRITICAL: this MUST publish to COMMANDS.masterCreate, never
 * COMMANDS.proposalCreate — masters and proposals are unrelated aggregates;
 * sharing a topic silently routes master rows into the work_proposals table.
 */
export async function publishMasterCreate(
  ctx: RequestContext,
  masterType: string,
  payload: Record<string, unknown>,
): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.masterCreate, {
    messageId: randomUUID(),
    type: COMMANDS.masterCreate,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, masterType, ...payload },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
