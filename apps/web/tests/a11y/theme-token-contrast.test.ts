/**
 * Theme token contrast gate, BOTH themes (UAT post-b14: dark-theme contrast
 * 17/17 screens, A-N1 footer 2.42:1).
 *
 * design-tokens.test.ts only reads the first `--name:#hex` match, i.e. the
 * light :root values. This test resolves every token for the light theme
 * (all `:root{}` blocks) and for the dark theme (light values overridden by
 * every `.dark{}` block), computes the WCAG 2.x contrast ratio of each
 * foreground/background pair actually used together, and fails below
 * 4.5:1 for text and 3:1 for UI component boundaries / focus indicators
 * (SC 1.4.3, 1.4.11, 2.4.7).
 *
 * It also pins the rules that used to bypass the tokens with literals and
 * were the real cause of the dark failures (white text on the light-blue dark
 * primary, white ghost buttons, the light-blue "what is new" banner).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "../..");
const CSS = readFileSync(join(ROOT, "src/app/civitas-ds.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const ch = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * ch((n >> 16) & 255) + 0.7152 * ch((n >> 8) & 255) + 0.0722 * ch(n & 255);
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Declarations of every block whose selector list is exactly `selector`. */
function blockTokens(selector: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = new RegExp("(?:^|[}\\s])" + escapeRe(selector) + "\\s*\\{([^}]*)\\}", "g");
  for (const m of CSS.matchAll(re)) {
    for (const d of (m[1] ?? "").matchAll(/--([\w-]+)\s*:\s*([^;]+)/g)) out[d[1]!] = d[2]!.trim();
  }
  return out;
}

const LIGHT = blockTokens(":root");
const DARK = { ...LIGHT, ...blockTokens(".dark") };
const THEMES = { light: LIGHT, dark: DARK } as const;

function hexOf(theme: Record<string, string>, name: string, seen = new Set<string>()): string {
  const raw = theme[name];
  if (!raw) throw new Error("token --" + name + " is not defined");
  const v = /^var\(--([\w-]+)/.exec(raw);
  if (v) {
    if (seen.has(name)) throw new Error("token cycle at --" + name);
    seen.add(name);
    return hexOf(theme, v[1]!, seen);
  }
  const h = /^#([0-9a-fA-F]{6})\b/.exec(raw);
  if (!h) throw new Error("token --" + name + " is not a #rrggbb colour (" + raw + ")");
  return "#" + h[1]!.toLowerCase();
}

const TEXT = 4.5;
const UI = 3;

/** [foreground, background, minimum] pairs rendered together in the app. */
const PAIRS: [string, string, number][] = [
  // body, secondary and muted text on both surfaces
  ...(["ink", "ink2", "mut", "muted"] as const).flatMap((fg) => [[fg, "panel", TEXT], [fg, "bg", TEXT]] as [string, string, number][]),
  // links / brand text, status text on surfaces and on their own tints
  ["primary", "panel", TEXT], ["primary", "bg", TEXT],
  ["info", "panel", TEXT], ["warn", "panel", TEXT], ["bad", "panel", TEXT], ["good", "panel", TEXT],
  ["good", "goodbg", TEXT], ["warn", "warnbg", TEXT], ["bad", "badbg", TEXT], ["info", "infobg", TEXT],
  ["ink", "infobg", TEXT], ["mut", "infobg", TEXT],
  // text on filled buttons (rest and hover)
  ["on-primary", "primary", TEXT], ["on-primary", "primary-d", TEXT],
  ["on-bad", "bad", TEXT], ["on-bad", "bad-d", TEXT],
  ["primary-d", "primary-soft-hover", TEXT],
  // footer (A-N1)
  ["footer-ink", "footer-bg", TEXT], ["footer-link", "footer-bg", TEXT],
  ["footer-link-hover", "footer-bg", TEXT], ["footer-heading", "footer-bg", TEXT],
  // UI components: control boundaries and focus indicators
  ["control-border", "panel", UI], ["control-border", "bg", UI],
  ["focus-ring", "panel", UI], ["focus-ring", "bg", UI],
  ["footer-focus", "footer-bg", UI],
];

describe.each(Object.keys(THEMES) as (keyof typeof THEMES)[])("%s theme token contrast", (themeName) => {
  const theme = THEMES[themeName];
  it.each(PAIRS)("--%s on --%s meets %s:1", (fg, bg, min) => {
    const f = hexOf(theme, fg);
    const b = hexOf(theme, bg);
    const r = contrast(f, b);
    expect(r, themeName + ": --" + fg + " " + f + " on --" + bg + " " + b + " is " + r.toFixed(2) + ":1, need " + min + ":1").toBeGreaterThanOrEqual(min);
  });
});

describe("contrast maths", () => {
  it("matches the WCAG reference values", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    // the A-N1 axe finding: #9ca3af on #f9fafb
    expect(contrast("#9ca3af", "#f9fafb")).toBeCloseTo(2.42, 1);
  });
});

