import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import { summarise, type VocSummary } from "./domain.js";
import type { InteractionSentimentView } from "./schema.js";

export const RESOURCE = "interaction_sentiment";

/** Widest window the aggregate will scan. See repo.listForSummary. */
export const SUMMARY_ROW_CAP = 5000;

export interface SentimentFilters {
  from?: string | undefined;
  to?: string | undefined;
  polarity?: string | undefined;
  activityType?: string | undefined;
}

function toRepoFilters(f: SentimentFilters): repo.ListFilters {
  return {
    from: f.from ? new Date(f.from) : undefined,
    to: f.to ? new Date(f.to) : undefined,
    polarity: f.polarity,
    activityType: f.activityType,
  };
}

function variantOf(f: SentimentFilters): string {
  return `${f.from ?? "*"}:${f.to ?? "*"}:${f.polarity ?? "*"}:${f.activityType ?? "*"}`;
}

export async function listSentiments(
  tenantId: string,
  limit: number,
  offset: number,
  filters: SentimentFilters = {},
): Promise<{ rows: InteractionSentimentView[]; total: number }> {
  return cache.listOrLoad(
    tenantId,
    RESOURCE,
    `list:${limit}:${offset}:${variantOf(filters)}`,
    () => repo.listByTenant(tenantId, limit, offset, toRepoFilters(filters)),
  );
}

export type VocSummaryResult = VocSummary & {
  /** True when the scan hit SUMMARY_ROW_CAP, so the window shown is partial. */
  truncated: boolean;
};

export async function getVocSummary(
  tenantId: string,
  filters: SentimentFilters = {},
): Promise<VocSummaryResult> {
  return cache.listOrLoad(
    tenantId,
    RESOURCE,
    `summary:${variantOf(filters)}`,
    async () => {
      const rows = await repo.listForSummary(
        tenantId,
        toRepoFilters(filters),
        SUMMARY_ROW_CAP,
      );
      // Report a clipped window as clipped rather than presenting a partial scan
      // as if it covered everything the caller asked for.
      return { ...summarise(rows), truncated: rows.length === SUMMARY_ROW_CAP };
    },
  );
}

/** Drop every cached list and summary variant after a reading lands. */
export async function invalidateSentiment(tenantId: string): Promise<void> {
  await cache.invalidateResource(tenantId, RESOURCE);
}
