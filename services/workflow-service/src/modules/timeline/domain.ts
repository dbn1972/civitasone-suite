/**
 * CAP-037 — unified per-entity timeline (pure domain).
 *
 * A timeline entry is a normalized activity record from one of several sources
 * (workflow transitions, comments, deviations, closure lifecycle). This module
 * merges heterogeneous source rows into one chronological stream.
 */

export type TimelineSource = "transition" | "comment" | "deviation" | "closure" | "case_link";

export interface TimelineEntry {
  source: TimelineSource;
  id: string;
  at: string; // ISO-8601
  actorId: string | null;
  action: string;
  summary: string;
  detail: Record<string, unknown>;
}

/**
 * Merge N pre-mapped entry lists into one stream, newest first. A stable
 * tiebreak on (at, source, id) keeps ordering deterministic when timestamps
 * collide (e.g. events written in the same transaction).
 */
export function mergeTimeline(...lists: TimelineEntry[][]): TimelineEntry[] {
  const all = lists.flat();
  all.sort((a, b) => {
    const ta = Date.parse(a.at);
    const tb = Date.parse(b.at);
    if (tb !== ta) return tb - ta;
    if (a.source !== b.source) return a.source < b.source ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return all;
}