/** The rule body for an exact selector (first match). */
function rule(selector: string): string {
  const m = new RegExp("(?:^|[}\\s])" + escapeRe(selector) + "\\s*\\{([^}]*)\\}").exec(CSS);
  if (!m) throw new Error("no CSS rule for " + selector);
  return m[1]!;
}

describe("components use the theme tokens, not literals that break in dark mode", () => {
  it("filled buttons take their text colour from --on-primary / --on-bad", () => {
    expect(rule(".btn.primary")).toMatch(/color:var\(--on-primary\)/);
    expect(rule(".btn.danger")).toMatch(/color:var\(--on-bad\)/);
    expect(rule(".btn.danger:hover")).toMatch(/background:var\(--bad-d\)/);
    expect(rule(".btn.secondary:hover")).toMatch(/background:var\(--primary-soft-hover\)/);
  });

  it("ghost buttons sit on the panel token, not #fff", () => {
    expect(rule(".btn.ghost")).toMatch(/background:var\(--panel\)/);
  });

  it("dark native selects get a token surface and text", () => {
    const r = rule(".dark select");
    expect(r).toMatch(/background-color:var\(--panel\)/);
    expect(r).toMatch(/color:var\(--ink\)/);
  });

  it("both footers use the footer tokens, with a visible focus indicator", () => {
    expect(rule(".app-foot")).toMatch(/color:var\(--footer-ink\)/);
    expect(rule(".app-foot-links a")).toMatch(/color:var\(--footer-link\)/);
    expect(rule(".site-foot")).toMatch(/color:var\(--footer-ink\)/);
    expect(rule(".site-foot a")).toMatch(/color:var\(--footer-link\)/);
    expect(CSS).toMatch(/\.site-foot a:focus-visible,\s*\.app-foot-links a:focus-visible\s*\{[^}]*outline:2px solid var\(--footer-focus\)/);
  });

  it("the light-only marketing surface pins the light footer tokens", () => {
    const pinned = blockTokens("[data-color-scheme=\"light\"]");
    for (const k of ["footer-bg", "footer-ink", "footer-link", "footer-link-hover", "footer-heading", "footer-line", "footer-focus"]) {
      expect(pinned[k], "--" + k).toBe(LIGHT[k]);
    }
  });

  it("PR #2454 review: the light-only marketing surface also pins the base text/surface tokens and its text colour", () => {
    const pinned = blockTokens("[data-color-scheme=\"light\"]");
    for (const k of ["bg", "panel", "ink", "ink2", "mut", "muted", "line", "line2"]) {
      expect(pinned[k], "--" + k).toBe(LIGHT[k]);
    }
    expect(rule("[data-color-scheme=\"light\"]")).toMatch(/color:var\(--ink\)/);
    // the pinned text on the pinned surface (what html.dark used to break: 1.21:1)
    expect(contrast(pinned.ink!, pinned.panel!)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(pinned.mut!, pinned.panel!)).toBeGreaterThanOrEqual(4.5);
  });

  it("PR #2454 review: the landing page has no text-gray-400 (2.53:1 on white)", () => {
    const src = readFileSync(join(ROOT, "src/app/(marketing)/page.tsx"), "utf8");
    expect(src).not.toMatch(/text-gray-400/);
  });

  it("the what-is-new banner uses tokens only", () => {
    const src = readFileSync(join(ROOT, "src/app/_components/WhatsNewBanner.tsx"), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});
