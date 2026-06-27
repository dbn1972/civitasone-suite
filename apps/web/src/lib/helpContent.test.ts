import { describe, it, expect } from "vitest";
import { HELP_MODULES, MAJOR_MODULE_SLUGS, getHelpModule } from "./helpContent";
import { explain } from "./glossary";
import { findBannedTerms } from "./labels";

describe("Major-Module help coverage (R3.3, R3.4, R3.6, R3.7, R4.4)", () => {
  it.each(MAJOR_MODULE_SLUGS)("has a complete guide for %s", (slug) => {
    const mod = getHelpModule(slug);
    expect(mod, `missing guide for ${slug}`).toBeDefined();
    expect(mod!.major).toBe(true);
    expect(mod!.summary.trim().length).toBeGreaterThan(10); // R3.7
    expect(mod!.tasks.length, `no tasks for ${slug}`).toBeGreaterThan(0); // R4.4
    expect(mod!.terms.length, `no terms for ${slug}`).toBeGreaterThan(0); // R3.7
    for (const task of mod!.tasks) {
      expect(task.title.trim().length).toBeGreaterThan(0);
      expect(task.steps.length, `no steps for task ${task.title}`).toBeGreaterThan(0);
    }
  });

  it("provides Payroll as a standalone guide, not folded into HR (R3.4)", () => {
    expect(getHelpModule("payroll")).toBeDefined();
    expect(getHelpModule("hr")).toBeDefined();
  });

  it("provides an Establishment guide (R3.6)", () => {
    expect(getHelpModule("estab")).toBeDefined();
  });
});

describe("term consistency and plain language (R1.5, R12.1, R12.2, R14.4)", () => {
  it("every term referenced by a guide resolves in the glossary", () => {
    for (const mod of HELP_MODULES) {
      for (const term of mod.terms) {
        expect(explain(term), `unresolved term "${term}" in ${mod.slug}`).toBeTruthy();
      }
    }
  });

  it("guide copy contains no banned platform jargon", () => {
    for (const mod of HELP_MODULES) {
      const copy = [mod.summary, ...mod.tasks.flatMap((t) => [t.title, ...t.steps])].join(" ");
      expect(findBannedTerms(copy), `banned terms in ${mod.slug}`).toEqual([]);
    }
  });
});
