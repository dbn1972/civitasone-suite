import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * GAP-HR-SHIFT-REQUESTS-04: compact buttons on desktop, 44px (WCAG 2.5.5)
 * targets on touch. The size must live in the design-system stylesheet --
 * not in per-call inline minHeight -- so every `size="sm"` Button gets the
 * same behaviour: ~36px rows for a mouse, >= 44px for a coarse pointer.
 */
const css = readFileSync(path.join(__dirname, "civitas-ds.css"), "utf8");

// Strip comments so assertions only see real rules.
const rules = css.replace(/\/\*[\s\S]*?\*\//g, "");

describe("civitas-ds.css button touch targets", () => {
  it("the base .btn.sm rule does not force a min-height (desktop stays compact)", () => {
    const base = /(?:^|\})\s*\.btn\.sm\s*\{([^}]*)\}/.exec(rules);
    expect(base, "expected a base .btn.sm rule").not.toBeNull();
    expect(base![1]).not.toMatch(/min-height/);
  });

  it("a (pointer:coarse) media rule gives .btn.sm a 44px minimum height", () => {
    const m = /@media\s*\(\s*pointer\s*:\s*coarse\s*\)\s*\{\s*\.btn\.sm\s*\{([^}]*)\}\s*\}/.exec(rules);
    expect(m, "expected @media (pointer:coarse){.btn.sm{...}}").not.toBeNull();
    expect(m![1]).toMatch(/min-height\s*:\s*44px/);
  });
});
