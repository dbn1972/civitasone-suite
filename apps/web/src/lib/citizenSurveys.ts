// Client-safe survey types + pure helpers (no next/headers). Imported by client
// components; app/_data/loaders.ts re-exports for server callers.

export type CitizenSurvey = {
  id: string;
  surveyName: string;
  responses: number;
  completion: string;
  period: string;
  status: string;
};

/**
 * GAP-CITIZEN-SURVEYS-03: survey status is a free string from the service, so
 * strict equality to "Active"/"Completed" miscounts "active", " Active ",
 * "ACTIVE". Normalise before counting.
 */
export function normalizeSurveyStatus(status: string): "active" | "completed" | "other" {
  const s = status.trim().toLowerCase();
  if (s === "active" || s === "open" || s === "running") return "active";
  if (s === "completed" || s === "closed" || s === "ended") return "completed";
  return "other";
}

/**
 * GAP-CITIZEN-SURVEYS-04: completion is a free string ("72%", "72 %", "—").
 * Parse to a 0-100 number for correct numeric sorting and a progress bar;
 * returns null when it can't be parsed (shown as a plain dash, sorts last).
 */
export function parseCompletionPct(completion: string): number | null {
  const m = completion.replace(/\s+/g, "").match(/^(\d+(?:\.\d+)?)%?$/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, n));
}

/** GAP-CITIZEN-SURVEYS-01/02/03: pure survey summary shared by card + table. */
export interface SurveySummary {
  active: number;
  completed: number;
  other: number;
  total: number;
  totalResponses: number;
}

export function summarizeSurveys(rows: CitizenSurvey[]): SurveySummary {
  let active = 0;
  let completed = 0;
  let other = 0;
  let totalResponses = 0;
  for (const s of rows) {
    const kind = normalizeSurveyStatus(s.status);
    if (kind === "active") active += 1;
    else if (kind === "completed") completed += 1;
    else other += 1;
    totalResponses += s.responses;
  }
  return { active, completed, other, total: rows.length, totalResponses };
}
