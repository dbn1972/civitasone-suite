/**
 * Segment taxonomy domain logic — pure, no I/O (G5).
 *
 * Everything that decides *whether* a mutation is allowed, or *what* the eligibility
 * contract looks like, lives here so it can be exercised exhaustively without a
 * database, a bus or a Fastify request.
 */
import {
  SEGMENT_STATUSES,
  type SegmentStatus,
  type SegmentGovernance,
  type SegmentDefinitionView,
  type SegmentEligibilityView,
} from "./schema.js";
import { LEAD_CHANNELS, isLeadChannel } from "../leads/channels.js";

/** Stable machine keys: same 64-char budget as `crm.contacts.segment`. */
export const SEGMENT_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$/;

/** Product codes mirror `crm.products.code` (varchar(64)). */
export const PRODUCT_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;

export const SEGMENT_ERROR_CODES = {
  canonicalImmutable: "SEGMENT_CANONICAL_IMMUTABLE",
  notFound: "SEGMENT_NOT_FOUND",
  exists: "SEGMENT_EXISTS",
  versionConflict: "SEGMENT_VERSION_CONFLICT",
  alreadyPublished: "SEGMENT_ALREADY_PUBLISHED",
  notPublished: "SEGMENT_NOT_PUBLISHED",
  alreadyDeprecated: "SEGMENT_ALREADY_DEPRECATED",
  unknownChannel: "SEGMENT_UNKNOWN_CHANNEL",
  duplicateProduct: "SEGMENT_DUPLICATE_PRODUCT",
  notInCatalogue: "SEGMENT_NOT_IN_CATALOGUE",
} as const;

export function isSegmentStatus(value: unknown): value is SegmentStatus {
  return typeof value === "string" && (SEGMENT_STATUSES as readonly string[]).includes(value);
}

/**
 * `canonical` rows are reference data: a deployment seeds them, and the API must not
 * let anybody edit, publish, deprecate or delete them — not even super_admin. Role is
 * not consulted on purpose; if a canonical row is wrong the fix is a new seed, so the
 * platform catalogue cannot silently diverge per tenant.
 */
export function isMutable(governance: SegmentGovernance | string): boolean {
  return governance !== "canonical";
}

/** Channel codes that are NOT in the service's single channel vocabulary. */
export function unknownChannels(channels: readonly string[]): string[] {
  return channels.filter((c) => !isLeadChannel(c));
}

/** The closed channel set, for error details and documentation. */
export function knownChannels(): string[] {
  return [...LEAD_CHANNELS];
}

/** Product codes appearing more than once — priority order must be unambiguous. */
export function duplicateProducts(products: readonly string[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const p of products) {
    if (seen.has(p)) dupes.add(p);
    seen.add(p);
  }
  return [...dupes];
}

/**
 * Publish transition: draft → published, or a re-publish of a deprecated segment
 * (which is how a tenant reinstates a retired segment). Publishing an already
 * published segment is refused rather than silently bumping its revision, so a
 * double-click cannot inflate `versionNumber`.
 */
export function canPublish(status: SegmentStatus): boolean {
  return status === "draft" || status === "deprecated";
}

/** Deprecate transition: only a published segment can be retired. */
export function canDeprecate(status: SegmentStatus): boolean {
  return status === "published";
}

/** Only published segments are eligible — draft and deprecated are invisible to consumers. */
export function isEligible(status: SegmentStatus): boolean {
  return status === "published";
}

/**
 * Project a definition onto the eligibility contract (G5 §3).
 *
 * Order is preserved exactly as stored: `priorityProducts[0]` is the product a
 * recommendation engine should offer first, `primaryChannels[0]` the channel it
 * should reach the customer on first.
 */
export function toEligibility(view: SegmentDefinitionView): SegmentEligibilityView {
  return {
    segmentCode: view.segmentCode,
    displayName: view.displayName,
    status: view.status,
    versionNumber: view.versionNumber,
    priorityProducts: [...view.priorityProducts],
    primaryChannels: [...view.primaryChannels],
    publishedAt: view.publishedAt,
  };
}

export interface SegmentEnforcementDecision {
  /** True when the value may be written to `crm.contacts.segment`. */
  allowed: boolean;
  /** Set only when `allowed` is false. */
  code?: string;
  /** The published codes the caller may choose from, sorted. */
  validCodes?: string[];
}

/**
 * The backward-compatibility decision (G5 §2), isolated so it can be proved.
 *
 * When `enforced` is false the answer is ALWAYS `allowed`, whatever the value and
 * whatever the catalogue contains — that is the guarantee existing tenants rely on.
 * A cleared segment (null/undefined/blank) is always allowed too: enforcement governs
 * which vocabulary may be used, not whether a lead must be segmented.
 */
export function decideSegmentValue(
  segment: string | null | undefined,
  enforced: boolean,
  publishedCodes: readonly string[],
): SegmentEnforcementDecision {
  if (!enforced) return { allowed: true };
  if (segment === null || segment === undefined || segment.trim() === "") return { allowed: true };
  if (publishedCodes.includes(segment)) return { allowed: true };
  return {
    allowed: false,
    code: SEGMENT_ERROR_CODES.notInCatalogue,
    validCodes: [...publishedCodes].sort(),
  };
}
