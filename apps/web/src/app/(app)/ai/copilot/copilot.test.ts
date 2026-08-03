import { describe, expect, it } from "vitest";
import type { CopilotTurn } from "@civitasone/types";
import {
  citationCount,
  guardrailViolationMessages,
  summariseTurns,
  truncatePrompt,
  turnState,
} from "./copilot";

function turn(overrides: Partial<CopilotTurn> = {}): CopilotTurn {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    userId: null,
    prompt: "Summarise the pending sanctions",
    response: "Three sanctions are pending approval.",
    sourceCitations: [],
    model: "gpt-4o",
    tokens: 120,
    latencyMs: 400,
    createdAt: "2026-08-01T10:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

describe("turnState", () => {
  it("reports a turn with a response as answered", () => {
    expect(turnState(turn())).toBe("answered");
  });

  it("reports a turn with no response yet as awaiting", () => {
    expect(turnState(turn({ response: null }))).toBe("awaiting");
  });

  it("treats a whitespace-only response as still awaiting", () => {
    expect(turnState(turn({ response: "   " }))).toBe("awaiting");
  });
});

describe("summariseTurns", () => {
  it("counts answered and awaiting turns and averages latency", () => {
    const summary = summariseTurns([
      turn({ latencyMs: 100, tokens: 10 }),
      turn({ latencyMs: 300, tokens: 20 }),
      turn({ response: null, latencyMs: 200, tokens: 5 }),
    ]);
    expect(summary.total).toBe(3);
    expect(summary.answered).toBe(2);
    expect(summary.awaiting).toBe(1);
    expect(summary.averageLatencyMs).toBe(200);
    expect(summary.totalTokens).toBe(35);
  });

  it("ignores turns with no recorded latency when averaging", () => {
    const summary = summariseTurns([
      turn({ latencyMs: null }),
      turn({ latencyMs: 500 }),
    ]);
    expect(summary.averageLatencyMs).toBe(500);
  });

  it("returns zeroes for an empty list without dividing by zero", () => {
    expect(summariseTurns([])).toEqual({
      total: 0,
      answered: 0,
      awaiting: 0,
      averageLatencyMs: 0,
      totalTokens: 0,
    });
  });
});

describe("truncatePrompt", () => {
  it("leaves a short prompt untouched", () => {
    expect(truncatePrompt("Short prompt")).toBe("Short prompt");
  });

  it("collapses newlines and repeated spaces so the table row stays one line", () => {
    expect(truncatePrompt("line one\n\n  line two")).toBe("line one line two");
  });

  it("truncates with an ellipsis at the requested length", () => {
    const result = truncatePrompt("abcdefghij", 5);
    expect(result).toBe("abcd…");
    expect(result.length).toBe(5);
  });
});

describe("citationCount", () => {
  it("counts the citations attached to a turn", () => {
    expect(citationCount(turn({ sourceCitations: [{ id: "a" }, { id: "b" }] }))).toBe(2);
  });

  it("returns 0 when there are none", () => {
    expect(citationCount(turn())).toBe(0);
  });
});

describe("guardrailViolationMessages", () => {
  it("extracts messages from a guardrail-blocked body", () => {
    expect(guardrailViolationMessages({
      code: "GUARDRAIL_BLOCKED",
      details: { violations: [{ message: "contains an account number" }, { message: "profanity" }] },
    })).toEqual(["contains an account number", "profanity"]);
  });

  it("accepts plain string violations", () => {
    expect(guardrailViolationMessages({ details: { violations: ["blocked term"] } }))
      .toEqual(["blocked term"]);
  });

  it("returns an empty list for a body it cannot read rather than throwing", () => {
    expect(guardrailViolationMessages(null)).toEqual([]);
    expect(guardrailViolationMessages("nope")).toEqual([]);
    expect(guardrailViolationMessages({})).toEqual([]);
    expect(guardrailViolationMessages({ details: {} })).toEqual([]);
    expect(guardrailViolationMessages({ details: { violations: "not-an-array" } })).toEqual([]);
  });

  it("skips violations with no usable message", () => {
    expect(guardrailViolationMessages({
      details: { violations: [{ message: "" }, { code: "X" }, { message: "real one" }] },
    })).toEqual(["real one"]);
  });
});
