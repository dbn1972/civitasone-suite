/**
 * Redline Versioning — pure domain logic.
 *
 * Implements a character-level diff algorithm that tracks insertions and deletions
 * between contract versions with actor and timestamp attribution.
 *
 * Property: applying all redlines from version 1 through N produces content of version N.
 */

export interface Redline {
  position: number;
  type: "insert" | "delete";
  content: string;
  actor: string;
  timestamp: Date;
}

/** Maximum number of versions per contract. */
export const MAX_VERSIONS_PER_CONTRACT = 100;

export class VersionDomainError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "VersionDomainError";
  }
}

/**
 * Compute redlines (insertions/deletions) between two versions of content.
 * Uses a word-level diff to produce meaningful change records.
 *
 * @param oldContent - The previous version content
 * @param newContent - The new version content
 * @param actor - UUID of the actor making the change
 * @returns Array of Redline records with position, type, content, actor, and timestamp
 */
export function computeRedlines(oldContent: string, newContent: string, actor: string): Redline[] {
  const now = new Date();
  const oldTokens = tokenize(oldContent);
  const newTokens = tokenize(newContent);

  // Compute LCS using dynamic programming on tokens
  const lcs = computeLcs(oldTokens, newTokens);
  const redlines: Redline[] = [];

  let oldIdx = 0;
  let newIdx = 0;
  let position = 0; // position in the old content stream

  for (const lcsToken of lcs) {
    // Process deletions: tokens in old but not matched to LCS
    while (oldIdx < oldTokens.length && oldTokens[oldIdx] !== lcsToken) {
      redlines.push({
        position,
        type: "delete",
        content: oldTokens[oldIdx]!,
        actor,
        timestamp: now,
      });
      position += oldTokens[oldIdx]!.length;
      oldIdx++;
    }

    // Process insertions: tokens in new but not matched to LCS
    while (newIdx < newTokens.length && newTokens[newIdx] !== lcsToken) {
      redlines.push({
        position,
        type: "insert",
        content: newTokens[newIdx]!,
        actor,
        timestamp: now,
      });
      newIdx++;
    }

    // Advance past the common token
    if (oldIdx < oldTokens.length) {
      position += oldTokens[oldIdx]!.length;
      oldIdx++;
    }
    newIdx++;
  }

  // Remaining deletions after LCS exhausted
  while (oldIdx < oldTokens.length) {
    redlines.push({
      position,
      type: "delete",
      content: oldTokens[oldIdx]!,
      actor,
      timestamp: now,
    });
    position += oldTokens[oldIdx]!.length;
    oldIdx++;
  }

  // Remaining insertions after LCS exhausted
  while (newIdx < newTokens.length) {
    redlines.push({
      position,
      type: "insert",
      content: newTokens[newIdx]!,
      actor,
      timestamp: now,
    });
    newIdx++;
  }

  return redlines;
}

/**
 * Apply redlines to a base content to produce the resulting content.
 * Processes deletions and insertions in order of position.
 *
 * @param baseContent - The content to apply redlines against
 * @param redlineChanges - Array of redlines to apply
 * @returns The resulting content after applying all redlines
 */
export function applyRedlines(baseContent: string, redlineChanges: Redline[]): string {
  if (redlineChanges.length === 0) return baseContent;

  // Sort redlines by position (stable), deletions before insertions at same position
  const sorted = [...redlineChanges].sort((a, b) => {
    if (a.position !== b.position) return a.position - b.position;
    // Deletions come before insertions at same position
    if (a.type === "delete" && b.type === "insert") return -1;
    if (a.type === "insert" && b.type === "delete") return 1;
    return 0;
  });

  const tokens = tokenize(baseContent);
  const result: string[] = [];
  let tokenPos = 0;  // cumulative character position
  let tokenIdx = 0;  // current token index
  let sortedIdx = 0; // current redline index

  while (tokenIdx < tokens.length || sortedIdx < sorted.length) {
    // Process any redlines at current position
    while (sortedIdx < sorted.length && sorted[sortedIdx]!.position <= tokenPos) {
      const rl = sorted[sortedIdx]!;
      if (rl.position === tokenPos) {
        if (rl.type === "delete") {
          // Skip the token (it's being deleted)
          if (tokenIdx < tokens.length) {
            tokenPos += tokens[tokenIdx]!.length;
            tokenIdx++;
          }
          sortedIdx++;
          continue;
        } else {
          // Insert content at this position
          result.push(rl.content);
        }
      }
      sortedIdx++;
    }

    // Copy unmodified token
    if (tokenIdx < tokens.length) {
      // Check if this token should be deleted
      if (sortedIdx < sorted.length && sorted[sortedIdx]!.position === tokenPos && sorted[sortedIdx]!.type === "delete") {
        // Will be processed in next iteration
        continue;
      }
      result.push(tokens[tokenIdx]!);
      tokenPos += tokens[tokenIdx]!.length;
      tokenIdx++;
    } else {
      break;
    }
  }

  // Remaining insertions at end
  while (sortedIdx < sorted.length) {
    if (sorted[sortedIdx]!.type === "insert") {
      result.push(sorted[sortedIdx]!.content);
    }
    sortedIdx++;
  }

  return result.join("");
}

/**
 * Tokenize content into words and whitespace segments for diff.
 * Each token is either a word or a whitespace sequence.
 */
function tokenize(content: string): string[] {
  if (content === "") return [];
  // Split on word boundaries, keeping whitespace as separate tokens
  const tokens: string[] = [];
  const regex = /(\S+|\s+)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    tokens.push(match[1]!);
  }
  return tokens;
}

/**
 * Compute Longest Common Subsequence of two token arrays.
 * Uses standard DP approach.
 */
function computeLcs(a: string[], b: string[]): string[] {
  const m = a.length;
  const n = b.length;

  // Optimize for large inputs using only 2 rows
  if (m === 0 || n === 0) return [];

  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0) as number[]);

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i]![j] = dp[i - 1]![j - 1]! + 1;
      } else {
        dp[i]![j] = Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
      }
    }
  }

  // Backtrack to find LCS
  const lcs: string[] = [];
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      lcs.unshift(a[i - 1]!);
      i--;
      j--;
    } else if (dp[i - 1]![j]! > dp[i]![j - 1]!) {
      i--;
    } else {
      j--;
    }
  }

  return lcs;
}
