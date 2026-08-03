import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { cache } from "../../shared/infra.js";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";

export type { Accepted };

export async function draftAgentDefinition(
  ctx: RequestContext,
  body: {
    name: string;
    description: string | null;
    systemPrompt: string;
    tools: Record<string, unknown>[];
    modelConfig: Record<string, unknown>;
  },
): Promise<Accepted> {
  const id = randomUUID();
  const accepted = await publishCommand(ctx, COMMANDS.draftAgentDefinition, id, {
    id,
    name: body.name,
    description: body.description,
    systemPrompt: body.systemPrompt,
    tools: body.tools,
    modelConfig: body.modelConfig,
  });
  await cache.invalidateResource(ctx.tenantId, "authoring-agents");
  return accepted;
}

export async function updateAgentDefinition(
  ctx: RequestContext,
  id: string,
  body: { version: number; patch: Record<string, unknown> },
): Promise<Accepted> {
  const accepted = await publishCommand(ctx, COMMANDS.updateAgentDefinition, id, {
    id,
    version: body.version,
    patch: body.patch,
  });
  await cache.invalidateResource(ctx.tenantId, "authoring-agents");
  return accepted;
}

export async function publishAgentDefinition(
  ctx: RequestContext,
  id: string,
  body: { version: number; name: string; toolCount: number },
): Promise<Accepted> {
  const accepted = await publishCommand(ctx, COMMANDS.publishAgentDefinition, id, {
    id,
    version: body.version,
    name: body.name,
    toolCount: body.toolCount,
    publishedAt: new Date().toISOString(),
  });
  await cache.invalidateResource(ctx.tenantId, "authoring-agents");
  return accepted;
}

export async function archiveAgentDefinition(
  ctx: RequestContext,
  id: string,
  version: number,
): Promise<Accepted> {
  const accepted = await publishCommand(ctx, COMMANDS.archiveAgentDefinition, id, { id, version });
  await cache.invalidateResource(ctx.tenantId, "authoring-agents");
  return accepted;
}
