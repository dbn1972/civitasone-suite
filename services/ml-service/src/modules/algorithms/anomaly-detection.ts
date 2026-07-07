/**
 * Anomaly Detection Module
 *
 * Provides Z-score anomaly detection for transaction scoring and
 * fuzzy duplicate detection using Levenshtein distance + multi-criteria matching.
 *
 * Requirements: 11.1, 11.2
 */

/** A financial transaction record used for duplicate detection. */
export interface TransactionRecord {
  id: string;
  amountPaise: bigint;
  vendorId: string;
  date: Date;
  description: string;
}

/** Result of duplicate detection for a single candidate. */
export interface DuplicateMatch {
  candidateId: string;
  matchScore: number;
  criteria: {
    amountMatch: boolean;
    vendorMatch: boolean;
    dateMatch: boolean;
    descriptionMatch: boolean;
  };
}

/**
 * Compute the Z-score for a value given the population mean and standard deviation.
 *
 * Formula: (value - mean) / std
 *
 * CRITICAL: When std is 0, returns 0 (never flag as anomaly).
 * This prevents division by zero and ensures that transactions in
 * categories with no variance are never flagged.
 */
export function computeZScore(value: number, mean: number, std: number): number {
  if (std === 0) {
    return 0;
  }
  return (value - mean) / std;
}

/**
 * Determine whether a Z-score indicates an anomaly.
 *
 * @param zScore - The computed Z-score value
 * @param threshold - Absolute Z-score threshold (default 3.0)
 * @returns true if |zScore| exceeds the threshold
 */
export function isAnomaly(zScore: number, threshold: number = 3.0): boolean {
  return Math.abs(zScore) > threshold;
}

/**
 * Compute the Levenshtein edit distance between two strings.
 * Classic dynamic programming implementation.
 *
 * Used for fuzzy text matching in duplicate detection (threshold ≤ 3).
 */
export function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;

  // Edge cases: one or both strings empty
  if (m === 0) return n;
  if (n === 0) return m;

  // Use two rows for space optimization: O(min(m, n)) space
  // Ensure we iterate over the longer string in the outer loop for correctness
  // Actually, standard DP with full matrix for clarity and correctness:
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array.from({ length: n + 1 }, () => 0)
  );

  // Base cases
  for (let i = 0; i <= m; i++) {
    dp[i]![0] = i;
  }
  for (let j = 0; j <= n; j++) {
    dp[0]![j] = j;
  }

  // Fill the matrix
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i]![j] = Math.min(
        dp[i - 1]![j]! + 1,       // deletion
        dp[i]![j - 1]! + 1,       // insertion
        dp[i - 1]![j - 1]! + cost // substitution
      );
    }
  }

  return dp[m]![n]!;
}

/**
 * Detect potential duplicate transactions using multi-criteria matching.
 *
 * A candidate is flagged as a duplicate ONLY if ALL 4 criteria match:
 * 1. Amount within ±1% (absolute percentage difference)
 * 2. Same vendor (vendorId exact match)
 * 3. Date within ±3 days (absolute difference in days)
 * 4. Description Levenshtein distance ≤ 3
 *
 * Edge cases:
 * - Empty candidates array: returns empty array
 * - Zero amount on both: treated as matching (0% difference)
 *
 * @param transaction - The transaction to check for duplicates
 * @param candidates - List of candidate transactions to compare against
 * @returns Array of matches where ALL 4 criteria hold
 */
export function detectDuplicates(
  transaction: TransactionRecord,
  candidates: TransactionRecord[]
): DuplicateMatch[] {
  if (candidates.length === 0) {
    return [];
  }

  const matches: DuplicateMatch[] = [];

  for (const candidate of candidates) {
    const criteria = evaluateCriteria(transaction, candidate);

    const allMatch =
      criteria.amountMatch &&
      criteria.vendorMatch &&
      criteria.dateMatch &&
      criteria.descriptionMatch;

    if (allMatch) {
      // matchScore: proportion of criteria met (always 1.0 when all match,
      // but kept as a metric for future partial-match weighting)
      const matchScore = computeMatchScore(criteria);
      matches.push({
        candidateId: candidate.id,
        matchScore,
        criteria,
      });
    }
  }

  return matches;
}

/**
 * Evaluate all 4 duplicate detection criteria between two transactions.
 */
function evaluateCriteria(
  transaction: TransactionRecord,
  candidate: TransactionRecord
): DuplicateMatch["criteria"] {
  return {
    amountMatch: isAmountWithinTolerance(transaction.amountPaise, candidate.amountPaise),
    vendorMatch: transaction.vendorId === candidate.vendorId,
    dateMatch: isDateWithinDays(transaction.date, candidate.date, 3),
    descriptionMatch: levenshteinDistance(transaction.description, candidate.description) <= 3,
  };
}

/**
 * Check if two amounts are within ±1% of each other.
 * Uses absolute percentage difference relative to the reference amount.
 *
 * When both amounts are zero, they are considered matching.
 */
function isAmountWithinTolerance(amountA: bigint, amountB: bigint): boolean {
  // Both zero: exact match
  if (amountA === 0n && amountB === 0n) {
    return true;
  }

  // If reference is zero but candidate is not, they don't match
  if (amountA === 0n) {
    return false;
  }

  // Compute absolute percentage difference: |a - b| / |a| * 100
  // Using bigint arithmetic to avoid precision loss
  const diff = amountA > amountB ? amountA - amountB : amountB - amountA;
  const absA = amountA < 0n ? -amountA : amountA;

  // diff * 100 / absA <= 1  →  diff * 100 <= absA
  return diff * 100n <= absA;
}

/**
 * Check if two dates are within a specified number of days of each other.
 */
function isDateWithinDays(dateA: Date, dateB: Date, maxDays: number): boolean {
  const msPerDay = 86_400_000; // 24 * 60 * 60 * 1000
  const diffMs = Math.abs(dateA.getTime() - dateB.getTime());
  const diffDays = diffMs / msPerDay;
  return diffDays <= maxDays;
}

/**
 * Compute a match score (0.0–1.0) based on how many criteria are satisfied.
 * When all 4 criteria match, score is 1.0.
 */
function computeMatchScore(criteria: DuplicateMatch["criteria"]): number {
  let score = 0;
  if (criteria.amountMatch) score += 0.25;
  if (criteria.vendorMatch) score += 0.25;
  if (criteria.dateMatch) score += 0.25;
  if (criteria.descriptionMatch) score += 0.25;
  return score;
}
