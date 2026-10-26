import { describe, it, expect } from "vitest";
import { sanitizeCss } from "../src/modules/tokens/css-sanitize.js";

describe("sanitizeCss (CodeQL alerts 994/995)", () => {
  it("removes the plain dangerous constructs", () => {
    const out = sanitizeCss("a{background:url(http://x/y.png)} @import 'z.css'; b{width:expression(alert(1))}");
    expect(out).not.toMatch(/url\s*\(|@import|expression\s*\(/i);
  });

  it("cannot re-form an HTML comment delimiter from nested remnants", () => {
    const out = sanitizeCss("<!<!---->--x--><!--");
    expect(out).not.toContain("<!--");
    expect(out).not.toContain("-->");
    expect(out).not.toContain("<");
  });

  it("strips the --!> comment terminator and any tag opener", () => {
    const out = sanitizeCss("a{}--!></style><script>alert(1)</script>");
    expect(out).not.toContain("--!>");
    expect(out).not.toContain("<");
  });

  it("cannot re-form url( from nested remnants", () => {
    const out = sanitizeCss("a{b:u@import x;rl(1)}");
    expect(out).not.toMatch(/url\s*\(/i);
  });

  it("leaves ordinary CSS untouched", () => {
    const css = "a > b { color: #fff; margin: 0 auto; }";
    expect(sanitizeCss(css)).toBe(css);
  });
});
