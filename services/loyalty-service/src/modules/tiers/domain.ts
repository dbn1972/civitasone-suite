/**
 * tiers/domain.ts — Pure domain logic for tier evaluation and progression.
 * Evaluates tier based on cumulative earn, handles upgrade/downgrade, grace periods.
 */

export interface TierDef {
  id: string;
  name: string;
  level: number;
  minPointsThreshold: bigint;
}

export interface TierEvaluationResult {
  newTierId: string;
  newTierName: string;
  newLevel: number;
  changed: boolean;
  direction: "upgrade" | "downgrade" | "none";
}

/**
 * Evaluate which tier a member qualifies for based on lifetime points.
 * Tiers are sorted by level ascending; the highest qualifying tier wins.
 */
export function evaluateTier(
  lifetimePoints: bigint,
  tierDefs: TierDef[],
  currentTierId: string | null,
): TierEvaluationResult {
  if (tierDefs.length === 0) {
    return { newTierId: "", newTierName: "base", newLevel: 0, changed: false, direction: "none" };
  }

  const sorted = [...tierDefs].sort((a, b) => b.level - a.level);

  // Find the highest tier the member qualifies for
  let qualifiedTier: TierDef | null = null;
  for (const tier of sorted) {
    if (lifetimePoints >= tier.minPointsThreshold) {
      qualifiedTier = tier;
      break;
    }
  }

  // Default to lowest tier if none qualified
  if (!qualifiedTier) {
    const lowest = sorted[sorted.length - 1]!;
    qualifiedTier = lowest;
  }

  const changed = qualifiedTier.id !== currentTierId;
  let direction: "upgrade" | "downgrade" | "none" = "none";

  if (changed && currentTierId) {
    const currentDef = tierDefs.find((t) => t.id === currentTierId);
    if (currentDef) {
      direction = qualifiedTier.level > currentDef.level ? "upgrade" : "downgrade";
    } else {
      direction = "upgrade";
    }
  } else if (changed && !currentTierId) {
    direction = "upgrade";
  }

  return {
    newTierId: qualifiedTier.id,
    newTierName: qualifiedTier.name,
    newLevel: qualifiedTier.level,
    changed,
    direction,
  };
}

/**
 * Determine if a downgrade should be blocked by grace period.
 * @param lastUpgradeDate - When the member last upgraded
 * @param gracePeriodDays - Days of protection from downgrade
 * @param now - Current time
 */
export function isInGracePeriod(
  lastUpgradeDate: Date | null,
  gracePeriodDays: number,
  now: Date = new Date(),
): boolean {
  if (!lastUpgradeDate || gracePeriodDays <= 0) return false;
  const graceEnd = new Date(lastUpgradeDate.getTime());
  graceEnd.setDate(graceEnd.getDate() + gracePeriodDays);
  return now < graceEnd;
}

/**
 * Check if a tier assignment has expired.
 */
export function isTierExpired(expiresAt: Date | null | undefined, now: Date = new Date()): boolean {
  if (!expiresAt) return false;
  return now > expiresAt;
}
