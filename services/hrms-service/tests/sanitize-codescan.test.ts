import { describe, it, expect } from "vitest";
import { sanitizeString, sanitizeInput } from "../src/shared/sanitize.js";

/**
 * CodeQL js/bad-tag-filter (#18), js/incomplete-multi-character-sanitization (#13 #14 #15),
 * js/incomplete-url-scheme-check (#2): the sanitizer must not be bypassable by nesting,
 * multi-line script bodies, spaced end tags or non-javascript script schemes.
 */
describe("hrms sanitizeString hardening", () => {
  it("removes a multi-line <script> body", () => {
    expect(sanitizeString("a<script>\nalert(1)\n</script>b")).toBe("ab");
  });
  it("removes a script block whose end tag has whitespace/attributes", () => {
    expect(sanitizeString("a<script>alert(1)</script >b")).toBe("ab");
    expect(sanitizeString("a<script>alert(1)</script foo=bar>b")).toBe("ab");
  });
  it("is case-insensitive for script tags", () => {
    expect(sanitizeString("a<ScRiPt>x</sCrIpT>b")).toBe("ab");
  });
  it.each([
    "<scr<script>ipt>alert(1)</scr</script>ipt>",
    "<<b>script>alert(1)<</b>/script>",
    "<scr<b>ipt>x</scr</b>ipt>",
  ])("nested construct %j leaves no tag", (input) => {
    const out = sanitizeString(input);
    expect(out).not.toMatch(/<\s*\/?\s*script/i);
    expect(sanitizeString(out)).toBe(out);
  });
  it("nested javascript: schemes collapse fully", () => {
    expect(sanitizeString("javajavascript:script:alert(1)")).toBe("alert(1)");
    expect(sanitizeString("JaVaScRiPt  :alert(1)")).toBe("alert(1)");
  });
  it("strips vbscript: and data: URIs", () => {
    expect(sanitizeString("vbscript:msgbox(1)")).toBe("msgbox(1)");
    expect(sanitizeString("data:text/html;base64,PHNjcmlwdD4=")).toBe("text/html;base64,PHNjcmlwdD4=");
  });
  it("does not mangle ordinary prose containing 'data' or 'metadata:'", () => {
    expect(sanitizeString("Metadata: complete")).toBe("Metadata: complete");
    expect(sanitizeString("data is fine")).toBe("data is fine");
  });
  it("nested event handlers collapse fully", () => {
    expect(sanitizeString("ononerror=onerror=x")).toBe("x");
  });
  it("is idempotent and still deep-sanitizes objects", () => {
    const dirty = { a: "<scr<script>ipt>x</scr</script>ipt>", b: ["<b>y</b>"], c: 3 };
    const once = sanitizeInput(dirty);
    expect(sanitizeInput(once)).toEqual(once);
    expect(JSON.stringify(once)).not.toMatch(/<\s*script/i);
  });
});
