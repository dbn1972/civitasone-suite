import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishCommand, type Accepted } from "../../../shared/publish.js";
import { COMMANDS } from "../../../topics.js";

export type { Accepted };

export async function startOrchestration(
  ctx: RequestContext,
  payload: {
    id: string;
    rootAgentId: string;
    maxDepth: number;
    maxHops: number;
  },
): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.startOrchestration, payload.id, payload);
}

export async function recordHandoff(
  ctx: RequestContext,
  orchestrationId: string,
  payload: {
    hopId: string;
    fromAgentId: string;
    toAgentId: string;
    reason: string;
    nextDepth: number;
    nextHopCount: number;
    version: number;
  },
): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.recordHandoff, payload.hopId, {
    orchestrationId,
    ...payload,
  });
}

export async function abortOrchestration(
  ctx: RequestContext,
  id: string,
  payload: { reason: string; version: number },
): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.abortOrchestration, id, { id, ...payload });
}

export async function recordOrchestrationLimit(
  ctx: RequestContext,
  payload: {
    orchestrationId: string;
    fromAgentId: string;
    code: string;
    reason: string;
    depth: number;
    hopCount: number;
    maxDepth: number;
    maxHops: number;
  },
): Promise<Accepted> {
  const id = randomUUID();
  return publishCommand(ctx, COMMANDS.recordBlockedAudit, id, {
    agentId: payload.fromAgentId,
    action: "orchestration.handoff",
    input: null,
    output: null,
    blocked: true,
    reason: payload.reason,
    kind: "orchestration_limit",
    orchestrationId: payload.orchestrationId,
    code: payload.code,
    depth: payload.depth,
    hopCount: payload.hopCount,
    maxDepth: payload.maxDepth,
    maxHops: payload.maxHops,
  });
}
