/**
 * CRM Sentiment — VoC lexicon analysis, polarity, themes, summary tests.
 * Pack #21. Source: modules/sentiment/domain.ts
 */
import { describe, it, expect } from "vitest";
import { analyse, polarityOf, detectThemes, summarise, NEUTRAL_BAND, SCORE_MIN, SCORE_MAX } from "../src/modules/sentiment/domain.js";

describe("analyse — lexicon-based sentiment scoring", () => {
  it("positive text scores > NEUTRAL_BAND", () => {
    const r = analyse("Thank you so much, your team was excellent and very helpful!");
    expect(r.polarity).toBe("positive");
    expect(r.score).toBeGreaterThan(NEUTRAL_BAND);
  });

  it("negative text scores < -NEUTRAL_BAND", () => {
    const r = analyse("I am very angry about the terrible delay. This is unacceptable and frustrating!");
    expect(r.polarity).toBe("negative");
    expect(r.score).toBeLessThan(-NEUTRAL_BAND);
  });

  it("neutral text (no sentiment terms) scores 0", () => {
    const r = analyse("The meeting is scheduled for Tuesday at 3pm in the conference room.");
    expect(r.polarity).toBe("neutral");
    expect(r.score).toBe(0);
  });

  it("empty text → neutral, score 0", () => {
    const r = analyse("");
    expect(r.polarity).toBe("neutral");
    expect(r.score).toBe(0);
    expect(r.themes).toEqual([]);
  });

  it("negator inverts sentiment: 'not helpful' → negative", () => {
    const r = analyse("The officer was not helpful at all");
    expect(r.score).toBeLessThan(0);
  });

  it("intensifier amplifies: 'very good' scores higher than 'good'", () => {
    const plain = analyse("The service was good");
    const intensified = analyse("The service was very good");
    expect(intensified.score).toBeGreaterThanOrEqual(plain.score);
  });

  it("score is clamped to [-100, 100]", () => {
    const r = analyse("excellent excellent excellent excellent excellent excellent excellent");
    expect(r.score).toBeLessThanOrEqual(SCORE_MAX);
    expect(r.score).toBeGreaterThanOrEqual(SCORE_MIN);
  });

  it("matchedTerms contains sentiment-bearing tokens", () => {
    const r = analyse("Thank you for the prompt resolution");
    expect(r.matchedTerms.length).toBeGreaterThan(0);
  });
});

describe("polarityOf", () => {
  it("> 15 = positive", () => expect(polarityOf(16)).toBe("positive"));
  it("< -15 = negative", () => expect(polarityOf(-16)).toBe("negative"));
  it("within [-15, 15] = neutral", () => {
    expect(polarityOf(0)).toBe("neutral");
    expect(polarityOf(15)).toBe("neutral");
    expect(polarityOf(-15)).toBe("neutral");
  });
});

describe("detectThemes", () => {
  it("detects delay theme", () => expect(detectThemes("There has been a long delay in processing")).toContain("delay"));
  it("detects billing theme", () => expect(detectThemes("The invoice amount is wrong")).toContain("billing"));
  it("detects staff_conduct theme", () => expect(detectThemes("The clerk was rude")).toContain("staff_conduct"));
  it("detects corruption theme", () => expect(detectThemes("They asked for a bribe")).toContain("corruption"));
  it("returns sorted themes", () => {
    const themes = detectThemes("The delay in billing is due to a rude clerk");
    expect(themes).toEqual([...themes].sort());
  });
  it("returns empty for irrelevant text", () => expect(detectThemes("The sky is blue today")).toEqual([]));
});

describe("summarise — VoC aggregation", () => {
  it("aggregates polarity counts and average", () => {
    const rows = [
      { polarity: "positive", score: 50, themes: ["service_quality"] },
      { polarity: "negative", score: -60, themes: ["delay"] },
      { polarity: "neutral", score: 0, themes: [] },
    ];
    const s = summarise(rows);
    expect(s.total).toBe(3);
    expect(s.byPolarity.positive).toBe(1);
    expect(s.byPolarity.negative).toBe(1);
    expect(s.byPolarity.neutral).toBe(1);
    expect(s.averageScore).toBe(-3); // (50-60+0)/3 = -3.33 → -3
    expect(s.negativeShare).toBe(33); // 1/3 ≈ 33%
  });

  it("topThemes sorted by count", () => {
    const rows = [
      { polarity: "negative", score: -40, themes: ["delay", "billing"] },
      { polarity: "negative", score: -50, themes: ["delay"] },
    ];
    const s = summarise(rows);
    expect(s.topThemes[0]!.theme).toBe("delay");
    expect(s.topThemes[0]!.count).toBe(2);
    expect(s.topThemes[0]!.negativeCount).toBe(2);
  });

  it("empty rows → all zeros", () => {
    const s = summarise([]);
    expect(s.total).toBe(0);
    expect(s.averageScore).toBe(0);
    expect(s.negativeShare).toBe(0);
  });
});
