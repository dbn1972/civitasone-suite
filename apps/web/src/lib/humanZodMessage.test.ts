import { describe, it, expect } from "vitest";
import { humanZodMessage } from "./humanZodMessage";

describe("humanZodMessage", () => {
  it("keeps an authored schema message", () => {
    expect(humanZodMessage({ message: "Choose a work." })).toBe("Choose a work.");
  });
  it.each(["Required", "Invalid input", "Invalid uuid", "Expected number, received nan", "String must contain at least 3 character(s)"])(
    "replaces zod default text %s with catalogued copy",
    (m) => {
      const out = humanZodMessage({ message: m });
      expect(out).not.toBe(m);
      expect(out).toMatch(/not accepted/i);
    },
  );
  it("falls back to catalogued copy with no issue", () => {
    expect(humanZodMessage(undefined)).toMatch(/not accepted/i);
  });
});
