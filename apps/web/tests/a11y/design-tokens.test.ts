/**
 * Design-token contrast gate (WCAG 2.2 AA, SC 1.4.3 / 1.4.11).
 *
 * Runs in the unit suite (no browser needed) so a token regression is caught in
 * seconds rather than by the full axe sweep. The axe gate remains the source of
 * truth for rendered pages; this catches the single most common root cause —
 * someone lightening a text token — before it reaches 50 routes at once.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const CSS = readFileSync(
  join(__dirname, "../../src/app/civitas-ds.css"),
  "utf8",
);

/** Relative luminance per WCAG 2.x definition. */
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const channel = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return (
    0.2126 * channel((n >> 16) & 255) +
    0.7152 * channel((n >> 8) & 255) +
    0.0722 * channel(n & 255)
  );
}

export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Read a `--name:#rrggbb` token out of the :root block. */
function token(name: string): string {
  const m = CSS.match(new RegExp(`--${name}\\s*:\\s*(#[0-9a-fA-F]{6})`));
  if (!m?.[1]) throw new Error(`design token --${name} not found in civitas-ds.css`);
  return m[1].toLowerCase();
}

/**
 * Text tokens rendered on the panel/white surface. Every one must clear 4.5:1.
 * `--mut` is included deliberately: it was #98a2b3 (2.58:1) and appeared on every
 * page via the sidebar, which is what made this a fleet-wide violation.
 */
const TEXT_ON_WHITE = ["ink", "ink2", "mut"] as const;

/** Status text tokens, each rendered on its own tinted background. */
const STATUS_PAIRS: [string, string][] = [
  ["good", "goodbg"],
  ["warn", "warnbg"],
  ["bad", "badbg"],
  ["info", "infobg"],
];

describe("design tokens meet WCAG 2.2 AA contrast", () => {
  it.each(TEXT_ON_WHITE)("--%s has >= 4.5:1 against the panel surface", (name) => {
    const fg = token(name);
    const bg = token("panel");
    const ratio = contrastRatio(fg, bg);
    expect(
      ratio,
      `--${name} (${fg}) on --panel (${bg}) is ${ratio.toFixed(2)}:1. ` +
        `WCAG 2.2 AA SC 1.4.3 requires 4.5:1 for body text. ` +
        `This token is used across the app shell, so lowering it fails many routes at once.`,
    ).toBeGreaterThanOrEqual(4.5);
  });

  it.each(STATUS_PAIRS)("--%s has >= 4.5:1 against --%s", (fgName, bgName) => {
    const fg = token(fgName);
    const bg = token(bgName);
    const ratio = contrastRatio(fg, bg);
    expect(
      ratio,
      `--${fgName} (${fg}) on --${bgName} (${bg}) is ${ratio.toFixed(2)}:1, need 4.5:1`,
    ).toBeGreaterThanOrEqual(4.5);
  });

  it("the previously-failing --mut value is not reintroduced", () => {
    // Guards against a revert restoring the exact non-compliant value.
    expect(
      token("mut"),
      "--mut is back to #98a2b3, which is 2.58:1 on white and fails WCAG 2.2 AA",
    ).not.toBe("#98a2b3");
  });
});
