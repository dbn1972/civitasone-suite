import { describe, it, expect } from "vitest";
import { humaniseCode } from "./labels";

// GAP-TELEPHONY-DISPOSITIONS-05
describe("humaniseCode", () => {
  it("humanises snake_case codes in sentence case", () => {
    expect(humaniseCode("no_answer")).toBe("No answer");
    expect(humaniseCode("callback_scheduled")).toBe("Callback scheduled");
    expect(humaniseCode("no_resolution")).toBe("No resolution");
    expect(humaniseCode("resolved")).toBe("Resolved");
  });

  it("renders '—' for empty/missing input", () => {
    expect(humaniseCode("")).toBe("—");
    expect(humaniseCode(null)).toBe("—");
    expect(humaniseCode(undefined)).toBe("—");
  });
});
