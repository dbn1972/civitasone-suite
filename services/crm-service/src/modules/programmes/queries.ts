/**
 * Read model for programmes (G12).
 *
 * Reads are cache-first via `cache.getOrLoad` / `cache.listOrLoad`, keyed
 * `{service}:{tenant}:{resource}:{id}` like every other module.
 *
 * GRACEFUL DEGRADATION. A cache outage is a degraded state, not an outage of the
 * programme list: `throughCache` catches anything the cache layer throws, logs WARN (never
 * ERROR — nobody should be paged because Redis blinked) and reads Postgres directly. The
 * request still succeeds, so a Redis incident cannot turn into a wave of 500s on a
 * government programme dashboard.
 */
import { pino } from "pino";
import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import { summariseExecutionHealth, type ExecutionHealth } from "./domain.js";
import type { ProgrammeMetricView, ProgrammeView } from "./schema.js";

const log = pino({ name: "crm-programmes-queries" });

export const RESOURCE = "programme";
export const METRIC_RESOURCE = "programme_metric";

export function keyFor(tenantId: string, id: string): string {
  return cache.makeKey(tenantId, RESOURCE, id);
}

/**
 * Run a cache-backed read, falling through to the loader if the cache misbehaves.
 * Exported so the fallthrough itself is directly testable — a degradation path that is
 * only reachable by breaking Redis is a degradation path nobody ever verifies.
 */
export async function throughCache<T>(
  cached: () => Promise<T>,
  fallback: () => Promise<T>,
  context: { tenantId: string; resource: string },
): Promise<T> {
  try {
    return await cached();
  } catch (err) {
    log.warn(
      { err, tenantId: context.tenantId, resource: context.resource },
      "cache unavailable — reading through to postgres",
    );
    return fallback();
  }
}

export async function getProgramme(id: string, tenantId: string): Promise<ProgrammeView | null> {
  return throughCache(
    () => cache.getOrLoad<ProgrammeView>(keyFor(tenantId, id), () => repo.findById(id, tenantId)),
    () => repo.findById(id, tenantId),
    { tenantId, resource: RESOURCE },
  );
}

export async function getProgrammeByCode(
  code: string,
  tenantId: string,
): Promise<ProgrammeView | null> {
  return throughCache(
    () =>
      cache.getOrLoad<ProgrammeView>(cache.makeKey(tenantId, `${RESOURCE}_code`, code), () =>
        repo.findByCode(code, tenantId),
      ),
    () => repo.findByCode(code, tenantId),
    { tenantId, resource: RESOURCE },
  );
}

export async function listProgrammes(
  tenantId: string,
  limit: number,
  offset: number,
  filters: repo.ListFilters = {},
): Promise<{ rows: ProgrammeView[]; total: number }> {
  const variant = `${limit}:${offset}:${filters.status ?? "*"}:${filters.accountId ?? "*"}:${filters.productLine ?? "*"}`;
  return throughCache(
    () =>
      cache.listOrLoad(tenantId, RESOURCE, variant, () =>
        repo.listByTenant(tenantId, limit, offset, filters),
      ),
    () => repo.listByTenant(tenantId, limit, offset, filters),
    { tenantId, resource: RESOURCE },
  );
}

export async function listProgrammeMetrics(
  tenantId: string,
  programmeId: string,
  limit: number,
  offset: number,
  filters: repo.MetricFilters = {},
): Promise<{ rows: ProgrammeMetricView[]; total: number }> {
  const variant = [
    programmeId,
    limit,
    offset,
    filters.metricKey ?? "*",
    filters.periodStartFrom ?? "*",
    filters.periodStartTo ?? "*",
  ].join(":");
  return throughCache(
    () =>
      cache.listOrLoad(tenantId, METRIC_RESOURCE, variant, () =>
        repo.listMetrics(tenantId, programmeId, limit, offset, filters),
      ),
    () => repo.listMetrics(tenantId, programmeId, limit, offset, filters),
    { tenantId, resource: METRIC_RESOURCE },
  );
}

/** The J6 execution-health roll-up: read the samples, then compute in the pure domain. */
export async function getExecutionHealth(
  tenantId: string,
  programmeId: string,
  filters: repo.MetricFilters = {},
): Promise<ExecutionHealth> {
  const variant = [
    "health",
    programmeId,
    filters.periodStartFrom ?? "*",
    filters.periodStartTo ?? "*",
  ].join(":");
  const load = async (): Promise<ExecutionHealth> =>
    summariseExecutionHealth(await repo.metricSamples(tenantId, programmeId, filters));
  return throughCache(
    () => cache.listOrLoad(tenantId, METRIC_RESOURCE, variant, load),
    load,
    { tenantId, resource: METRIC_RESOURCE },
  );
}

/**
 * Drop the entity key and every cached list variant after a write applies. Invalidation
 * failures are swallowed with a WARN for the same reason reads degrade quietly: a stale
 * entry self-heals within the bounded TTL, whereas a thrown invalidation would fail a
 * consumer whose database write has already committed and cause an endless redelivery.
 */
export async function invalidateProgramme(tenantId: string, id: string): Promise<void> {
  try {
    await cache.invalidate(keyFor(tenantId, id));
    await cache.invalidateResource(tenantId, RESOURCE);
    await cache.invalidateResource(tenantId, METRIC_RESOURCE);
  } catch (err) {
    log.warn({ err, tenantId, programmeId: id }, "cache invalidation failed — entry will expire by TTL");
  }
}
