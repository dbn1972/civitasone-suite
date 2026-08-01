/**
 * identity/resolution-domain.ts — CDP-002 + CR-CDP-02
 * Pure functions for identity resolution:
 * - Deterministic: exact hash match
 * - Probabilistic: Jaro-Winkler name similarity > 0.85
 * - Phonetic: Soundex algorithm for approximate name matching
 */

export interface Identifier {
  type: string;
  value: string;
}

export interface GraphEntry {
  profileId: string;
  identifierType: string;
  identifierHash: string;
  confidence: number;
}

export interface ResolutionResult {
  matchedProfileId: string | null;
  confidence: number;
  matchType: "deterministic" | "probabilistic" | "phonetic" | "none";
  candidates: Array<{ profileId: string; confidence: number; matchType: string }>;
}

/**
 * Jaro similarity between two strings.
 * Returns a value between 0.0 (no similarity) and 1.0 (identical).
 */
export function jaroSimilarity(s1: string, s2: string): number {
  if (s1 === s2) return 1.0;
  if (s1.length === 0 || s2.length === 0) return 0.0;

  const matchDistance = Math.floor(Math.max(s1.length, s2.length) / 2) - 1;
  const s1Matches = new Array<boolean>(s1.length).fill(false);
  const s2Matches = new Array<boolean>(s2.length).fill(false);

  let matches = 0;
  let transpositions = 0;

  for (let i = 0; i < s1.length; i++) {
    const start = Math.max(0, i - matchDistance);
    const end = Math.min(i + matchDistance + 1, s2.length);

    for (let j = start; j < end; j++) {
      if (s2Matches[j] || s1[i] !== s2[j]) continue;
      s1Matches[i] = true;
      s2Matches[j] = true;
      matches++;
      break;
    }
  }

  if (matches === 0) return 0.0;

  let k = 0;
  for (let i = 0; i < s1.length; i++) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k++;
    if (s1[i] !== s2[k]) transpositions++;
    k++;
  }

  return (
    (matches / s1.length + matches / s2.length + (matches - transpositions / 2) / matches) / 3
  );
}

/**
 * Jaro-Winkler similarity — adds prefix bonus to Jaro.
 * Returns value between 0.0 and 1.0.
 */
export function jaroWinkler(s1: string, s2: string): number {
  const jaro = jaroSimilarity(s1, s2);

  // Prefix length (up to 4 characters)
  let prefixLen = 0;
  const maxPrefix = Math.min(4, Math.min(s1.length, s2.length));
  for (let i = 0; i < maxPrefix; i++) {
    if (s1[i] === s2[i]) {
      prefixLen++;
    } else {
      break;
    }
  }

  const p = 0.1; // Winkler scaling factor
  return jaro + prefixLen * p * (1 - jaro);
}

/**
 * Soundex phonetic algorithm — encodes a name into a 4-character code.
 * Names that sound alike produce the same code.
 */
export function soundex(name: string): string {
  const input = name.toUpperCase().replace(/[^A-Z]/g, "");
  if (input.length === 0) return "0000";

  const firstLetter = input[0]!;
  const codes: Record<string, string> = {
    B: "1", F: "1", P: "1", V: "1",
    C: "2", G: "2", J: "2", K: "2", Q: "2", S: "2", X: "2", Z: "2",
    D: "3", T: "3",
    L: "4",
    M: "5", N: "5",
    R: "6",
  };

  let result = firstLetter;
  let lastCode = codes[firstLetter] ?? "0";

  for (let i = 1; i < input.length && result.length < 4; i++) {
    const char = input[i]!;
    const code = codes[char];
    if (code && code !== lastCode) {
      result += code;
      lastCode = code;
    } else if (!code) {
      // Vowels and H/W/Y reset the lastCode tracking
      lastCode = "0";
    }
  }

  return result.padEnd(4, "0");
}

/**
 * Phonetic name match using Soundex.
 * Returns true if both names produce the same Soundex code.
 */
export function phoneticMatch(nameA: string, nameB: string): boolean {
  if (!nameA || !nameB) return false;
  return soundex(nameA) === soundex(nameB);
}

/** Threshold for probabilistic matching (Jaro-Winkler). */
export const PROBABILISTIC_THRESHOLD = 0.85;

