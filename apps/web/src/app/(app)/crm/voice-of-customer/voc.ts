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
 * GAP-CRM-VOICE-OF-CUSTOMER-04: the sentiment score is a SIGNED scale, not a
 * 0-100 one. crm-service's scorer clamps each reading to [-100, +100]
 * (sentiment/domain.ts SCORE_MIN/SCORE_MAX) and `averageScore` is the mean of
 * those signed readings, so a negative-leaning window reads below zero. The
 * "Mixed/Negative" bands at ±15 are the server's own NEUTRAL_BAND edges on the
 * same signed scale. The tile used to print "n / 100", which implies a 0-100
 * scale and reads a genuine -22 as "-22 / 100" against a floor of 0. Expose the
 * real range here so the display and the thresholds agree.
 */
export const SCORE_MIN = -100;
export const SCORE_MAX = 100;

/**
 * Format the average sentiment score on its true signed scale, e.g. "+72"
 * or "−22" on a −100…+100 range. The sign is explicit so a reader never
 * mistakes a negative mean for a low-but-positive one.
 */
export function formatAverageScore(score: number): string {
  const sign = score > 0 ? "+" : score < 0 ? "−" : "";
  return `${sign}${Math.abs(score)}`;
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
  // GAP-CRM-VOICE-OF-CUSTOMER-06: one polarity word across the screen. The
  // Sentiment Mix card calls the middle band "Neutral" (the polarity name), so
  // the overall mood tile uses the same word rather than the synonym "Mixed".
  neutral: "Neutral",
  negative: "Negative",
  unknown: "No data",
};

export const MOOD_ICON: Record<Mood, string> = {
  positive: "▲",
  neutral: "○",
  negative: "▽",
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
