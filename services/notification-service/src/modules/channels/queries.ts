import { cache } from "../../shared/infra.js";
import { RESOURCE } from "../../topics.js";
import * as repo from "./repo.js";
import type { ChannelView } from "./domain.js";

export async function listChannels(tenantId: string): Promise<ChannelView[]> {
  return cache.getOrLoad<ChannelView[]>(
    cache.makeKey(tenantId, RESOURCE.channel, "list"),
    () => repo.findChannelsByTenant(tenantId),
  ) as Promise<ChannelView[]>;
}

export async function getChannel(tenantId: string, id: string): Promise<ChannelView | null> {
  const view = await cache.getOrLoad<ChannelView>(
    cache.makeKey(tenantId, RESOURCE.channel, id),
    () => repo.findChannelById(id, tenantId),
  );
  // Defense-in-depth: guard against a cross-tenant cache hit.
  return view && view.tenantId === tenantId ? view : null;
}

export async function getDefaultChannel(tenantId: string, type?: string): Promise<ChannelView | null> {
  return repo.findDefaultChannel(tenantId, type);
}
