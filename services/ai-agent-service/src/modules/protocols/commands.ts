import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { cache } from "../../shared/infra.js";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";
import { normalizeCapabilities } from "./domain.js";

export type { Accepted };

export async function registerProtocol(
  ctx: RequestContext,
  body: {
    protocol: string;
    endpoint: string;
    capabilities?: Record<string, unknown>[] | undefined;
    enabled?: boolean | undefined;
  },
): Promise<Accepted> {
  const id = randomUUID();
  const accepted = await publishCommand(ctx, COMMANDS.registerProtocol, id, {
    id,
    protocol: body.protocol,
    endpoint: body.endpoint,
    capabilities: normalizeCapabilities(body.capabilities ?? []),
    enabled: body.enabled ?? true,
  });
  await cache.invalidateResource(ctx.tenantId, "protocols");
  return accepted;
}

export async function updateProtocol(
  ctx: RequestContext,
  id: string,
  body: {
    endpoint?: string | undefined;
    capabilities?: Record<string, unknown>[] | undefined;
    enabled?: boolean | undefined;
    version: number;
  },
): Promise<Accepted> {
  const patch: Record<string, unknown> = {};
  if (body.endpoint !== undefined) patch.endpoint = body.endpoint;
  if (body.capabilities !== undefined) patch.capabilities = normalizeCapabilities(body.capabilities);
  if (body.enabled !== undefined) patch.enabled = body.enabled;
  const accepted = await publishCommand(ctx, COMMANDS.updateProtocol, id, {
    id, version: body.version, patch, enabled: body.enabled,
  });
  await cache.invalidateResource(ctx.tenantId, "protocols");
  return accepted;
}
