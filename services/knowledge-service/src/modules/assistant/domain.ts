/**
 * SVC-127 — pure domain logic for the virtual assistant & guided support.
 *
 * Citation assembly, grounding-context assembly, deflection-metric maths and
 * guided-flow step normalisation are all pure functions (no I/O) so they can be
 * unit-tested exhaustively.
 */

export type GroundingKind = "document" | "policy" | "faq";

export interface GroundingSource {
  id: string;
  title: string;
  body: string;
  source: GroundingKind;
}

export interface Citation {
  docId: string;
  title: string;
  source: GroundingKind;
}

/** One citation per grounding source, in order, deduped by (source,id). */
export function assembleCitations(sources: GroundingSource[]): Citation[] {
  const seen = new Set<string>();
  const out: Citation[] = [];
  for (const s of sources) {
    const key = `${s.source}:${s.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ docId: s.id, title: s.title, source: s.source });
  }
  return out;
}

/** Assemble a bounded grounding context string for the model prompt. */
export function buildContext(sources: GroundingSource[], maxChars = 8000): string {
  const parts: string[] = [];
  let used = 0;
  for (const s of sources) {
    const chunk = `[${s.source}:${s.id}] ${s.title}\n${s.body}`;
    if (used + chunk.length > maxChars) {
      const remaining = maxChars - used;
      if (remaining > 0) parts.push(chunk.slice(0, remaining));
      break;
    }
    parts.push(chunk);
    used += chunk.length;
  }
  return parts.join("\n\n---\n\n");
}

/**
 * Deterministic extractive fallback answer, used when the AI adapter is
 * disabled/unavailable. Returns the leading text of the top-ranked source.
 */
export function extractiveAnswer(sources: GroundingSource[], maxChars = 600): string {
  if (sources.length === 0) return "";
  const top = sources[0]!;
  const snippet = top.body.trim().slice(0, maxChars);
  return snippet.length ? snippet : top.title;
}

export interface DeflectionMetrics {
  total: number;
  answered: number;
  escalated: number;
  deflected: number;
  deflectionRate: number;
  escalationRate: number;
}

/**
 * Deflection = questions the assistant answered without escalation.
 * Rates are percentages rounded to one decimal place.
 */
export function deflectionMetrics(rows: Array<{ answered: boolean; escalated: boolean }>): DeflectionMetrics {
  const total = rows.length;
  const escalated = rows.filter((r) => r.escalated).length;
  const answered = rows.filter((r) => r.answered).length;
  const deflected = rows.filter((r) => r.answered && !r.escalated).length;
  const pct = (n: number): number => (total === 0 ? 0 : Math.round((n / total) * 1000) / 10);
  return {
    total,
    answered,
    escalated,
    deflected,
    deflectionRate: pct(deflected),
    escalationRate: pct(escalated),
  };
}

export interface FlowStep {
  order: number;
  title: string;
  instruction: string;
}

/** Assign a 1-based sequential order to guided-flow steps. */
export function normalizeSteps(steps: Array<{ title: string; instruction: string }>): FlowStep[] {
  return steps.map((s, i) => ({ order: i + 1, title: s.title, instruction: s.instruction }));
}

/** Extract keyword tokens from a natural-language question (for grounding search). */
export function extractKeyword(question: string): string {
  const stop = new Set([
    "the", "a", "an", "of", "to", "for", "how", "do", "i", "what", "is", "are",
    "can", "my", "in", "on", "and", "or", "with", "when", "where", "does",
  ]);
  const tokens = question
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !stop.has(t));
  return tokens[0] ?? question.trim().slice(0, 40);
}
