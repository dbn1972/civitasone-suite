/**
 * Voice-of-Customer scoring (P2-6) — pure domain.
 *
 * These assert the properties an officer would rely on when acting on a reading:
 * that "no signal" is never reported as satisfaction, that negation is not read
 * backwards, and that one long complaint cannot manufacture a theme trend.
 */
import { describe, it, expect } from "vitest";
import {
  analyse,
  detectThemes,
  polarityOf,
  summarise,
  NEUTRAL_BAND,
  SCORE_MIN,
  SCORE_MAX,
  POLARITIES,
  THEMES,
} from "../src/modules/sentiment/domain.js";

describe("polarityOf", () => {
  it("bands scores around the neutral window", () => {
    expect(polarityOf(100)).toBe("positive");
    expect(polarityOf(NEUTRAL_BAND + 1)).toBe("positive");
    expect(polarityOf(NEUTRAL_BAND)).toBe("neutral");
    expect(polarityOf(0)).toBe("neutral");
    expect(polarityOf(-NEUTRAL_BAND)).toBe("neutral");
    expect(polarityOf(-NEUTRAL_BAND - 1)).toBe("negative");
    expect(polarityOf(-100)).toBe("negative");
  });
});

describe("analyse", () => {
  it("scores plain praise positive", () => {
    const r = analyse(
      "Thank you, the officer was very helpful and the issue was resolved quickly.",
    );
    expect(r.polarity).toBe("positive");
    expect(r.score).toBeGreaterThan(NEUTRAL_BAND);
  });

  it("scores a complaint negative", () => {
    const r = analyse(
      "This is unacceptable. The payment is delayed again and nobody has responded.",
    );
    expect(r.polarity).toBe("negative");
    expect(r.score).toBeLessThan(-NEUTRAL_BAND);
  });

  it("reports empty text as neutral zero rather than guessing", () => {
    for (const text of ["", "   ", "\n\t"]) {
      const r = analyse(text);
      expect(r).toEqual({
        polarity: "neutral",
        score: 0,
        themes: [],
        matchedTerms: [],
      });
    }
  });

  it("reports text with no sentiment words as neutral, not positive", () => {
    const r = analyse("Applicant submitted form 16 on Tuesday at the counter.");
    expect(r.polarity).toBe("neutral");
    expect(r.score).toBe(0);
    expect(r.matchedTerms).toEqual([]);
  });

  it("reads negation rather than inverting the meaning", () => {
    const plain = analyse("the staff was helpful");
    const negated = analyse("the staff was not helpful");
    expect(plain.polarity).toBe("positive");
    expect(negated.polarity).toBe("negative");
  });

  it("handles a negator separated from the term by one word", () => {
    expect(analyse("this was not very helpful").polarity).toBe("negative");
  });

  it("treats a typographic apostrophe the same as a plain one", () => {
    expect(analyse("didn’t resolve").score).toBe(
      analyse("didn't resolve").score,
    );
  });

  it("keeps the score inside the reporting range however long the text", () => {
    const rant = "terrible awful rude corrupt negligence ".repeat(200);
    const r = analyse(rant);
    expect(r.score).toBeGreaterThanOrEqual(SCORE_MIN);
    expect(r.score).toBeLessThanOrEqual(SCORE_MAX);
  });

  it("scores a short and a long complaint of equal intensity alike", () => {
    const short = analyse("terrible service");
    const long = analyse(
      "terrible service. terrible service. terrible service. terrible service.",
    );
    expect(short.score).toBe(long.score);
  });

  it("is deterministic — the same text always scores the same", () => {
    const text = "The delay is frustrating but the officer was polite.";
    expect(analyse(text)).toEqual(analyse(text));
  });

  it("reports the matched terms so a score can be explained", () => {
    const r = analyse("the delay was frustrating");
    expect(r.matchedTerms.length).toBeGreaterThan(0);
    expect(r.matchedTerms.every((t) => typeof t === "string")).toBe(true);
  });

  it("does not read a longer unrelated word as a lexicon term", () => {
    // "badge" is not "bad"; "against" is not "again"; "commence" is not "commend".
    for (const text of [
      "officer badge number 42",
      "checked against the register",
      "commence the process",
    ]) {
      const r = analyse(text);
      expect(
        r.matchedTerms,
        `"${text}" should match no sentiment term`,
      ).toEqual([]);
      expect(r.polarity).toBe("neutral");
    }
  });

  it("still recognises ordinary inflections of a lexicon term", () => {
    for (const text of [
      "the payment was delayed",
      "repeated delays",
      "this is frustrating",
    ]) {
      expect(analyse(text).polarity, `"${text}" should read negative`).toBe(
        "negative",
      );
    }
  });

  it("attaches themes even when the text carries no sentiment", () => {
    const r = analyse("Please confirm the invoice amount for the certificate.");
    expect(r.polarity).toBe("neutral");
    expect(r.themes).toContain("billing");
  });

  it("only ever returns a declared polarity", () => {
    for (const text of [
      "great",
      "awful",
      "",
      "form submitted",
      "not not good",
    ]) {
      expect(POLARITIES).toContain(analyse(text).polarity);
    }
  });
});

