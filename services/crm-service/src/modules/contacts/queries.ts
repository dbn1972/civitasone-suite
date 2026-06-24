import { cache } from "../../shared/infra.js";
import { RESOURCE } from "../../topics.js";
import * as repo from "./repo.js";
import type { ContactView, ContactDetailView } from "./schema.js";
import type { ListFilters } from "./repo.js";
import { maskEmail, maskPhone } from "../../shared/pii-crypto.js";

/** Mask PII (email/phone) on a single contact view for non-admin callers. */
function maskView(v: ContactView): ContactView {
  return { ...v, email: maskEmail(v.email), phone: maskPhone(v.phone) };
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
  const out: ContactDetailView = { ...d };
  if (d.email) out.email = maskEmail(d.email) as string;
  if (d.phone) out.phone = maskPhone(d.phone) as string;
  return out;
}

export async function listContacts(
  tenantId: string,
  limit: number,
  offset: number,
  filters: ListFilters = {},
  isAdmin = false,
): Promise<{ data: ContactView[]; pagination: { hasMore: boolean; pageSize: number; cursor?: string } }> {
  const cacheKey = `list:${limit}:${offset}:${filters.search ?? ""}:${filters.leadStatus ?? ""}:${filters.segment ?? "all"}:${filters.ownerId ?? ""}`;
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

export async function exportContacts(tenantId: string, isAdmin = false): Promise<ContactView[]> {
  const rows = await repo.exportAll(tenantId);
  return isAdmin ? rows : rows.map(maskView);
}

export async function listAccounts(tenantId: string) {
  return repo.listAccounts(tenantId);
}
