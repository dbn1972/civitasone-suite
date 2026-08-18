import { cache } from "../../shared/infra.js";
import { RESOURCE } from "../../topics.js";
import * as repo from "./repo.js";
import type { ContactView, ContactDetailView } from "./schema.js";
import type { ListFilters } from "./repo.js";
import { maskContactRecord } from "../../shared/data-governance.js";

/** Mask PII (email/phone) on a single contact view for non-admin callers.
 *  Uses the shared @civitasone/data-governance masking engine (CAP-085). */
function maskView(v: ContactView): ContactView {
  return maskContactRecord(v as unknown as Record<string, unknown>, []) as unknown as ContactView;
}

export async function getContact(id: string, tenantId: string, isAdmin = false): Promise<ContactView | null> {
  const v = await cache.getOrLoad<ContactView>(
    cache.makeKey(tenantId, RESOURCE, id),
    () => repo.findById(id, tenantId),
  );
  if (!v) return null;
  return isAdmin ? v : maskView(v);
}

export async function getContactDetail(id: string, tenantId: string, isAdmin = false): Promise<ContactDetailView | null> {
  const d = await repo.findDetail(id, tenantId);
  if (!d || isAdmin) return d;
  return maskContactRecord(d as unknown as Record<string, unknown>, []) as unknown as ContactDetailView;
}

export async function listContacts(
  tenantId: string,
  limit: number,
  offset: number,
  filters: ListFilters = {},
  isAdmin = false,
): Promise<{ data: ContactView[]; pagination: { hasMore: boolean; pageSize: number; cursor?: string } }> {
  const cacheKey = `list:${limit}:${offset}:${filters.search ?? ""}:${filters.leadStatus ?? ""}:${filters.segment ?? "all"}:${filters.ownerId ?? ""}` +
    `:${filters.temperature ?? ""}:${filters.priority ?? ""}:${filters.segmentName ?? ""}:${filters.product ?? ""}:${filters.region ?? ""}:${filters.leadSource ?? ""}:${filters.contactStatus ?? ""}:${filters.expectedValueMin ?? ""}:${filters.expectedValueMax ?? ""}`;
  // Cache holds CLEARTEXT; masking is applied per-response by role so the
  // same cached page serves both admin (clear) and non-admin (masked) callers.
  const result = await cache.listOrLoad(tenantId, RESOURCE, cacheKey, async () => {
    const rows = await repo.listByTenant(tenantId, limit, offset, filters);
    return {
      data: rows,
      pagination: {
        hasMore: rows.length === limit,
        pageSize: limit,
        ...(rows.length ? { cursor: String(offset + rows.length) } : {}),
      },
    };
  });
  if (isAdmin) return result;
  return { ...result, data: result.data.map(maskView) };
}

export async function exportContacts(tenantId: string, isAdmin = false, limit = 500, offset = 0): Promise<ContactView[]> {
  const rows = await repo.exportAll(tenantId, limit, offset);
  return isAdmin ? rows : rows.map(maskView);
}

export async function listAccounts(tenantId: string, limit = 50, offset = 0) {
  return repo.listAccounts(tenantId, limit, offset);
}
