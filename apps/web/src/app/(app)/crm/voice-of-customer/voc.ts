import type { CRMVocSummary, CRMVocTheme } from "@civitasone/types";

/** Human labels for the theme keys the scorer emits. */
const THEME_LABELS: Record<string, string> = {
  delay: "Delays",
  billing: "Billing & payments",
  staff_conduct: "Staff conduct",
  service_quality: "Service quality",
  documentation: "Documentation",
  accessibility: "Portal & access",
  corruption: "Integrity concerns",
  communication: "Communication",
};

export function themeLabel(theme: string): string {
  return THEME_LABELS[theme] ?? theme.replace(/_/g, " ");
}

/**
 * Overall standing, banded for display. Deliberately mirrors the server's own
 * neutral band so the headline never contradicts the per-interaction readings.
 */
export type Mood = "positive" | "neutral" | "negative" | "unknown";

export function moodOf(summary: CRMVocSummary): Mood {
  if (summary.total === 0) return "unknown";
  if (summary.averageScore > 15) return "positive";
  if (summary.averageScore < -15) return "negative";
  return "neutral";
}

export const MOOD_LABEL: Record<Mood, string> = {
  positive: "Positive",
  neutral: "Mixed",
  negative: "Negative",
  unknown: "No data",
};

export const MOOD_ICON: Record<Mood, string> = {
  positive: "🙂",
  neutral: "😐",
  negative: "🙁",
  unknown: "—",
};

export const MOOD_ICON_BG: Record<Mood, string> = {
  positive: "#dcfce7",
  neutral: "#fef3c7",
  negative: "#fee2e2",
  unknown: "#e5e7eb",
};

/** Share of a polarity as a whole percentage. 0 when nothing has been scored. */
export function shareOf(
  summary: CRMVocSummary,
  polarity: keyof CRMVocSummary["byPolarity"],
): number {
  if (summary.total === 0) return 0;
  return Math.round((summary.byPolarity[polarity] / summary.total) * 100);
}

export interface RankedTheme extends CRMVocTheme {
  /** Share of all scored interactions that touched this theme, 0-100. */
  sharePct: number;
  /** Share of this theme's own mentions that were negative, 0-100. */
  negativePct: number;
}

/**
 * Themes ordered by how often they came up.
 *
 * `negativePct` is the column that matters: a theme mentioned constantly but
 * rarely negatively is business as usual, whereas one mentioned less often but
 * almost always angrily is the thing to fix.
 */
export function rankThemes(summary: CRMVocSummary): RankedTheme[] {
  return summary.themes.map((t) => ({
    ...t,
    sharePct:
      summary.total === 0 ? 0 : Math.round((t.count / summary.total) * 100),
    negativePct:
      t.count === 0 ? 0 : Math.round((t.negativeCount / t.count) * 100),
  }));
}

/**
 * The theme most worth acting on: the one with the highest negative count, ties
 * broken by how negative it is proportionally. Null when nothing is negative —
 * "no top concern" is a real answer and should not be faked with the first row.
 */
export function topConcern(summary: CRMVocSummary): RankedTheme | null {
  const withNegatives = rankThemes(summary).filter((t) => t.negativeCount > 0);
  if (withNegatives.length === 0) return null;
  return withNegatives.sort(
    (a, b) =>
      b.negativeCount - a.negativeCount || b.negativePct - a.negativePct,
  )[0] as RankedTheme;
}
