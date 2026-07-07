import { cache } from "../../shared/infra.js";
import { RESOURCE } from "../../topics.js";
import * as repo from "./repo.js";
import type { TicketView, TicketRow } from "./schema.js";

export async function getTicket(id: string, tenantId: string): Promise<TicketView | null> {
  return cache.getOrLoad<TicketView>(
    cache.makeKey(tenantId, RESOURCE, id),
    () => repo.findById(id, tenantId)
  );
}

/**
 * Get the raw ticket row (not cached view) — needed for transition validation
 * where we need the ticketType and actual stored status.
 */
export async function getTicketRaw(id: string, tenantId: string): Promise<TicketRow | null> {
  try {
    return await repo.findRow(id, tenantId);
  } catch {
    // If schema columns don't exist yet (migration pending), fall back to null
    return null;
  }
}

export async function listTickets(
  tenantId: string,
  limit: number,
  offset: number
): Promise<{ data: TicketView[]; pagination: { hasMore: boolean; pageSize: number; cursor?: string } }> {
  return cache.listOrLoad(tenantId, RESOURCE, `list:${limit}:${offset}`, async () => {
    const rows = await repo.listByTenant(tenantId, limit, offset);
    return {
      data: rows,
      pagination: {
        hasMore: rows.length === limit,
        pageSize: limit,
        ...(rows.length ? { cursor: String(offset + rows.length) } : {}),
      },
    };
  });
}
