/**
 * GAP-HR-APAR-DETAIL-03 (fix step 3): the Reviewing Officer's concur / vary
 * decision, and any score variations, live only in the stage-history row for
 * the reviewing_officer -> accepting_authority transition
 * (apar/f3-consumer.ts writes `payload: { decision, variations }`); the
 * appraisal row itself keeps just the free-text remarks. This reads them back
 * out so the detail page can show what the Reviewing Officer decided.
 *
 * The API strips that payload for the appraisee before disclosure, so for them
 * this simply returns null and nothing is rendered.
 */

export type ReviewingDecisionKind = "concur" | "vary";

export interface ScoreVariation {
  attribute: string;
  score: number;
}

export interface ReviewingDecision {
  decision: ReviewingDecisionKind;
  variations: ScoreVariation[];
}

interface HistoryLike {
  fromStage: string | null;
  toStage: string;
  payload?: unknown;
}

function asVariations(raw: unknown): ScoreVariation[] {
  if (!Array.isArray(raw)) return [];
  const out: ScoreVariation[] = [];
  for (const v of raw) {
    if (v && typeof v === "object") {
      const { attribute, score } = v as Record<string, unknown>;
      if (typeof attribute === "string" && attribute.length > 0 && typeof score === "number" && Number.isFinite(score)) {
        out.push({ attribute, score });
      }
    }
  }
  return out;
}

/** The latest recorded Reviewing Officer decision, or null when none is visible. */
export function reviewingDecisionFromHistory(history: readonly HistoryLike[]): ReviewingDecision | null {
  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i]!;
    if (h.fromStage !== "reviewing_officer" || h.toStage !== "accepting_authority") continue;
    const payload = h.payload;
    if (!payload || typeof payload !== "object") continue;
    const decision = (payload as Record<string, unknown>).decision;
    if (decision !== "concur" && decision !== "vary") continue;
    return {
      decision,
      variations: decision === "vary" ? asVariations((payload as Record<string, unknown>).variations) : [],
    };
  }
  return null;
}
