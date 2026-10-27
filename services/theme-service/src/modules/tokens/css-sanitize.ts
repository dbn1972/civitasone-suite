/**
 * Sanitize user-supplied CSS to prevent injection attacks.
 * Removes dangerous constructs: @import, url(), expression(), javascript:, behavior, -moz-binding, and any
 * HTML-significant `<` / comment delimiters (so the CSS can never close a <style> element or open a tag).
 *
 * CodeQL js/incomplete-multi-character-sanitization + js/bad-tag-filter: a single replace pass can
 * RE-FORM a forbidden token from the remnants of another (e.g. "<!<!---->--" -> "<!--"), and the old comment
 * filter missed the "--!>" terminator. The rules are therefore re-applied until the output is stable, and the
 * result fails closed if it does not converge.
 */
const SANITIZED = "/* [sanitized] */";

const RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/expression\s*\([^)]*\)/gi, SANITIZED],
  [/@import\b[^;]*/gi, SANITIZED],
  [/url\s*\([^)]*\)/gi, SANITIZED],
  [/javascript\s*:/gi, SANITIZED],
  [/behavior\s*:/gi, SANITIZED],
  [/-moz-binding\s*:/gi, SANITIZED],
  [/<!--|--!?>/g, ""],
  [/</g, ""],
];

const MAX_PASSES = 16;

export function sanitizeCss(raw: string): string {
  let css = raw;
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const before = css;
    for (const [re, replacement] of RULES) css = css.replace(re, replacement);
    if (css === before) return css;
  }
  return SANITIZED;
}