describe("detectThemes", () => {
  it("recognises the themes a complaint touches", () => {
    const themes = detectThemes(
      "The bill is wrong and the clerk was rude about the delay.",
    );
    expect(themes).toContain("billing");
    expect(themes).toContain("staff_conduct");
    expect(themes).toContain("delay");
  });

  it("returns themes sorted and de-duplicated for a stable stored value", () => {
    const themes = detectThemes("delay delay delay bill bill");
    expect(themes).toEqual([...new Set(themes)].sort());
  });

  it("is case-insensitive", () => {
    expect(detectThemes("BRIBE DEMANDED")).toEqual(
      detectThemes("bribe demanded"),
    );
  });

  it("returns nothing recognisable as an empty list", () => {
    expect(detectThemes("xyzzy plugh")).toEqual([]);
  });

  it("does not attach a theme because a word merely contains a trigger", () => {
    // "information" contains "form"; "happy" contains "app"; "taxi" contains "tax".
    expect(detectThemes("please share the information")).not.toContain(
      "documentation",
    );
    expect(detectThemes("the citizen was happy")).not.toContain(
      "accessibility",
    );
    expect(detectThemes("he took a taxi")).not.toContain("billing");
  });

  it("still attaches a theme for a plural or inflected trigger", () => {
    expect(detectThemes("submit the documents")).toContain("documentation");
    expect(detectThemes("two payments are pending")).toContain("billing");
    expect(detectThemes("repeated delays")).toContain("delay");
  });

  it("only ever returns declared themes", () => {
    const themes = detectThemes(
      "bill delay rude broken document portal bribe no response",
    );
    expect(themes.every((t) => THEMES.includes(t))).toBe(true);
  });
});

describe("summarise", () => {
  const rows = [
    { polarity: "negative", score: -80, themes: ["delay", "billing"] },
    { polarity: "negative", score: -60, themes: ["delay"] },
    { polarity: "positive", score: 70, themes: ["staff_conduct"] },
    { polarity: "neutral", score: 0, themes: [] },
  ];

  it("counts each polarity", () => {
    const s = summarise(rows);
    expect(s.total).toBe(4);
    expect(s.byPolarity).toEqual({ positive: 1, neutral: 1, negative: 2 });
  });

  it("averages the score across every reading", () => {
    // (-80 + -60 + 70 + 0) / 4 = -17.5, rounded away from zero → -18
    expect(summarise(rows).averageScore).toBe(-18);
  });

  it("rounds a tied average symmetrically, without a bias toward happy", () => {
    const negative = summarise([
      { polarity: "negative", score: -18, themes: [] },
      { polarity: "negative", score: -17, themes: [] },
    ]);
    const positive = summarise([
      { polarity: "positive", score: 18, themes: [] },
      { polarity: "positive", score: 17, themes: [] },
    ]);
    expect(negative.averageScore).toBe(-18);
    expect(positive.averageScore).toBe(18);
  });

  it("reports the negative share as a whole percentage", () => {
    expect(summarise(rows).negativeShare).toBe(50);
  });

  it("ranks themes by frequency and tracks how many were negative", () => {
    const top = summarise(rows).topThemes;
    expect(top[0]).toEqual({ theme: "delay", count: 2, negativeCount: 2 });
    expect(top.find((t) => t.theme === "staff_conduct")).toEqual({
      theme: "staff_conduct",
      count: 1,
      negativeCount: 0,
    });
  });

  it("counts a theme once per interaction, so one rant cannot fake a trend", () => {
    const s = summarise([
      { polarity: "negative", score: -90, themes: ["delay", "delay", "delay"] },
    ]);
    expect(s.topThemes).toEqual([
      { theme: "delay", count: 1, negativeCount: 1 },
    ]);
  });

  it("breaks frequency ties alphabetically so the ordering is stable", () => {
    const s = summarise([
      { polarity: "neutral", score: 0, themes: ["zebra", "alpha"] },
      { polarity: "neutral", score: 0, themes: ["zebra", "alpha"] },
    ]);
    expect(s.topThemes.map((t) => t.theme)).toEqual(["alpha", "zebra"]);
  });

  it("honours the theme limit", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      polarity: "neutral",
      score: 0,
      themes: [`theme_${i}`],
    }));
    expect(summarise(many, 5).topThemes).toHaveLength(5);
  });

  it("reports an empty period as zero rather than dividing by zero", () => {
    expect(summarise([])).toEqual({
      total: 0,
      byPolarity: { positive: 0, neutral: 0, negative: 0 },
      averageScore: 0,
      negativeShare: 0,
      topThemes: [],
    });
  });

  it("ignores an unrecognised stored polarity instead of miscounting it", () => {
    const s = summarise([{ polarity: "furious", score: -50, themes: [] }]);
    expect(s.total).toBe(1);
    expect(s.byPolarity).toEqual({ positive: 0, neutral: 0, negative: 0 });
  });
});
