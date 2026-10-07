import { describe, it, expect } from "vitest";
import { mapGuardrailRules, ruleTypeLabel } from "./guardrails";

describe("mapGuardrailRules", () => {
  it("maps rule rows from the data envelope with typed fields", () => {
    expect(
      mapGuardrailRules({
        data: [
          { id: "r1", name: "Block PAN", ruleType: "pii", pattern: "[A-Z]{5}", severity: "high", status: "active" },
        ],
      }),
    ).toEqual([
      { id: "r1", name: "Block PAN", ruleType: "pii", pattern: "[A-Z]{5}", severity: "high", status: "active" },
    ]);
  });

  it("defaults severity and status when absent", () => {
    expect(mapGuardrailRules([{ id: "r1", name: "n", ruleType: "profanity" }])).toEqual([
      { id: "r1", name: "n", ruleType: "profanity", pattern: null, severity: "medium", status: "active" },
    ]);
  });

  it("skips rows missing an id, name or ruleType", () => {
    const mapped = mapGuardrailRules([
      { id: "r1", name: "ok", ruleType: "pii" },
      { name: "no id", ruleType: "pii" },
      { id: "r3", ruleType: "pii" },
    ]);
    expect(mapped?.map((r) => r.id)).toEqual(["r1"]);
  });

  it("returns null when the payload is not a list", () => {
    expect(mapGuardrailRules({ summary: {} })).toBeNull();
    expect(mapGuardrailRules("nope")).toBeNull();
  });
});

describe("ruleTypeLabel", () => {
  it("gives friendly labels for known types", () => {
    expect(ruleTypeLabel("pii")).toBe("PII redaction");
    expect(ruleTypeLabel("prompt_injection")).toBe("Prompt-injection block");
    expect(ruleTypeLabel("max_length")).toBe("Length limit");
  });

  it("falls back to a readable form for an unknown type", () => {
    expect(ruleTypeLabel("custom_rule")).toBe("Custom Rule");
  });
});
