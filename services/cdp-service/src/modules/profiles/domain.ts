/**
 * profiles/domain.ts — Merge logic with survivorship rules.
 * Default strategy: "newest wins" per attribute, configurable via survivorship config.
 */
import type { ProfileRow } from "./schema.js";

export type SurvivorshipStrategy = "newest" | "most_complete" | "source_priority";

export interface MergeConfig {
  strategy: SurvivorshipStrategy;
  /** Optional ordered list of source names by priority (highest first). */
  sourcePriority?: string[];
}

const DEFAULT_CONFIG: MergeConfig = { strategy: "newest" };

/**
 * Merge two profiles: winner keeps its data, loser's attributes fill gaps.
 * Returns merged attributes and updated source lineage.
 */
export function mergeProfiles(
  winner: ProfileRow,
  loser: ProfileRow,
  config: MergeConfig = DEFAULT_CONFIG,
): { attributes: Record<string, unknown>; sourceLineage: Array<{ source: string; sourceId: string; timestamp: string }> } {
  const merged = { ...loser.attributes, ...winner.attributes };

  // For "newest" strategy: winner's attributes always take precedence (already done above)
  // For "most_complete": prefer whichever has more non-null values per key
  if (config.strategy === "most_complete") {
    for (const key of Object.keys(loser.attributes)) {
      if (merged[key] === undefined || merged[key] === null || merged[key] === "") {
        const loserVal = loser.attributes[key];
        if (loserVal !== undefined && loserVal !== null && loserVal !== "") {
          merged[key] = loserVal;
        }
      }
    }
  }

  // Combine source lineage (deduplicate by sourceId)
  const combinedLineage = [...winner.sourceLineage];
  const existingSourceIds = new Set(combinedLineage.map((s) => s.sourceId));
  for (const entry of loser.sourceLineage) {
    if (!existingSourceIds.has(entry.sourceId)) {
      combinedLineage.push(entry);
      existingSourceIds.add(entry.sourceId);
    }
  }

  return { attributes: merged, sourceLineage: combinedLineage };
}

/**
 * Validate that a merge operation is valid.
 * Returns null if valid, or an error message if invalid.
 */
export function validateMerge(winner: ProfileRow, loser: ProfileRow): string | null {
  if (winner.id === loser.id) return "cannot merge a profile with itself";
  if (winner.tenantId !== loser.tenantId) return "cannot merge profiles from different tenants";
  if (winner.profileType !== loser.profileType) return "cannot merge profiles of different types";
  return null;
}

/**
 * Compute a confidence score for a profile match based on overlapping attributes.
 * Returns a value between 0 and 1.
 */
export function computeMatchConfidence(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
  weights: Record<string, number> = { email: 0.4, phone: 0.3, name: 0.2, externalId: 0.5 },
): number {
  let totalWeight = 0;
  let matchedWeight = 0;

  for (const [key, weight] of Object.entries(weights)) {
    const aVal = a[key];
    const bVal = b[key];
    if (aVal !== undefined && bVal !== undefined) {
      totalWeight += weight;
      if (aVal === bVal) {
        matchedWeight += weight;
      }
    }
  }

  return totalWeight > 0 ? matchedWeight / totalWeight : 0;
}
