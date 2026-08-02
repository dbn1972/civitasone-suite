import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";

export type { Accepted };

export async function createAgent(
  ctx: RequestContext,
  body: { name: string; skills: Record<string, unknown>[]; tools: Record<string, unknown>[] },
): Promise<Accepted> {
  const id = randomUUID();
  return publishCommand(ctx, COMMANDS.createAgent, id, {
    id,
    name: body.name,
    skills: body.skills,
    tools: body.tools,
  });
}

export async function updateAgent(
  ctx: RequestContext,
  id: string,
  body: { version: number; patch: Record<string, unknown> },
): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.updateAgent, id, {
    id,
    version: body.version,
    patch: body.patch,
  });
}

export async function deleteAgent(
  ctx: RequestContext,
  id: string,
  version: number,
): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.deleteAgent, id, { id, version });
}

export async function pauseAgent(
  ctx: RequestContext,
  id: string,
  version: number,
): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.pauseAgent, id, { id, version });
}

export async function resumeAgent(
  ctx: RequestContext,
  id: string,
  version: number,
): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.resumeAgent, id, { id, version });
}

export async function handoffAgent(
  ctx: RequestContext,
  payload: {
    fromAgentId: string;
    toAgentId: string;
    toAgentName: string;
    requiredSkill: string;
    conversationId?: string;
  },
): Promise<Accepted> {
  const id = randomUUID();
  return publishCommand(ctx, COMMANDS.handoffAgent, id, payload);
}

export async function invokeAgent(
  ctx: RequestContext,
  agentId: string,
  payload: {
    invocationId: string;
    sanitizedInput: string | null;
    conversationId?: string;
  },
): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.invokeAgent, payload.invocationId, {
    agentId,
    invocationId: payload.invocationId,
    sanitizedInput: payload.sanitizedInput,
    ...(payload.conversationId !== undefined ? { conversationId: payload.conversationId } : {}),
  });
}

export async function recordBlockedAudit(
  ctx: RequestContext,
  payload: {
    agentId?: string;
    action: string;
    input: string | null;
    reason: string;
  },
): Promise<Accepted> {
  const id = randomUUID();
  return publishCommand(ctx, COMMANDS.recordBlockedAudit, id, {
    ...(payload.agentId !== undefined ? { agentId: payload.agentId } : {}),
    action: payload.action,
    input: payload.input,
    output: null,
    blocked: true,
    reason: payload.reason,
  });
}
