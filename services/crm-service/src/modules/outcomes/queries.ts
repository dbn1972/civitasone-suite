/**
 * outcomes module — read model (G18).
 *
 * Every read goes through the Redis read-through cache, as the architecture rules require.
 * Redis being unavailable must never turn a capture form into a 500, so each read falls
 * through to Postgres and logs WARN (never ERROR). A DATABASE failure is re-thrown
 * untouched — retrying it here would double the load on an already unhealthy database and
 * hide the cause. The `dbFailed` flag is what tells the two apart, following the pattern
 * established in leads/field-rules-repo.ts.
 */
import { pino } from "pino";
import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import type { InteractionOutcomeView, OutcomeReasonCodeView } from "./schema.js";

const log = pino({ name: "crm-outcomes-queries" });

const REASON_CODE_RESOURCE = repo.REASON_CODE_RESOURCE;
const OUTCOME_RESOURCE = repo.OUTCOME_RESOURCE;

export interface ListEnvelope<T> {
  rows: T[];
  total: number;
}

/**
 * Read `load()` through the cache using `viaCache`, degrading to a direct read when the
 * CACHE layer is what failed. Ids only in the log line — an outcome carries no PII, and
 * nothing is logged from it anyway.
 */
async function degradeGracefully<T>(
  viaCache: (loader: () => Promise<T>) => Promise<T>,
  load: () => Promise<T>,
  context: Record<string, string>,
): Promise<T> {
  let dbFailed = false;
  const loader = async (): Promise<T> => {
    try {
      return await load();
    } catch (err) {
      dbFailed = true;
      throw err;
    }
  };
  try {
    return await viaCache(loader);
  } catch (err) {
    if (dbFailed) throw err;
    log.warn({ err, ...context }, "outcomes cache unavailable; reading through to Postgres");
    return load();
  }
}

// ── Reason-code catalogue ──────────────────────────────────────────────────────

export async function getReasonCode(id: string, tenantId: string): Promise<OutcomeReasonCodeView | null> {
  return degradeGracefully<OutcomeReasonCodeView | null>(
    (loader) => cache.getOrLoad<OutcomeReasonCodeView>(
      cache.makeKey(tenantId, REASON_CODE_RESOURCE, id),
      loader,
    ),
    () => repo.findReasonCodeById(id, tenantId),
    { tenantId, reasonCodeId: id },
  );
}

export async function listReasonCodes(
  tenantId: string,
  limit: number,
  offset: number,
  filter: repo.ReasonCodeFilter = {},
): Promise<ListEnvelope<OutcomeReasonCodeView>> {
  const hash = [
    "list", limit, offset,
    filter.category ?? "", filter.governance ?? "", filter.outcomeType ?? "",
    filter.active === undefined ? "" : String(filter.active),
  ].join(":");
  return degradeGracefully(
    (loader) => cache.listOrLoad(tenantId, REASON_CODE_RESOURCE, hash, loader),
    () => repo.listReasonCodes(tenantId, limit, offset, filter),
    { tenantId },
  );
}

// ── Interaction outcomes ───────────────────────────────────────────────────────

export async function getOutcome(id: string, tenantId: string): Promise<InteractionOutcomeView | null> {
  return degradeGracefully<InteractionOutcomeView | null>(
    (loader) => cache.getOrLoad<InteractionOutcomeView>(
      cache.makeKey(tenantId, OUTCOME_RESOURCE, id),
      loader,
    ),
    () => repo.findOutcomeById(id, tenantId),
    { tenantId, outcomeId: id },
  );
}

export async function listOutcomes(
  tenantId: string,
  limit: number,
  offset: number,
  filter: repo.OutcomeFilter = {},
): Promise<ListEnvelope<InteractionOutcomeView>> {
  const hash = [
    "list", limit, offset,
    filter.subjectType ?? "", filter.subjectId ?? "", filter.outcomeType ?? "", filter.reasonCodeId ?? "",
  ].join(":");
  return degradeGracefully(
    (loader) => cache.listOrLoad(tenantId, OUTCOME_RESOURCE, hash, loader),
    () => repo.listOutcomes(tenantId, limit, offset, filter),
    { tenantId },
  );
}

/** Cache resources this module owns, so every caller invalidates a consistent set. */
export const RESOURCES = {
  reasonCode: REASON_CODE_RESOURCE,
  outcome: OUTCOME_RESOURCE,
} as const;
