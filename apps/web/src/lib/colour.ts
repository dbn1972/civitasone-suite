/**
 * GAP-THEMES-TOKENS-04: a single, strict "is this value a CSS colour we can
 * safely render as a swatch?" predicate, shared by the Tokens stat count
 * (themes/tokens/page.tsx) and the token table swatch (ThemeTokenTable.tsx)
 * so the two can never drift apart.
 *
 * The previous `/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/` only matched 3- or
 * 6-digit hex, so rgb()/hsl()/8-digit (#rrggbbaa) and 4-digit (#rgba) colours
 * were miscounted as scalar tokens and shown without a swatch.
 *
 * Deliberately strict: only #hex (3/4/6/8 digits), rgb()/rgba() and
 * hsl()/hsla() are accepted. url(), var(), named colours and free text are
 * rejected — the swatch sets `background` from this value, so letting
 * arbitrary CSS through would be a style-injection vector.
 */

// #rgb, #rgba, #rrggbb, #rrggbbaa
const HEX_RE = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

// rgb(...) / rgba(...): only digits, dots, %, commas, slash and spaces inside.
const RGB_RE = /^rgba?\(\s*[\d.]+%?(?:\s*[,/]?\s*[\d.]+%?){2,3}\s*\)$/i;

// hsl(...) / hsla(...): hue (optionally deg/rad/turn), then 2-3 more values.
const HSL_RE = /^hsla?\(\s*[\d.]+(?:deg|rad|turn)?%?(?:\s*[,/]?\s*[\d.]+%?){2,3}\s*\)$/i;

/**
 * True when `value` is a CSS colour literal safe to render as a swatch
 * background. Trims surrounding whitespace; rejects empty, named colours,
 * url(), var() and anything else.
 */
export function isCssColour(value: string | null | undefined): boolean {
  if (value === null || value === undefined) return false;
  const v = value.trim();
  if (!v) return false;
  // #hex must have no interior whitespace (the regex is anchored, but guard
  // the length explicitly for the fixed hex forms).
  if (v.startsWith("#")) return HEX_RE.test(v);
  return RGB_RE.test(v) || HSL_RE.test(v);
}
