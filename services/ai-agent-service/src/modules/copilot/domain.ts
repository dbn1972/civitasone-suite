/**
 * copilot/domain.ts — prompt validation, citation assembly, latency bucketing.
 * Pure functions only.
 */

export const MAX_PROMPT_LENGTH = 16000;
export const MAX_CITATIONS = 10;

/** Returns null when the prompt is acceptable, else an error message. */
export function validatePrompt(prompt: unknown): string | null {
  if (typeof prompt !== "string") return "prompt must be a string";
  if (prompt.trim().length === 0) return "prompt must not be empty";
  if (prompt.length > MAX_PROMPT_LENGTH) {
    return `prompt must be at most ${MAX_PROMPT_LENGTH} characters`;
  }
  return null;
}

export type CitationSource = {
  id: string;
  title?: string | null | undefined;
  url?: string | null | undefined;
  score?: number | null | undefined;
};

/** Object type alias (not an interface) so it keeps an implicit index signature
 * and can be stored directly into a jsonb column typed Record<string, unknown>. */
export type Citation = {
  id: string;
  title: string;
  url: string | null;
  score: number | null;
};

/**
 * Normalise retrieval sources into citations: drop entries without an id,
 * dedupe by id (first occurrence wins), cap at MAX_CITATIONS.
 */
export function buildCitations(sources: CitationSource[]): Citation[] {
  const seen = new Set<string>();
  const out: Citation[] = [];

  for (const s of sources) {
    if (typeof s?.id !== "string" || s.id.trim().length === 0) continue;
    if (seen.has(s.id)) continue;
    seen.add(s.id);
    out.push({
      id: s.id,
      title: s.title ?? s.id,
      url: s.url ?? null,
      score: typeof s.score === "number" ? s.score : null,
    });
    if (out.length >= MAX_CITATIONS) break;
  }

  return out;
}

export type LatencyBucket = "fast" | "normal" | "slow";

/** <500ms fast, <2000ms normal, otherwise slow. Negative input clamps to fast. */
export function computeLatencyBucket(ms: number): LatencyBucket {
  if (!Number.isFinite(ms) || ms < 500) return "fast";
  if (ms < 2000) return "normal";
  return "slow";
}
