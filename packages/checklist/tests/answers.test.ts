import { describe, it, expect } from "vitest";
import { answerValue, hasAnswer, isAnswered } from "../src/answers.js";
import { answers, AT } from "./fixtures.js";

describe("isAnswered", () => {
  it("treats a missing entry as unanswered", () => {
    expect(isAnswered(undefined)).toBe(false);
  });

  it("treats null and undefined values as unanswered", () => {
    expect(isAnswered({ value: null, answeredAt: AT })).toBe(false);
    expect(isAnswered({ value: undefined, answeredAt: AT })).toBe(false);
  });

  it("treats blank and whitespace-only strings as unanswered", () => {
    expect(isAnswered({ value: "", answeredAt: AT })).toBe(false);
    expect(isAnswered({ value: "   ", answeredAt: AT })).toBe(false);
    expect(isAnswered({ value: "x", answeredAt: AT })).toBe(true);
  });

  it("treats an empty array as unanswered but a populated one as answered", () => {
    expect(isAnswered({ value: [], answeredAt: AT })).toBe(false);
    expect(isAnswered({ value: ["a"], answeredAt: AT })).toBe(true);
  });

  it("treats false and 0 as real answers", () => {
    expect(isAnswered({ value: false, answeredAt: AT })).toBe(true);
    expect(isAnswered({ value: 0, answeredAt: AT })).toBe(true);
  });

  it("treats objects as answered", () => {
    expect(isAnswered({ value: { documentId: "d1" }, answeredAt: AT })).toBe(true);
  });
});

describe("hasAnswer / answerValue", () => {
  const responses = answers({ q1: "yes", q2: "", q3: 0 });

  it("reports presence by question id", () => {
    expect(hasAnswer(responses, "q1")).toBe(true);
    expect(hasAnswer(responses, "q2")).toBe(false);
    expect(hasAnswer(responses, "missing")).toBe(false);
  });

  it("returns the value only when the answer is meaningful", () => {
    expect(answerValue(responses, "q1")).toBe("yes");
    expect(answerValue(responses, "q3")).toBe(0);
    expect(answerValue(responses, "q2")).toBeUndefined();
    expect(answerValue(responses, "missing")).toBeUndefined();
  });
});
