/**
 * Interview panel scoring — competency-weighted consolidation, blind visibility.
 */
import { describe, it, expect } from "vitest";
import {
  competencyAverage, computePanelScore, recommendationFromScore, visibleScores,
} from "../src/modules/recruitment/interview-scoring.js";

const template = [
  { competency: "technical", weight: 60, maxScore: 10 },
  { competency: "communication", weight: 40, maxScore: 10 },
];

describe("competencyAverage", () => {
  it("averages across interviewers who scored the competency", () => {
    const scores = [
      { interviewerId: "a", scores: { technical: 8, communication: 6 } },
      { interviewerId: "b", scores: { technical: 6 } }, // no communication
    ];
    expect(competencyAverage(scores, "technical")).toBe(7);
    expect(competencyAverage(scores, "communication")).toBe(6);
    expect(competencyAverage(scores, "missing")).toBeNull();
  });
});

describe("computePanelScore", () => {
  it("computes the weighted 0-100 panel score and pass/fail vs cut-off", () => {
    const scores = [
      { interviewerId: "a", scores: { technical: 8, communication: 6 }, submitted: true },
      { interviewerId: "b", scores: { technical: 6, communication: 8 }, submitted: true },
    ];
    // tech avg 7/10, comm avg 7/10 -> (0.7*60 + 0.7*40)/100 *100 = 70
    const r = computePanelScore(template, scores, 65);
    expect(r.weightedScore).toBe(70);
    expect(r.passed).toBe(true);
    expect(r.recommendation).toBe("hire");
    expect(r.interviewerCount).toBe(2);
  });

  it("fails below the cut-off and returns no_hire at low scores", () => {
    const scores = [{ interviewerId: "a", scores: { technical: 3, communication: 3 }, submitted: true }];
    const r = computePanelScore(template, scores, 65);
    expect(r.weightedScore).toBe(30);
    expect(r.passed).toBe(false);
    expect(r.recommendation).toBe("no_hire");
  });

  it("only counts competencies someone scored; zero when none", () => {
    expect(computePanelScore(template, []).weightedScore).toBe(0);
  });
});

describe("recommendationFromScore", () => {
  it("maps score bands", () => {
    expect(recommendationFromScore(90)).toBe("strong_hire");
    expect(recommendationFromScore(75)).toBe("hire");
    expect(recommendationFromScore(55)).toBe("maybe");
    expect(recommendationFromScore(40)).toBe("no_hire");
  });
});

describe("visibleScores (blind panel)", () => {
  const scores = [
    { interviewerId: "a", submitted: true },
    { interviewerId: "b", submitted: true },
  ];
  it("hides others from a panel member who has NOT submitted", () => {
    const r = visibleScores([{ interviewerId: "c", submitted: false }, ...scores], "c", true);
    expect(r.blinded).toBe(true);
    expect(r.scores.map((s) => s.interviewerId)).toEqual(["c"]);
  });
  it("shows all once the panel member has submitted", () => {
    const r = visibleScores(scores, "a", true);
    expect(r.blinded).toBe(false);
    expect(r.scores).toHaveLength(2);
  });
  it("shows all to a non-panel viewer (HR admin)", () => {
    const r = visibleScores(scores, "hr", false);
    expect(r.blinded).toBe(false);
    expect(r.scores).toHaveLength(2);
  });
});
