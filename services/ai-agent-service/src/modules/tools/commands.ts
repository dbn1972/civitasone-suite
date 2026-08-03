import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { cache } from "../../shared/infra.js";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";

export type { Accepted };

export async function defineTool(
  ctx: RequestContext,
  body: {
    agentDomain: string;
    toolName: string;
    description: string | null;
    inputSchema: Record<string, unknown>;
    requiresApproval: boolean;
    enabled: boolean;
  },
): Promise<Accepted> {
  const id = randomUUID();
  const accepted = await publishCommand(ctx, COMMANDS.defineTool, id, { id, ...body });
  await cache.invalidateResource(ctx.tenantId, "tools");
  return accepted;
}

export async function updateTool(
  ctx: RequestContext,
  id: string,
  body: {
    version: number;
    patch: Record<string, unknown>;
    agentDomain: string;
    toolName: string;
  },
): Promise<Accepted> {
  const accepted = await publishCommand(ctx, COMMANDS.updateTool, id, {
    id,
    version: body.version,
    patch: body.patch,
    agentDomain: body.agentDomain,
    toolName: body.toolName,
  });
  await cache.invalidateResource(ctx.tenantId, "tools");
  return accepted;
}

export async function seedDefaultTools(
  ctx: RequestContext,
  agentDomain: string | undefined,
  templates: Array<{
    agentDomain: string;
    toolName: string;
    description: string | null;
    inputSchema: Record<string, unknown>;
    requiresApproval: boolean;
  }>,
): Promise<Accepted> {
  const id = randomUUID();
  const accepted = await publishCommand(ctx, COMMANDS.seedDefaultTools, id, {
    agentDomain: agentDomain ?? "all",
    templates,
  });
  await cache.invalidateResource(ctx.tenantId, "tools");
  return accepted;
}

export async function recordReactStep(
  ctx: RequestContext,
  payload: {
    stepId: string;
    agentId: string;
    toolId: string;
    stepNo: number;
    thought: string;
    action: string;
    actionInput: Record<string, unknown>;
    observation: string | null;
    orchestrationId?: string;
    status: string;
    executed: boolean;
    decisionCode: string;
    decisionMessage: string;
    requiresApproval: boolean;
  },
): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.recordReactStep, payload.stepId, payload);
}
