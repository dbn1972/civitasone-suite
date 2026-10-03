import { categoryOfApplication, type RosterCategory } from "./reservationCategories";

/** One screened-eligible application offered to the reservation shortlist. */
export type ShortlistCandidate = { id: string; label: string; category: string | null | undefined };

export type ShortlistRow = ShortlistCandidate & { normalised: RosterCategory | null; score: string };

export type ShortlistProblem = "no_category" | "unmapped_category" | "no_score" | "bad_score";

/**
 * A row can only enter the computation with a recognised vertical category and a numeric merit score.
 * An unrecognised or missing category FAILS CLOSED (it is reported, never treated as UR) -- the service
 * enforces the same rule (422 UNMAPPED_CATEGORY), this just says so before the round trip.
 */
export function rowProblem(r: ShortlistRow): ShortlistProblem | null {
  if (!(r.category ?? "").trim()) return "no_category";
  if (r.normalised === null) return "unmapped_category";
  if (r.score.trim() === "") return "no_score";
  const n = Number(r.score);
  if (!Number.isFinite(n) || n < 0) return "bad_score";
  return null;
}

export function toRows(cands: readonly ShortlistCandidate[], scores: Record<string, string>): ShortlistRow[] {
  return cands.map((c) => ({ ...c, normalised: categoryOfApplication(c.category), score: scores[c.id] ?? "" }));
}

export type ShortlistRequest = { candidates: Array<{ applicationId: string; category: RosterCategory; score: number }> };

export function buildShortlistRequest(rows: readonly ShortlistRow[]): { ok: true; body: ShortlistRequest } | { ok: false; problems: Array<{ id: string; problem: ShortlistProblem }> } {
  const problems = rows.flatMap((r) => { const p = rowProblem(r); return p ? [{ id: r.id, problem: p }] : []; });
  if (problems.length > 0) return { ok: false, problems };
  if (rows.length === 0) return { ok: false, problems: [] };
  return { ok: true, body: { candidates: rows.map((r) => ({ applicationId: r.id, category: r.normalised as RosterCategory, score: Number(r.score) })) } };
}
