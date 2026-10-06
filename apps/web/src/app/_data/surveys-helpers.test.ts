import { describe, expect, it } from "vitest";
import {
  normalizeSurveyStatus,
  parseCompletionPct,
  summarizeSurveys,
  type CitizenSurvey,
} from "./loaders";

// GAP-CITIZEN-SURVEYS-03: status is a free string; counts must normalise.
describe("normalizeSurveyStatus", () => {
  it("counts case/whitespace variants of active", () => {
    expect(normalizeSurveyStatus("active")).toBe("active");
    expect(normalizeSurveyStatus("ACTIVE ")).toBe("active");
    expect(normalizeSurveyStatus(" Active")).toBe("active");
  });
  it("maps completed synonyms", () => {
    expect(normalizeSurveyStatus("Completed")).toBe("completed");
    expect(normalizeSurveyStatus("closed")).toBe("completed");
  });
  it("buckets unknown statuses as other", () => {
    expect(normalizeSurveyStatus("Draft")).toBe("other");
  });
});

// GAP-CITIZEN-SURVEYS-04: completion parsed to a 0-100 number for sort + bar.
describe("parseCompletionPct", () => {
  it("parses percentage strings", () => {
    expect(parseCompletionPct("72%")).toBe(72);
    expect(parseCompletionPct("72 %")).toBe(72);
    expect(parseCompletionPct("100")).toBe(100);
  });
  it("orders 9% below 10% numerically", () => {
    expect((parseCompletionPct("9%") as number) < (parseCompletionPct("10%") as number)).toBe(true);
  });
  it("returns null for non-numeric", () => {
    expect(parseCompletionPct("—")).toBeNull();
    expect(parseCompletionPct("")).toBeNull();
  });
  it("clamps out-of-range", () => {
    expect(parseCompletionPct("150%")).toBe(100);
  });
});

function survey(status: string, responses: number): CitizenSurvey {
  return { id: status + responses, surveyName: "S", responses, completion: "0%", period: "2026", status };
}

// GAP-CITIZEN-SURVEYS-01/02/03: one pure summary shared by cards + table.
describe("summarizeSurveys", () => {
  it("counts normalised statuses and sums responses", () => {
    const s = summarizeSurveys([
      survey("active", 10),
      survey("ACTIVE ", 5),
      survey("Completed", 3),
      survey("Draft", 2),
    ]);
    expect(s).toEqual({ active: 2, completed: 1, other: 1, total: 4, totalResponses: 20 });
  });
  it("is all-zero for an empty list", () => {
    expect(summarizeSurveys([])).toEqual({ active: 0, completed: 0, other: 0, total: 0, totalResponses: 0 });
  });
});
