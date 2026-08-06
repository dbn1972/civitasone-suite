/**
 * Read-model handlers for the segment taxonomy (G5). Every read is served through
 * `cache.getOrLoad`, keyed `crm:{tenant}:segment_definition:*`.
 */
import { cache } from "../../shared/infra.js";
import { HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import { decideSegmentValue, isEligible, toEligibility, SEGMENT_ERROR_CODES } from "./domain.js";
import type { SegmentDefinitionView, SegmentEligibilityView, SegmentSettingsView } from "./schema.js";

const RESOURCE = repo.RESOURCE;

export async function getSegment(tenantId: string, segmentCode: string): Promise<SegmentDefinitionView | null> {
  return cache.getOrLoad<SegmentDefinitionView>(cache.makeKey(tenantId, RESOURCE, segmentCode), () =>
    repo.findByCode(tenantId, segmentCode),
  );
}

export interface SegmentListResult {
  data: SegmentDefinitionView[];
  meta: { page: number; pageSize: number; total: number };
}

export async function listSegments(
  tenantId: string,
  page: number,
  pageSize: number,
  filter: repo.ListFilter = {},
): Promise<SegmentListResult> {
  const key = cache.makeKey(
    tenantId,
    RESOURCE,
    `list:${page}:${pageSize}:${filter.status ?? ""}:${filter.governance ?? ""}`,
  );
  const loaded = await cache.getOrLoad<SegmentListResult>(key, async () => {
    const { rows, total } = await repo.listByTenant(tenantId, page, pageSize, filter);
    return { data: rows, meta: { page, pageSize, total } };
  });
  return loaded ?? { data: [], meta: { page, pageSize, total: 0 } };
}

/**
 * The eligibility seam (G5 §3). Returns null for an unknown segment AND for one that
 * is not published — a draft taxonomy entry must not drive recommendations, and a
 * deprecated one must stop doing so. Both cases are a 404 at the route: from a
 * consumer's point of view "no eligibility is defined for this code" is one answer.
 */
export async function getEligibility(tenantId: string, segmentCode: string): Promise<SegmentEligibilityView | null> {
  const segment = await getSegment(tenantId, segmentCode);
  if (!segment || !isEligible(segment.status)) return null;
  return toEligibility(segment);
}

export async function getSettings(tenantId: string): Promise<SegmentSettingsView> {
  return repo.getSettings(tenantId);
}

/** Published codes, read through the cache — consulted on the classification path. */
export async function publishedCodes(tenantId: string): Promise<string[]> {
  const loaded = await cache.getOrLoad<string[]>(cache.makeKey(tenantId, RESOURCE, "published-codes"), () =>
    repo.listPublishedCodes(tenantId),
  );
  return loaded ?? [];
}

/**
 * Enforcement gate for `crm.contacts.segment` (G5 §2).
 *
 * Fast path first and deliberately: when the tenant has enforcement OFF — the default,
 * and the state of every tenant that existed before this module — this returns
 * immediately without ever reading the catalogue, so classification behaves exactly as
 * it did before. Only an enforcing tenant pays for the published-code lookup.
 *
 * Throws 422 (not 400): the payload is well formed, it breaks a tenant business rule.
 */
export async function assertSegmentAllowed(tenantId: string, segment: string | null | undefined): Promise<void> {
  if (segment === null || segment === undefined || segment.trim() === "") return;
  const settings = await repo.getSettings(tenantId);
  if (!settings.enforceSegmentCatalogue) return;

  const codes = await publishedCodes(tenantId);
  const decision = decideSegmentValue(segment, true, codes);
  if (decision.allowed) return;
  const valid = decision.validCodes ?? [];
  // The valid codes go in the MESSAGE, not only in `details`: the service's shared
  // error envelope carries code + message + correlationId, so anything a caller has to
  // act on has to be in one of those. Bounded to 50 codes so an enormous catalogue
  // cannot produce an unbounded error body.
  const listed = valid.length === 0 ? "none published" : valid.slice(0, 50).join(", ");
  throw new HttpError(
    422,
    decision.code ?? SEGMENT_ERROR_CODES.notInCatalogue,
    `segment "${segment}" is not a published segmentCode; valid codes: ${listed}`,
    { segment, validSegmentCodes: valid },
  );
}
