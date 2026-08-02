/**
 * identity/stitch-domain.ts — CR-CDP-04 anonymous → known visitor stitching (PURE).
 *
 * A visitor browses as a device/cookie id, accumulating events against a shell golden
 * profile. When they authenticate, those events and identifiers belong to the *known*
 * profile — otherwise every logged-in customer also has a phantom twin that segments and
 * activations treat as a separate person.
 *
 * Survivorship direction is fixed and not configurable: the known profile always wins.
 * Anonymous attributes are inferred from behaviour, authenticated attributes were asserted
 * by the customer. Anonymous data may only fill gaps.
 *
 * The attribute merge itself reuses profiles/domain.ts `mergeProfiles` (most_complete) so
 * there is one survivorship implementation in the service. What this file adds is the
 * validation `validateMerge` cannot express — that one side is an anonymous shell and the
 * other is not — and the removal of the shell's bookkeeping keys.
 */
import { mergeProfiles } from "../profiles/domain.js";
import type { ProfileRow } from "../profiles/schema.js";

/** Profile type of the shell that carries a not-yet-identified visitor's events. */
export const ANONYMOUS_PROFILE_TYPE = "anonymous";

export const VISITOR_STATUSES = ["anonymous", "merged"] as const;
export type VisitorStatus = (typeof VISITOR_STATUSES)[number];

/**
 * Bookkeeping the shell carries about itself. These describe the shell, not the person,
 * so they must not survive into the known profile — `anonymous: true` on a customer who
 * has just logged in would be actively wrong, and every downstream segment would read it.
 */
export const SHELL_ONLY_ATTRIBUTES = ["anonymous", "visitorKeyHash", "mergedInto"] as const;

export interface StitchInput {
  visitorStatus: string;
  anonymous: ProfileRow;
  known: ProfileRow;
}

/**
 * Reject a stitch that would corrupt the graph. Returns null when the merge is legal.
 *
 * `profiles/domain.ts validateMerge` cannot be reused here: it requires both sides to
 * share a profileType, and the whole point of this operation is that they do not.
 */
export function validateStitch(input: StitchInput): string | null {
  const { visitorStatus, anonymous, known } = input;

  if (visitorStatus !== "anonymous") {
    // Re-stitching a merged visitor would move events out of the profile that already
    // owns them, so this is refused rather than treated as idempotent.
    return "visitor has already been stitched";
  }
  if (anonymous.id === known.id) {
    return "cannot stitch a visitor into its own anonymous profile";
  }
  if (anonymous.tenantId !== known.tenantId) {
    return "cannot stitch profiles from different tenants";
  }
  if (anonymous.profileType === "merged") {
    return "anonymous profile has already been merged";
  }
  if (known.profileType === "merged") {
    return "target profile has already been merged";
  }
  if (known.profileType === ANONYMOUS_PROFILE_TYPE) {
    // Joining two shells produces a third shell and resolves nothing.
    return "target profile is itself an anonymous visitor shell";
  }
  return null;
}

export interface LineageEntry {
  source: string;
  sourceId: string;
  timestamp: string;
}

/**
 * The lineage record of the stitch.
 *
 * `sourceId` carries a truncated hash, never the raw device/cookie id: lineage is read by
 * support staff and exported in DSAR responses, and a full visitor key there is a live
 * tracking identifier. Twelve hex characters are enough to correlate with the visitor
 * register while being useless as a key.
 */
export function buildStitchLineageEntry(visitorKeyHash: string, at: Date): LineageEntry {
  return {
    source: "anonymous_stitch",
    sourceId: `visitor:${visitorKeyHash.slice(0, 12)}`,
    timestamp: at.toISOString(),
  };
}

export interface StitchPlan {
  winnerId: string;
  loserId: string;
  attributes: Record<string, unknown>;
  sourceLineage: LineageEntry[];
  lineageEntry: LineageEntry;
}

/**
 * Compute the post-stitch state of the known profile.
 *
 * Known-profile values win; anonymous values fill only the gaps (most_complete). The
 * shell's own bookkeeping keys are stripped, and the stitch is appended to lineage so the
 * join is provable later.
 */
export function planStitch(
  anonymous: ProfileRow,
  known: ProfileRow,
  visitorKeyHash: string,
  at: Date,
): StitchPlan {
  const merged = mergeProfiles(known, anonymous, { strategy: "most_complete" });

  const attributes: Record<string, unknown> = { ...merged.attributes };
  for (const key of SHELL_ONLY_ATTRIBUTES) {
    // Only drop a shell key the known profile did not itself assert.
    if (!Object.prototype.hasOwnProperty.call(known.attributes, key)) {
      delete attributes[key];
    }
  }

  const lineageEntry = buildStitchLineageEntry(visitorKeyHash, at);

  return {
    winnerId: known.id,
    loserId: anonymous.id,
    attributes,
    sourceLineage: [...merged.sourceLineage, lineageEntry],
    lineageEntry,
  };
}

/**
 * Reduce the deterministic identifier lookups to a single known profile.
 *
 * Zero matches and a split match are both refusals, not guesses. A split match (two
 * identifiers pointing at different profiles) is exactly the case the steward queue
 * exists for — auto-merging it would join two real customers on the strength of a shared
 * device.
 */
export function resolveKnownProfile(matchedProfileIds: string[]):
  | { status: "resolved"; profileId: string }
  | { status: "none" }
  | { status: "ambiguous"; profileIds: string[] } {
  const unique = [...new Set(matchedProfileIds)].sort();
  const first = unique[0];
  if (first === undefined) return { status: "none" };
  if (unique.length > 1) return { status: "ambiguous", profileIds: unique };
  return { status: "resolved", profileId: first };
}
