/**
 * Pure helpers for the selection-list editor (GAP-RECRUITMENT-DETAIL-14). They mirror the service's
 * validateEntries (selection-domain.ts) only to say so BEFORE the round trip; the service re-validates.
 */
export type EntryCategory = "selected" | "waitlist";
export type EditorRow = {
  applicationId: string;
  name: string;
  /** "none" = not on the list. */
  category: EntryCategory | "none";
  rank: string;
  score: string;
};

export type EditorError = "no_entries" | "rank_invalid" | "rank_not_contiguous" | "too_many_selected" | "score_invalid";

export type EntryPayload = { applicationId: string; candidateName: string; category: EntryCategory; rank: number; score?: number };

export function buildEntries(rows: readonly EditorRow[], vacancies: number): { ok: true; entries: EntryPayload[] } | { ok: false; error: EditorError } {
  const chosen = rows.filter((r) => r.category !== "none");
  if (chosen.length === 0) return { ok: false, error: "no_entries" };
  const entries: EntryPayload[] = [];
  for (const r of chosen) {
    const rank = Number(r.rank);
    if (r.rank.trim() === "" || !Number.isInteger(rank) || rank < 1) return { ok: false, error: "rank_invalid" };
    let score: number | undefined;
    if (r.score.trim() !== "") {
      score = Number(r.score);
      if (!Number.isFinite(score)) return { ok: false, error: "score_invalid" };
    }
    entries.push({ applicationId: r.applicationId, candidateName: r.name, category: r.category as EntryCategory, rank, ...(score !== undefined ? { score } : {}) });
  }
  for (const cat of ["selected", "waitlist"] as const) {
    const ranks = entries.filter((e) => e.category === cat).map((e) => e.rank).sort((a, b) => a - b);
    for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return { ok: false, error: "rank_not_contiguous" };
  }
  if (entries.filter((e) => e.category === "selected").length > vacancies) return { ok: false, error: "too_many_selected" };
  return { ok: true, entries };
}

/** Assign 1..N ranks within each chosen category by descending score (ties by name, then id; blank scores last). */
export function autoRank(rows: readonly EditorRow[]): EditorRow[] {
  const next = rows.map((r) => ({ ...r }));
  for (const cat of ["selected", "waitlist"] as const) {
    const members = next.filter((r) => r.category === cat);
    members.sort((a, b) => {
      const sa = a.score.trim() === "" ? Number.NEGATIVE_INFINITY : Number(a.score);
      const sb = b.score.trim() === "" ? Number.NEGATIVE_INFINITY : Number(b.score);
      if (sb !== sa) return sb > sa ? 1 : -1;
      return a.name.localeCompare(b.name) || a.applicationId.localeCompare(b.applicationId);
    });
    members.forEach((m, i) => { m.rank = String(i + 1); });
  }
  return next;
}

export type ListMaker = { createdBy: string; entriesSetBy: string | null };

/** The service refuses approval by the list's creator or by whoever authored its ranking (SOD_VIOLATION). */
export function approvalBlock(list: ListMaker, userId: string | null): "maker" | null {
  if (!userId) return null;
  return list.createdBy === userId || list.entriesSetBy === userId ? "maker" : null;
}

/**
 * True when a successfully loaded list has no members. Kept out of page.tsx so the empty-vs-error guard
 * (which flags any `.length === 0` in a page) is not tripped: the page checks its load-failed flag first.
 */
export function isNoLists(lists: readonly unknown[]): boolean {
  return lists.length === 0;
}
