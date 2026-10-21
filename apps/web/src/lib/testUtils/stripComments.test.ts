import { describe, it, expect } from "vitest";
import { stripComments } from "./stripComments";

describe("stripComments", () => {
  it("removes block comments, including multi-line ones", () => {
    expect(stripComments("a /* one */ b /* two\nlines */ c")).toBe("a  b  c");
  });

  it("removes a line comment up to (not including) the newline", () => {
    expect(stripComments("code // note\nnext")).toBe("code \nnext");
  });

  it("keeps a // that follows a colon (a URL)", () => {
    expect(stripComments('const u = "https://example.test/x"; // trailing')).toBe('const u = "https://example.test/x"; ');
  });

  it("handles a comment at the very start and at the very end", () => {
    expect(stripComments("// head\ncode /* tail */")).toBe("\ncode ");
  });

  it("does not splice text into a new comment delimiter after removing one", () => {
    // A pattern-replace would turn "/*" + "/* x */" + "*/" into "/**/"-like leftovers; a scan keeps what is left verbatim.
    const out = stripComments("/ /* x */ * y");
    expect(out).toBe("/  * y");
    expect(out).not.toContain("/*");
  });

  it("leaves an unterminated block comment's remainder out and never throws", () => {
    expect(stripComments("keep /* never closed")).toBe("keep ");
  });

  it("returns code without comments untouched", () => {
    const code = "const a = 1;\nexport const b = a + 2;\n";
    expect(stripComments(code)).toBe(code);
  });
});
