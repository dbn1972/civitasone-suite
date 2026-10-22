import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * GAP-HR-DASHBOARD-09 guard.
 *
 * An earlier pass turned `var(--dash-x, #hex)` into a bare `var(--dash-x)`
 * without ever defining the token, so the greeting gradient, avatar tints and
 * two chart series silently resolved to nothing. This locks the three things
 * that make that class of bug impossible to repeat:
 *
 *  1. colour literals live ONLY in the token blocks of dashboard.css -- no
 *     .ts/.tsx file here, and no other CSS rule, contains one;
 *  2. every custom property the dashboard references is actually defined there;
 *  3. the avatar and greeting colour pairs are legible (WCAG AA 4.5:1) in both
 *     themes, and no component injects its own inline <style>.
 */
const DIR = __dirname;

function walk(p: string): string[] {
  if (statSync(p).isFile()) return [p];
  return readdirSync(p).flatMap((n) => walk(join(p, n)));
}

const SOURCES = walk(DIR).filter((f) => /\.(tsx?|css)$/.test(f) && !/\.test\.tsx?$/.test(f));
const CSS_PATH = join(DIR, "dashboard.css");
const css = readFileSync(CSS_PATH, "utf8");

const HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/;
const TOKEN_DECL = /^\s*--[\w-]+\s*:/;

/** `--name: value;` declarations inside the rule that opens with `selector {`. */
function tokensIn(selector: string): Record<string, string> {
  const start = css.indexOf(`\n${selector} {`);
  if (start < 0) throw new Error(`selector not found: ${selector}`);
  const end = css.indexOf("\n}", start);
  const out: Record<string, string> = {};
  for (const m of css.slice(start, end).matchAll(/^\s*(--[\w-]+)\s*:\s*([^;]+);/gm)) out[m[1]!] = m[2]!.trim();
  return out;
}

const light = tokensIn(".hr-dashboard-root");
const dark = tokensIn(".dark .hr-dashboard-root");

function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const [r, g, b] = [0, 2, 4]
    .map((i) => parseInt(full.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

describe("HR dashboard colour tokens (GAP-HR-DASHBOARD-09)", () => {
  it("only token declarations contain a colour literal", () => {
    const bad: string[] = [];
    for (const f of SOURCES) {
      readFileSync(f, "utf8").split("\n").forEach((line, i) => {
        if (HEX.test(line) && !(f === CSS_PATH && TOKEN_DECL.test(line))) {
          bad.push(`${relative(DIR, f)}:${i + 1}: ${line.trim().slice(0, 100)}`);
        }
      });
    }
    expect(bad).toEqual([]);
  });

  it("no component or page injects its own inline <style> block", () => {
    const offenders = SOURCES.filter((f) => /\.tsx$/.test(f) && /<style[\s>]/.test(readFileSync(f, "utf8"))).map((f) => relative(DIR, f));
    expect(offenders).toEqual([]);
  });

  it("every --dash-* / --page-bg custom property the dashboard uses is defined for the light theme", () => {
    const used = new Set<string>();
    for (const f of SOURCES) {
      for (const m of readFileSync(f, "utf8").matchAll(/var\((--(?:dash-[\w-]+|page-bg))/g)) used.add(m[1]!);
    }
    expect(used.size).toBeGreaterThan(0);
    expect([...used].filter((t) => !(t in light))).toEqual([]);
  });

  it("every avatar and chart-series token also has a dark-theme value", () => {
    const needDark = Object.keys(light).filter((t) => /^--dash-(avatar|dept-series)-/.test(t));
    expect(needDark).toHaveLength(14);
    expect(needDark.filter((t) => !(t in dark))).toEqual([]);
  });

  it.each([
    ["light", light],
    ["dark", dark],
  ] as const)("every avatar tint is legible in the %s theme (>= 4.5:1)", (_theme, tokens) => {
    for (let n = 1; n <= 6; n++) {
      expect(contrast(tokens[`--dash-avatar-fg-${n}`]!, tokens[`--dash-avatar-bg-${n}`]!), `avatar ${n}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("greeting text colours clear 4.5:1 against the lightest gradient stop", () => {
    const worst = light["--dash-greeting-grad-3"]!;
    for (const t of ["--dash-greeting-eyebrow", "--dash-greeting-title", "--dash-greeting-sub", "--dash-greeting-btn-fg"]) {
      expect(contrast(light[t]!, worst), t).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("the dark theme overrides only what has to change", () => {
    // The banner is a dark navy gradient in both themes, so only avatars, chart
    // series and the page background differ -- a stray dark override of a
    // greeting colour would silently desync the banner's contrast maths.
    const extra = Object.keys(dark).filter((t) => t !== "--page-bg" && !/^--dash-(avatar|dept-series)-/.test(t));
    expect(extra).toEqual([]);
  });
});
