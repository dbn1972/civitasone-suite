/**
 * G15 — MoU milestone governance: read-model handlers.
 *
 * Single-entity reads go through the Redis read-through cache
 * (`cache.getOrLoad`, key `contract:{tenant}:{resource}:{id}`). If Redis is
 * unreachable the read falls through to Postgres and logs a WARN — a cache
 * outage degrades latency, never availability, and never returns a 500.
 *
 * List reads go straight to Postgres: they are paginated and filtered, so
 * caching them would multiply keys without improving the hit ratio.
 */
import { pino } from "pino";
import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import type { PenaltyTermRow, ReviewScheduleRow } from "./schema.js";
import type { MilestoneRow } from "./repo.js";

const log = pino({ name: "contract-mou-queries" });

/**
 * Read through the cache, falling back to the loader if Redis misbehaves.
 * Never throws on a cache fault.
 */
async function readThrough<T>(key: string, loader: () => Promise<T | undefined>): Promise<T | null> {
  try {
    const cached = await cache.getOrLoad<T | undefined>(key, loader);
    return cached ?? null;
  } catch (err) {
    log.warn({ err, key }, "cache unavailable — falling through to postgres");
    const row = await loader();
    return row ?? null;
  }
}

export async function getMilestone(id: string, tenantId: string): Promise<MilestoneRow | null> {
  const row = await readThrough<MilestoneRow>(cache.makeKey(tenantId, "mou-milestone", id), () =>
    repo.findMilestoneById(id, tenantId),
  );
  // Defence in depth: a cache key collision must never leak another tenant's row.
  if (!row || row.tenantId !== tenantId) return null;
  return row;
}

export async function listMilestones(
  tenantId: string,
  opts: { contractId?: string; status?: string; limit: number; offset: number },
): Promise<{ data: MilestoneRow[]; total: number }> {
  return repo.listMilestones(tenantId, opts);
}

export async function getPenaltyTerm(id: string, tenantId: string): Promise<PenaltyTermRow | null> {
  const row = await readThrough<PenaltyTermRow>(cache.makeKey(tenantId, "mou-penalty-term", id), () =>
    repo.findPenaltyTermById(id, tenantId),
  );
  if (!row || row.tenantId !== tenantId) return null;
  return row;
}

export async function listPenaltyTerms(
  tenantId: string,
  opts: { contractId?: string; triggerType?: string; limit: number; offset: number },
): Promise<{ data: PenaltyTermRow[]; total: number }> {
  return repo.listPenaltyTerms(tenantId, opts);
}

export async function listPenaltyApplications(
  tenantId: string,
  opts: { contractId?: string; limit: number; offset: number },
): ReturnType<typeof repo.listPenaltyApplications> {
  return repo.listPenaltyApplications(tenantId, opts);
}

export async function getReviewSchedule(id: string, tenantId: string): Promise<ReviewScheduleRow | null> {
  const row = await readThrough<ReviewScheduleRow>(cache.makeKey(tenantId, "mou-review", id), () =>
    repo.findReviewScheduleById(id, tenantId),
  );
  if (!row || row.tenantId !== tenantId) return null;
  return row;
}

export async function listReviewSchedules(
  tenantId: string,
  opts: { contractId?: string; status?: string; limit: number; offset: number },
): Promise<{ data: ReviewScheduleRow[]; total: number }> {
  return repo.listReviewSchedules(tenantId, opts);
}
