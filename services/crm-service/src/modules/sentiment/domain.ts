/**
 * sentiment/domain.ts — Voice-of-Customer scoring over interaction text.
 * Pure functions: no I/O, no clock, no randomness, so a score is reproducible
 * and a disputed reading can be re-derived from the stored text.
 *
 * This is a deterministic lexicon model, not an LLM. It is deliberately modest:
 * it gives a defensible, explainable, offline-capable baseline that an operator
 * can audit. Swapping in ml-service later only replaces `analyse`; the stored
 * shape, the aggregate and the API do not change.
 */

export type Polarity = "positive" | "neutral" | "negative";

export const POLARITIES: readonly Polarity[] = [
  "positive",
  "neutral",
  "negative",
];

/**
 * Score band edges. A score inside (-NEUTRAL_BAND, +NEUTRAL_BAND) is neutral,
 * so a single stray word does not flip an otherwise ordinary note.
 */
export const NEUTRAL_BAND = 15;

/** Score is clamped to this range so one very long rant cannot dominate an average. */
export const SCORE_MIN = -100;
export const SCORE_MAX = 100;

const POSITIVE_TERMS: readonly string[] = [
  "thank",
  "thanks",
  "grateful",
  "appreciate",
  "appreciated",
  "excellent",
  "great",
  "good",
  "helpful",
  "prompt",
  "quick",
  "resolved",
  "satisfied",
  "happy",
  "pleased",
  "smooth",
  "easy",
  "courteous",
  "polite",
  "efficient",
  "commend",
  "praise",
  "wonderful",
  "perfect",
  "impressed",
];

const NEGATIVE_TERMS: readonly string[] = [
  "angry",
  "furious",
  "upset",
  "disappointed",
  "disappoint",
  "frustrated",
  "frustrating",
  "delay",
  "delayed",
  "pending",
  "unresolved",
  "worst",
  "bad",
  "poor",
  "terrible",
  "awful",
  "rude",
  "unhelpful",
  "harassment",
  "bribe",
  "corrupt",
  "negligence",
  "ignored",
  "ignoring",
  "complaint",
  "escalate",
  "escalation",
  "unacceptable",
  "useless",
  "waiting",
  "repeatedly",
  "again",
  "failure",
  "failed",
  "broken",
  "error",
  "wrong",
  "refuse",
  "refused",
];

/** Words that invert the sentiment of the term that follows them. */
const NEGATORS: readonly string[] = [
  "not",
  "no",
  "never",
  "cannot",
  "cant",
  "didnt",
  "doesnt",
  "wasnt",
  "isnt",
  "without",
];

/** Words that amplify the term that follows them. */
const INTENSIFIERS: readonly string[] = [
  "very",
  "extremely",
  "highly",
  "really",
  "totally",
  "completely",
  "absolutely",
  "utterly",
];

/**
 * VoC themes. Each theme is a bucket of trigger terms; a theme is attached when
 * any trigger appears. Themes are what turns a pile of scores into something
 * actionable — "negative" alone tells an officer nothing they can fix.
 */
const THEME_TERMS: Readonly<Record<string, readonly string[]>> = {
  delay: [
    "delay",
    "delayed",
    "late",
    "slow",
    "waiting",
    "pending",
    "still not",
    "overdue",
  ],
  billing: [
    "bill",
    "billing",
    "invoice",
    "payment",
    "charge",
    "charged",
    "refund",
    "amount",
    "fee",
    "tax",
  ],
  staff_conduct: [
    "rude",
    "polite",
    "courteous",
    "behaviour",
    "behavior",
    "staff",
    "officer",
    "clerk",
    "attitude",
  ],
  service_quality: [
    "quality",
    "broken",
    "faulty",
    "defective",
    "not working",
    "poor",
    "excellent",
  ],
  documentation: [
    "document",
    "documents",
    "certificate",
    "form",
    "paperwork",
    "affidavit",
    "proof",
    "upload",
  ],
  accessibility: [
    "website",
    "portal",
    "app",
    "login",
    "otp",
    "link",
    "download",
    "offline",
  ],
  corruption: [
    "bribe",
    "corrupt",
    "corruption",
    "under the table",
    "commission",
  ],
  communication: [
    "no response",
    "no reply",
    "unanswered",
    "call back",
    "informed",
    "update",
    "status",
  ],
};

export const THEMES: readonly string[] = Object.keys(THEME_TERMS);

/**
 * Round half away from zero.
 *
 * Math.round breaks ties toward +Infinity, so -17.5 → -17 while 17.5 → 18. On a
 * satisfaction metric that asymmetry always rounds in the happy direction, which is
 * exactly the wrong bias for a number meant to surface dissatisfaction.
 */
function roundHalfAwayFromZero(n: number): number {
  return n < 0 ? -Math.round(-n) : Math.round(n);
}

/** Lowercase alphanumeric tokens. Apostrophes are dropped so "didn't" → "didnt". */
function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/['’]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0);
}

/** True when the token starts with any term in the list (cheap stemming). */
function matches(token: string, terms: readonly string[]): boolean {
  return terms.some((t) => token.startsWith(t));
}

