import type { PillVariant } from "@/app/_components/ds/StatusPill";

/**
 * GAP-PROJECTS-DASHBOARD-01 / DELAY-ANALYSIS-01 / LIST-05: the projects module
 * surfaces a project's RAG (Red/Amber/Green) health signal under several
 * different vocabularies depending on which endpoint produced it:
 *   - /projects/list uses the canonical green | amber | red
 *     (ProjectSummary.rag, project-service rag.ts).
 *   - /projects/delay-analysis emits active | review | overdue for the SAME
 *     three-level health signal (a delay-register-flavoured spelling).
 * A monitoring dashboard that bucketed these raw strings directly would put a
 * "review" row in no tile at all (so the tiles would not sum to the total) and
 * paint the RAG column with the lifecycle StatusPill instead of a real RAG
 * colour. normalizeRag folds every spelling onto the canonical green|amber|red
 * so tile counts and the RAG column agree across all three screens.
 *
 * Unknown / unmapped values return null so callers can surface them in an
 * explicit "Other" bucket rather than silently miscounting them.
 */
export type Rag = "green" | "amber" | "red";

const RAG_ALIASES: Record<string, Rag> = {
  green: "green",
  active: "green",
  "on track": "green",
  ontrack: "green",
  amber: "amber",
  review: "amber",
  "at risk": "amber",
  atrisk: "amber",
  yellow: "amber",
  red: "red",
  overdue: "red",
  delayed: "red",
};

export function normalizeRag(raw: string | null | undefined): Rag | null {
  if (raw === null || raw === undefined) return null;
  const key = raw.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  return RAG_ALIASES[key] ?? null;
}

/** Human label for a RAG value, e.g. for the pill text (never colour-only). */
export function ragLabel(rag: Rag | null): string {
  switch (rag) {
    case "green":
      return "Green";
    case "amber":
      return "Amber";
    case "red":
      return "Red";
    default:
      return "—";
  }
}

/** The design-system pill tone for a RAG value (green->good, amber->warn, red->bad). */
export function ragPillVariant(rag: Rag | null): PillVariant {
  switch (rag) {
    case "green":
      return "good";
    case "amber":
      return "warn";
    case "red":
      return "bad";
    default:
      return "info";
  }
}
