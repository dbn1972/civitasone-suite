import { describe, expect, it } from "vitest";
import { escapeCell } from "./governance-report.js";

describe("escapeCell", () => {
  it("escapes pipes and newlines", () => {
    expect(escapeCell("a|b\nc")).toBe("a\\|b<br>c");
  });

  it("escapes backslashes first so a trailing backslash cannot re-open a pipe escape", () => {
    // Input `a\|b` (backslash then pipe) must become `a\\\|b`: an escaped
    // backslash followed by an escaped pipe, never a bare unescaped pipe.
    expect(escapeCell("a\\|b")).toBe("a\\\\\\|b");
  });
});