export interface Analysis {
  polarity: Polarity;
  /** Clamped to [-100, 100]. Negative is unhappy. */
  score: number;
  /** Sorted, de-duplicated. Empty when nothing recognisable was said. */
  themes: string[];
  /** Sentiment-bearing tokens found, for explaining a score back to an officer. */
  matchedTerms: string[];
}

/**
 * Score interaction text. Empty or unrecognisable text scores 0 / neutral
 * rather than guessing, so "no signal" is never reported as satisfaction.
 */
export function analyse(text: string): Analysis {
  const tokens = tokenise(text);
  if (tokens.length === 0) {
    return { polarity: "neutral", score: 0, themes: [], matchedTerms: [] };
  }

  let raw = 0;
  let hits = 0;
  const matchedTerms: string[] = [];

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i] as string;
    const positive = matches(token, POSITIVE_TERMS);
    const negative = !positive && matches(token, NEGATIVE_TERMS);
    if (!positive && !negative) continue;

    let weight = positive ? 1 : -1;

    // Look back two tokens for a negator or intensifier ("not very helpful").
    for (let back = 1; back <= 2; back += 1) {
      const prior = tokens[i - back];
      if (prior === undefined) break;
      if (NEGATORS.includes(prior)) weight *= -1;
      else if (INTENSIFIERS.includes(prior)) weight *= 1.5;
    }

    raw += weight;
    hits += 1;
    matchedTerms.push(token);
  }

  if (hits === 0) {
    return {
      polarity: "neutral",
      score: 0,
      themes: detectThemes(text),
      matchedTerms: [],
    };
  }

  // Normalise by the number of sentiment-bearing words rather than by total
  // length, so a short sharp complaint and a long one of the same intensity
  // score alike, then scale into the reporting range.
  const normalised = (raw / hits) * 100;
  const score = Math.max(
    SCORE_MIN,
    Math.min(SCORE_MAX, roundHalfAwayFromZero(normalised)),
  );

  return {
    polarity: polarityOf(score),
    score,
    themes: detectThemes(text),
    matchedTerms,
  };
}

/** Band a numeric score into a polarity. */
export function polarityOf(score: number): Polarity {
  if (score > NEUTRAL_BAND) return "positive";
  if (score < -NEUTRAL_BAND) return "negative";
  return "neutral";
}

/** Themes present in the text, sorted for a stable stored value. */
export function detectThemes(text: string): string[] {
  const lowered = text.toLowerCase();
  const found: string[] = [];
  for (const [theme, terms] of Object.entries(THEME_TERMS)) {
    if (terms.some((t) => lowered.includes(t))) found.push(theme);
  }
  return found.sort();
}

// ── Aggregation ──────────────────────────────────────────────────────────────

export interface ScoredInteraction {
  polarity: string;
  score: number;
  themes: string[];
}

export interface VocSummary {
  total: number;
  byPolarity: Record<Polarity, number>;
  /** Mean score across all scored interactions, rounded. 0 when there are none. */
  averageScore: number;
  /**
   * Share of interactions that were negative, 0–100 rounded. This is the number
   * a control tower watches; a rising share matters even while the mean looks flat.
   */
  negativeShare: number;
  /** Themes by frequency, most common first, ties broken alphabetically. */
  topThemes: { theme: string; count: number; negativeCount: number }[];
}

/**
 * Roll scored interactions into the VoC summary. Counts each theme once per
 * interaction even if several of its trigger words appear, so a single ranting
 * note cannot manufacture a trend.
 */
export function summarise(
  rows: ScoredInteraction[],
  themeLimit = 10,
): VocSummary {
  const byPolarity: Record<Polarity, number> = {
    positive: 0,
    neutral: 0,
    negative: 0,
  };
  const themeCounts = new Map<
    string,
    { count: number; negativeCount: number }
  >();
  let scoreTotal = 0;

  for (const row of rows) {
    if (
      row.polarity === "positive" ||
      row.polarity === "neutral" ||
      row.polarity === "negative"
    ) {
      byPolarity[row.polarity] += 1;
    }
    scoreTotal += row.score;

    for (const theme of new Set(row.themes)) {
      const entry = themeCounts.get(theme) ?? { count: 0, negativeCount: 0 };
      entry.count += 1;
      if (row.polarity === "negative") entry.negativeCount += 1;
      themeCounts.set(theme, entry);
    }
  }

  const total = rows.length;
  const topThemes = [...themeCounts.entries()]
    .map(([theme, v]) => ({
      theme,
      count: v.count,
      negativeCount: v.negativeCount,
    }))
    .sort((a, b) => b.count - a.count || a.theme.localeCompare(b.theme))
    .slice(0, themeLimit);

  return {
    total,
    byPolarity,
    averageScore: total === 0 ? 0 : roundHalfAwayFromZero(scoreTotal / total),
    negativeShare:
      total === 0 ? 0 : Math.round((byPolarity.negative / total) * 100),
    topThemes,
  };
}
