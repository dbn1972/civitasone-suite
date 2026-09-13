import { cache } from "../../shared/infra.js";
import { RESOURCE } from "../../topics.js";
import * as repo from "./repo.js";
import type { ChannelView } from "./domain.js";
import type { Writer } from "./repo.js";

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

/**
 * TX-018 — tenant-scoped sibling of getDefaultChannel(). Threads the
 * caller's tx through to repo.findDefaultChannelTx() instead of
 * repo.findDefaultChannel() opening its own scopedRead(); see that
 * function's doc comment (channels/repo.ts) for why this exists. Route this
 * from resolveChannelWithDefaultTx() (deliveries/channel.ts), which already
 * has an open tx, instead of getDefaultChannel().
 */
export async function getDefaultChannelTx(tx: Writer, tenantId: string, type?: string): Promise<ChannelView | null> {
  return repo.findDefaultChannelTx(tx, tenantId, type);
}
