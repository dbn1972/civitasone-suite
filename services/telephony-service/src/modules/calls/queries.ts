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
import type { ListFilters, CallMetrics, MetricsWindow } from "./repo.js";

export type CallDetail = CallView;

function filterKey(limit: number, offset: number, f: ListFilters): string {
  const parts = [
    `l${limit}`,
    `o${offset}`,
    f.status ?? "-",
    f.direction ?? "-",
    f.queueId ?? "-",
    f.agentId ?? "-",
    f.from ?? "-",
    f.to ?? "-",
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
): Promise<{ data: CallSummary[]; pagination: { hasMore: boolean; pageSize: number; total: number; cursor?: string } }> {
  return cache.listOrLoad(tenantId, RESOURCE, filterKey(limit, offset, filters), async () => {
    const [rows, total] = await Promise.all([
      repo.listByTenant(tenantId, limit, offset, filters),
      repo.countByTenant(tenantId, filters),
    ]);
    return {
      data: rows,
      pagination: {
        // total is the TRUE filtered count; hasMore no longer guesses from a full page.
        hasMore: offset + rows.length < total,
        pageSize: limit,
        total,
        ...(rows.length ? { cursor: String(offset + rows.length) } : {}),
      },
    };
  });
}

export async function callMetrics(tenantId: string, win: MetricsWindow = {}): Promise<CallMetrics> {
  const cached = await cache.getOrLoad<CallMetrics>(
    cache.makeKey(tenantId, RESOURCE, `metrics:${win.queueId ?? "all"}:${win.from ?? "-"}:${win.to ?? "-"}`),
    () => repo.metricsByTenant(tenantId, win),
  );
  return cached ?? repo.metricsByTenant(tenantId, win);
}
