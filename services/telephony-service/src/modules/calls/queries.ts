/**
 * Query handlers (READ PATH) — read-through cache, tenant-scoped.
 *
 * List responses ALWAYS mask phone numbers (PII minimisation). Detail reads
 * return cleartext numbers only to an authorised admin; everyone else gets the
 * masked view.
 */
import { cache } from "../../shared/infra.js";
import { RESOURCE } from "../../topics.js";
import * as repo from "./repo.js";
import { maskPhone } from "../../shared/pii-crypto.js";
import type { CallView, CallSummary } from "./schema.js";
import type { ListFilters, CallMetrics } from "./repo.js";

export type CallDetail = CallView;

function filterKey(limit: number, offset: number, f: ListFilters): string {
  const parts = [
    `l${limit}`,
    `o${offset}`,
    f.status ?? "-",
    f.direction ?? "-",
    f.queueId ?? "-",
    f.agentId ?? "-",
    // The caller-number filter is keyed by its blind index, never the cleartext,
    // so the cache key cannot leak a phone number.
    f.callerNumber ? "byNumber" : "-",
  ];
  return `list:${parts.join(":")}`;
}

export async function getCall(id: string, tenantId: string, admin: boolean): Promise<CallDetail | null> {
  const view = await cache.getOrLoad<CallView>(cache.makeKey(tenantId, RESOURCE, id), () => repo.findView(id, tenantId));
  if (!view) return null;
  if (admin) return view;
  return { ...view, callerNumber: maskPhone(view.callerNumber), calleeNumber: maskPhone(view.calleeNumber) };
}

export async function listCalls(
  tenantId: string,
  limit: number,
  offset: number,
  filters: ListFilters = {},
): Promise<{ data: CallSummary[]; pagination: { hasMore: boolean; pageSize: number; cursor?: string } }> {
  return cache.listOrLoad(tenantId, RESOURCE, filterKey(limit, offset, filters), async () => {
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
}

export async function callMetrics(tenantId: string, queueId?: string): Promise<CallMetrics> {
  const cached = await cache.getOrLoad<CallMetrics>(
    cache.makeKey(tenantId, RESOURCE, `metrics:${queueId ?? "all"}`),
    () => repo.metricsByTenant(tenantId, queueId),
  );
  return cached ?? repo.metricsByTenant(tenantId, queueId);
}
