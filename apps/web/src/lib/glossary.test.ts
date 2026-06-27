import { describe, it, expect } from "vitest";
import { GLOSSARY, explain, hasDefinition } from "./glossary";

/**
 * Requirement 2.1 — the glossary must define every mandated specialist term.
 * Requirement 2.4 — every definition must be a non-empty plain sentence.
 */
const MANDATED_TERMS = [
  "PPO", "DDO", "DBT", "ESI", "PT", "IRN", "UTR", "NEFT", "RTGS",
  "BE", "RE", "CPC", "MOM", "KRA", "DAK",
];

describe("glossary coverage (R2.1, R2.4)", () => {
  it.each(MANDATED_TERMS)("defines %s", (term) => {
    const def = explain(term);
    expect(def, `missing definition for ${term}`).toBeTruthy();
    expect((def ?? "").trim().length).toBeGreaterThan(10);
  });

  it("resolves terms case-insensitively", () => {
    expect(explain("ppo")).toBe(explain("PPO"));
    expect(explain("neft")).toBeTruthy();
  });

  it("hasDefinition never throws and reports misses", () => {
    expect(hasDefinition("PPO")).toBe(true);
    expect(hasDefinition("totally-unknown-term-xyz")).toBe(false);
  });

  it("every definition is a non-empty string", () => {
    for (const [term, def] of Object.entries(GLOSSARY)) {
      expect(def.trim().length, `empty definition for ${term}`).toBeGreaterThan(0);
    }
  });
});
