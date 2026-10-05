/** Pure scoring for GET /internal/v1/scan-link/lookup (name fuzzy match). */
export function normName(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

export function nameTokens(s: string): string[] {
  return normName(s).split(" ").filter((t) => t.length >= 2);
}

/** Escape LIKE metacharacters so user text is matched literally. */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => "\\" + c);
}

/**
 * Confidence for a name match: equal normalised names 0.9; every query token present 0.7;
 * a proportional share of tokens otherwise (never above 0.6). Always < 1: only an exact employee
 * number match is 1.0. Returns 0 for no overlap.
 */
export function nameConfidence(query: string, candidate: string): number {
  const q = nameTokens(query);
  if (q.length === 0) return 0;
  if (normName(query) === normName(candidate)) return 0.9;
  const cand = new Set(nameTokens(candidate));
  const candJoined = normName(candidate);
  const hit = q.filter((t) => cand.has(t) || candJoined.includes(t)).length;
  if (hit === 0) return 0;
  if (hit === q.length) return 0.7;
  return Math.round(((0.6 * hit) / q.length) * 100) / 100;
}

export function candidateLabel(employeeNo: string, fullName: string): string {
  return `${employeeNo} - ${fullName}`.slice(0, 300);
}
