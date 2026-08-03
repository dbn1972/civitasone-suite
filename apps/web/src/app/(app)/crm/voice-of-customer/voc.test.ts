/**
 * Voice-of-Customer screen helpers (P2-6).
 *
 * The screen's job is to point an officer at the thing worth fixing, so these
 * assert that it never invents a concern that is not there and never contradicts
 * the server's own banding.
 */
import { describe, it, expect } from "vitest";
import type { CRMVocSummary } from "@civitasone/types";
import {
  MOOD_LABEL,
  moodOf,
  rankThemes,
  shareOf,
  themeLabel,
  topConcern,
} from "./voc";

const EMPTY: CRMVocSummary = {
  total: 0,
  byPolarity: { positive: 0, neutral: 0, negative: 0 },
  averageScore: 0,
  negativeShare: 0,
  themes: [],
  truncated: false,
};

function summary(over: Partial<CRMVocSummary>): CRMVocSummary {
  return { ...EMPTY, ...over };
}

describe("moodOf", () => {
  it("reports no data rather than 'mixed' when nothing has been scored", () => {
    expect(moodOf(EMPTY)).toBe("unknown");
    expect(MOOD_LABEL[moodOf(EMPTY)]).toBe("No data");
  });

  it("bands on the same neutral window the server uses", () => {
    expect(moodOf(summary({ total: 5, averageScore: 16 }))).toBe("positive");
    expect(moodOf(summary({ total: 5, averageScore: 15 }))).toBe("neutral");
    expect(moodOf(summary({ total: 5, averageScore: -15 }))).toBe("neutral");
    expect(moodOf(summary({ total: 5, averageScore: -16 }))).toBe("negative");
  });

  it("has a label for every mood it can return", () => {
    for (const s of [
      EMPTY,
      summary({ total: 1, averageScore: 90 }),
      summary({ total: 1, averageScore: -90 }),
      summary({ total: 1, averageScore: 0 }),
    ]) {
      expect(MOOD_LABEL[moodOf(s)]).toBeTruthy();
    }
  });
});

describe("shareOf", () => {
  it("computes a whole percentage of the total", () => {
    const s = summary({
      total: 4,
      byPolarity: { positive: 1, neutral: 1, negative: 2 },
    });
    expect(shareOf(s, "negative")).toBe(50);
    expect(shareOf(s, "positive")).toBe(25);
  });

  it("returns zero rather than dividing by zero on an empty period", () => {
    expect(shareOf(EMPTY, "negative")).toBe(0);
  });
});

describe("rankThemes", () => {
  const s = summary({
    total: 10,
    themes: [
      { theme: "delay", count: 6, negativeCount: 5 },
      { theme: "billing", count: 2, negativeCount: 2 },
      { theme: "staff_conduct", count: 2, negativeCount: 0 },
    ],
  });

  it("expresses each theme as a share of all interactions", () => {
    expect(rankThemes(s).find((t) => t.theme === "delay")?.sharePct).toBe(60);
  });

  it("expresses negativity as a share of that theme's own mentions", () => {
    const ranked = rankThemes(s);
    expect(ranked.find((t) => t.theme === "billing")?.negativePct).toBe(100);
    expect(ranked.find((t) => t.theme === "staff_conduct")?.negativePct).toBe(
      0,
    );
  });

  it("preserves the server's ordering", () => {
    expect(rankThemes(s).map((t) => t.theme)).toEqual([
      "delay",
      "billing",
      "staff_conduct",
    ]);
  });

  it("does not divide by zero for a theme with no mentions", () => {
    const zero = summary({
      total: 1,
      themes: [{ theme: "delay", count: 0, negativeCount: 0 }],
    });
    expect(rankThemes(zero)[0]?.negativePct).toBe(0);
  });
});

describe("topConcern", () => {
  it("picks the theme with the most negative mentions", () => {
    const s = summary({
      total: 10,
      themes: [
        { theme: "billing", count: 8, negativeCount: 2 },
        { theme: "delay", count: 4, negativeCount: 4 },
      ],
    });
    expect(topConcern(s)?.theme).toBe("delay");
  });

  it("breaks a tie by how negative the theme is proportionally", () => {
    const s = summary({
      total: 10,
      themes: [
        { theme: "billing", count: 10, negativeCount: 3 },
        { theme: "delay", count: 3, negativeCount: 3 },
      ],
    });
    expect(topConcern(s)?.theme).toBe("delay");
  });

  it("reports no concern rather than naming a purely positive theme", () => {
    const s = summary({
      total: 5,
      themes: [{ theme: "staff_conduct", count: 5, negativeCount: 0 }],
    });
    expect(topConcern(s)).toBeNull();
  });

  it("reports no concern on an empty period", () => {
    expect(topConcern(EMPTY)).toBeNull();
  });
});

describe("themeLabel", () => {
  it("gives a readable label for a known theme", () => {
    expect(themeLabel("staff_conduct")).toBe("Staff conduct");
    expect(themeLabel("corruption")).toBe("Integrity concerns");
  });

  it("falls back to a readable form for a theme it does not know", () => {
    expect(themeLabel("some_new_theme")).toBe("some new theme");
  });
});
