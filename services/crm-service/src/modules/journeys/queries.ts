/**
 * journeys module — read model. Everything goes through the Redis read-through cache, as
 * the architecture rules require; the loaders below are the only path to Postgres.
 *
 * Resolution (parent + child overrides composed into an effective template) is cached too:
 * it is a pure function of rows that only change through a consumer, and every one of those
 * consumers invalidates this resource.
 */
import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import { resolveTemplate, type RuleViolation, type OverrideMap } from "./domain.js";
import type { JourneyStep, JourneyTemplateView, StageVocabularyView } from "./schema.js";

const STAGE_RESOURCE = repo.STAGE_RESOURCE;
const TEMPLATE_RESOURCE = repo.TEMPLATE_RESOURCE;
const RESOLVED_RESOURCE = "journey_template_resolved";

export interface ListEnvelope<T> {
  rows: T[];
  total: number;
}

// ── Stage vocabulary ───────────────────────────────────────────────────────────

export async function getStage(id: string, tenantId: string): Promise<StageVocabularyView | null> {
  return cache.getOrLoad<StageVocabularyView>(
    cache.makeKey(tenantId, STAGE_RESOURCE, id),
    () => repo.findStageById(id, tenantId),
  );
}

export async function listStages(
  tenantId: string,
  limit: number,
  offset: number,
  filter: repo.StageFilter = {},
): Promise<ListEnvelope<StageVocabularyView>> {
  const hash = `list:${limit}:${offset}:${filter.governance ?? ""}`;
  return cache.listOrLoad(tenantId, STAGE_RESOURCE, hash, () =>
    repo.listStages(tenantId, limit, offset, filter));
}

/** Used by the route boundary to enforce the vocabulary rules before accepting a command. */
export async function effectiveVocabulary(tenantId: string): Promise<ReturnType<typeof repo.effectiveVocabulary>> {
  return repo.effectiveVocabulary(tenantId);
}

// ── Journey templates ──────────────────────────────────────────────────────────

export async function getTemplate(id: string, tenantId: string): Promise<JourneyTemplateView | null> {
  return cache.getOrLoad<JourneyTemplateView>(
    cache.makeKey(tenantId, TEMPLATE_RESOURCE, id),
    () => repo.findTemplateById(id, tenantId),
  );
}

export async function listTemplates(
  tenantId: string,
  limit: number,
  offset: number,
  filter: repo.TemplateFilter = {},
): Promise<ListEnvelope<JourneyTemplateView>> {
  const hash = [
    "list", limit, offset,
    filter.templateKey ?? "", filter.status ?? "", filter.governance ?? "",
    filter.product ?? "", filter.region ?? "", filter.businessUnit ?? "",
  ].join(":");
  return cache.listOrLoad(tenantId, TEMPLATE_RESOURCE, hash, () =>
    repo.listTemplates(tenantId, limit, offset, filter));
}

export interface ResolvedTemplateView {
  templateId: string;
  templateKey: string;
  name: string;
  versionNumber: number;
  status: string;
  /** Template ids from root to leaf. */
  chain: string[];
  steps: JourneyStep[];
  /** Overridable fields the leaf changed, per stage code. */
  overrides: OverrideMap;
}

export type ResolvedResult =
  | { ok: true; resolved: ResolvedTemplateView }
  | { ok: false; violations: RuleViolation[] };

/**
 * Compose a template with its ancestors into an effective definition.
 *
 * Returns violations rather than throwing, because a broken derivation is a 422 the caller
 * can act on (fix the child, restore the parent) and not a server fault. Only successful
 * resolutions are cached — caching a violation would keep reporting a problem for a TTL
 * after it had been fixed, and the fix arrives through a consumer that invalidates anyway.
 */
export async function getResolvedTemplate(id: string, tenantId: string): Promise<ResolvedResult | null> {
  const template = await getTemplate(id, tenantId);
  if (!template) return null;

  const cached = await cache.getOrLoad<ResolvedTemplateView>(
    cache.makeKey(tenantId, RESOLVED_RESOURCE, id),
    async () => {
      const [byId, vocabulary] = await Promise.all([
        repo.loadDerivationMap(tenantId, id),
        repo.effectiveVocabulary(tenantId),
      ]);
      const outcome = resolveTemplate(id, byId, vocabulary);
      if (!outcome.ok) return null;
      return {
        templateId: template.id,
        templateKey: template.templateKey,
        name: template.name,
        versionNumber: template.versionNumber,
        status: template.status,
        chain: outcome.resolved.chain,
        steps: outcome.resolved.steps,
        overrides: outcome.resolved.overrides,
      };
    },
  );
  if (cached) return { ok: true, resolved: cached };

  // Cache miss returned null => resolution failed. Recompute to report WHY.
  const [byId, vocabulary] = await Promise.all([
    repo.loadDerivationMap(tenantId, id),
    repo.effectiveVocabulary(tenantId),
  ]);
  const outcome = resolveTemplate(id, byId, vocabulary);
  if (outcome.ok) {
    return {
      ok: true,
      resolved: {
        templateId: template.id,
        templateKey: template.templateKey,
        name: template.name,
        versionNumber: template.versionNumber,
        status: template.status,
        chain: outcome.resolved.chain,
        steps: outcome.resolved.steps,
        overrides: outcome.resolved.overrides,
      },
    };
  }
  return { ok: false, violations: outcome.violations };
}

/** Cache resources this module owns, so callers invalidate a consistent set. */
export const RESOURCES = {
  stage: STAGE_RESOURCE,
  template: TEMPLATE_RESOURCE,
  resolved: RESOLVED_RESOURCE,
} as const;
