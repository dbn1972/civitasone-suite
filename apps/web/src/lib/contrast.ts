/**
 * WCAG 2.x relative-luminance contrast ratio.
 * https://www.w3.org/TR/WCAG21/#dfn-relative-luminance
 */
function srgbToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function hexToRgb(hex: string): [number, number, number] {
  const normalized = hex.replace("#", "");
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  return [r, g, b];
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

/** Contrast ratio between two colours (1:1 to 21:1), per the WCAG formula. Symmetric. */
export function contrast(hexA: string, hexB: string): number {
  const lA = relativeLuminance(hexA);
  const lB = relativeLuminance(hexB);
  const lighter = Math.max(lA, lB);
  const darker = Math.min(lA, lB);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Alias of {@link contrast} with the name the branding editor reads for.
 * Kept as a distinct export so call-sites that talk about a foreground /
 * background *ratio* read naturally, without re-implementing the formula.
 */
export const contrastRatio = contrast;

/** WCAG 2.2 AA (SC 1.4.3) normal-text threshold. */
export const WCAG_AA_NORMAL = 4.5;

/**
 * Pick black (#111827) or white (#ffffff) foreground for a given background so
 * the pair clears WCAG 2.2 AA whatever colour a tenant chooses. Uses the WCAG
 * relative-luminance formula (not a naive brightness average) because the two
 * disagree near mid-tones — amber/teal — which is exactly where a hardcoded
 * white foreground fails. Invalid/short hex falls back to near-black.
 */
export function readableForeground(background: string): string {
  const hex = background.replace("#", "");
  const full =
    hex.length === 3
      ? hex
          .split("")
          .map((c) => c + c)
          .join("")
      : hex;
  if (full.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(full)) return "#111827";
  const againstWhite = contrast(`#${full}`, "#ffffff");
  const againstBlack = contrast(`#${full}`, "#111827");
  return againstBlack >= againstWhite ? "#111827" : "#ffffff";
}
