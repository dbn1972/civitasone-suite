/**
 * Query handlers (READ PATH) — read-through Redis cache for metric definitions.
 * Key convention: reports:{tenant}:metric_definition:{id}
 */
import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import type { MetricDefinitionView } from "./schema.js";

export const RESOURCE = "metric_definition";

export function keyFor(tenantId: string, id: string): string {
  return cache.makeKey(tenantId, RESOURCE, id);
}

/** Resolved-by-key lookups get their own key so publishing invalidates both. */
export function byKeyCacheKey(tenantId: string, metricKey: string): string {
  return cache.makeKey(tenantId, RESOURCE, `by-key:${metricKey}`);
}

export async function getMetricDefinition(
  tenantId: string,
  id: string,
): Promise<MetricDefinitionView | null> {
  return cache.getOrLoad(keyFor(tenantId, id), () => repo.findById(id, tenantId));
}

export async function getPublishedByKey(
  tenantId: string,
  metricKey: string,
): Promise<MetricDefinitionView | null> {
  return cache.getOrLoad(byKeyCacheKey(tenantId, metricKey), () =>
    repo.findPublishedByKey(metricKey, tenantId),
  );
}

export async function listMetricDefinitions(
  tenantId: string,
  limit: number,
  offset: number,
  filters: repo.MetricFilters = {},
): Promise<{ rows: MetricDefinitionView[]; total: number }> {
  const hash = `${limit}:${offset}:${filters.module ?? ""}:${filters.status ?? ""}:${filters.governance ?? ""}:${filters.metricKey ?? ""}`;
  return cache.listOrLoad(tenantId, RESOURCE, hash, () =>
    repo.listByTenant(tenantId, limit, offset, filters),
  );
}