/**
 * Resolve identity against an existing graph.
 * 1. Deterministic: exact hash match on identifiers
 * 2. Probabilistic: Jaro-Winkler similarity on name identifiers > 0.85
 * 3. Phonetic: Soundex match for approximate name matching
 */
export function resolveIdentity(
  identifiers: Identifier[],
  existingGraph: GraphEntry[],
): ResolutionResult {
  const candidates = new Map<string, { confidence: number; matchType: string }>();

  // --- Phase 1: Deterministic (exact hash match) ---
  for (const ident of identifiers) {
    for (const entry of existingGraph) {
      if (entry.identifierHash === hashForResolution(ident.type, ident.value)) {
        const existing = candidates.get(entry.profileId);
        const newConf = Math.max(existing?.confidence ?? 0, entry.confidence);
        candidates.set(entry.profileId, { confidence: newConf, matchType: "deterministic" });
      }
    }
  }

  // If we have a single deterministic match with high confidence, return immediately
  if (candidates.size === 1) {
    const [[profileId, data]] = [...candidates.entries()] as [[string, { confidence: number; matchType: string }]];
    return {
      matchedProfileId: profileId,
      confidence: data.confidence,
      matchType: "deterministic",
      candidates: [{ profileId, confidence: data.confidence, matchType: data.matchType }],
    };
  }

  // --- Phase 2: Probabilistic (Jaro-Winkler on name-type identifiers) ---
  const nameIdentifiers = identifiers.filter((i) => i.type === "name" || i.type === "fullName");
  const nameEntries = existingGraph.filter((e) => e.identifierType === "name" || e.identifierType === "fullName");

  for (const ident of nameIdentifiers) {
    for (const entry of nameEntries) {
      // We compare value with a decoded hash (in practice, store raw for name matching)
      // Here we treat identifierHash as the normalized name for probabilistic comparison
      const similarity = jaroWinkler(
        ident.value.toLowerCase().trim(),
        entry.identifierHash.toLowerCase().trim(),
      );
      if (similarity >= PROBABILISTIC_THRESHOLD) {
        const existing = candidates.get(entry.profileId);
        if (!existing || similarity > existing.confidence) {
          candidates.set(entry.profileId, { confidence: similarity, matchType: "probabilistic" });
        }
      }
    }
  }

  // --- Phase 3: Phonetic (Soundex fallback for name identifiers) ---
  if (candidates.size === 0 && nameIdentifiers.length > 0) {
    for (const ident of nameIdentifiers) {
      for (const entry of nameEntries) {
        if (phoneticMatch(ident.value, entry.identifierHash)) {
          const existing = candidates.get(entry.profileId);
          if (!existing) {
            candidates.set(entry.profileId, { confidence: 0.75, matchType: "phonetic" });
          }
        }
      }
    }
  }

  // Build result
  const sortedCandidates = [...candidates.entries()]
    .map(([profileId, data]) => ({ profileId, confidence: data.confidence, matchType: data.matchType }))
    .sort((a, b) => b.confidence - a.confidence);

  if (sortedCandidates.length === 0) {
    return { matchedProfileId: null, confidence: 0, matchType: "none", candidates: [] };
  }

  const best = sortedCandidates[0]!;
  return {
    matchedProfileId: best.confidence >= PROBABILISTIC_THRESHOLD ? best.profileId : null,
    confidence: best.confidence,
    matchType: best.matchType as ResolutionResult["matchType"],
    candidates: sortedCandidates,
  };
}

/**
 * Simple hash for resolution comparison. In real code this would match
 * the hashIdentifier function from domain.ts — here it's a normalized form
 * for deterministic matching within this pure function.
 */
function hashForResolution(type: string, value: string): string {
  // Normalize the same way as hashIdentifier in domain.ts
  const trimmed = value.trim();
  let normalized: string;
  switch (type) {
    case "email":
      normalized = trimmed.toLowerCase();
      break;
    case "phone": {
      const digits = trimmed.replace(/\D/g, "");
      normalized = digits.length > 10 ? digits.slice(-10) : digits;
      break;
    }
    default:
      normalized = trimmed.toLowerCase();
      break;
  }
  return `${type}:${normalized}`;
}
