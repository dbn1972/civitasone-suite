// scripts/governance/skills-audit.test.ts
//
// Unit tests for skill inventory and duplication detection.
// Task 8.5: assert inventorySkills() correctly parses domain and line count
// for all real skill files, and assert a synthetic skill snippet duplicating
// the "Test Coverage — Hard Rule" text from tech.md is detected and
// correctly replaced with a steering reference.
//
// No property-based tests here: skill content wording is a manual/reviewed
// decision per the design's testing strategy, not a universal property.
//
// Feature: agent-context-governance-refresh

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseSections, classifySection, type SteeringSection } from "./steering-audit.js";
import { inventorySkills, findEnforceableRuleDuplication, replaceDuplicatedContent } from "./skills-audit.js";

const SKILLS_DIR = join(__dirname, "../../.claude/skills");
const STEERING_DIR = join(__dirname, "../../../.kiro/steering");

// The real, current set of Skill_Files under civitasone-suite/.claude/skills/
// (the 11 pre-existing files + the 4 new ones added by this feature's tasks
// 8.3/8.4). Kept as an explicit expected set (rather than just checking
// `.length`) so a file being accidentally renamed/removed/added is caught
// precisely, and each domain substring is checked against the real "When to
// load" header text.
const EXPECTED_SKILLS: { file: string; domainSubstring: string }[] = [
  { file: "01-finance-double-entry.md", domainSubstring: "finance-service" },
  { file: "02-procurement-workflows.md", domainSubstring: "procurement-service" },
  { file: "03-rbac-policy-language.md", domainSubstring: "policy-service" },
  { file: "04-audit-event-spec.md", domainSubstring: "audit-service" },
  { file: "05-multi-tenant-isolation.md", domainSubstring: "Every PR" },
  { file: "06-installer-readiness-score.md", domainSubstring: "install-service" },
  { file: "07-queue-message-design.md", domainSubstring: "event producer or consumer" },
  { file: "08-accessibility-wcag-22.md", domainSubstring: "apps/web" },
  { file: "09-localisation-i18n.md", domainSubstring: "user-facing copy" },
  { file: "10-form-and-input-validation.md", domainSubstring: "form, DTO, or input boundary" },
  { file: "11-secure-coding-sast.md", domainSubstring: "handler, repo, integration" },
  { file: "12-meeting-governance-domain.md", domainSubstring: "meeting-service" },
  { file: "13-court-case-management-domain.md", domainSubstring: "court-service" },
  { file: "14-visitor-management-domain.md", domainSubstring: "visitor-service" },
  { file: "15-metadata-custom-object-engine.md", domainSubstring: "metadata-service" },
];

describe("inventorySkills", () => {
  // _Requirements: 4.1

  it("returns exactly the expected skill files, sorted by file name", () => {
    const inventory = inventorySkills(SKILLS_DIR);
    const files = inventory.map((s) => s.file);
    expect(files).toEqual(EXPECTED_SKILLS.map((s) => s.file).sort());
  });

  it("parses each real skill file's domain from its 'When to load' header and a positive line count", () => {
    const inventory = inventorySkills(SKILLS_DIR);
    const byFile = new Map(inventory.map((s) => [s.file, s]));

    for (const expected of EXPECTED_SKILLS) {
      const info = byFile.get(expected.file);
      expect(info, `expected ${expected.file} to be inventoried`).toBeDefined();
      expect(info!.domain).toContain(expected.domainSubstring);
      expect(info!.lineCount).toBeGreaterThan(0);
      // Sanity check: lineCount matches the actual file's line count.
      const text = readFileSync(join(SKILLS_DIR, expected.file), "utf8");
      expect(info!.lineCount).toBe(text.split(/\r?\n/).length);
    }
  });
});

describe("findEnforceableRuleDuplication / replaceDuplicatedContent", () => {
  // _Requirements: 4.2, 4.3

  function loadTechEnforceableRules(): ReturnType<typeof classifySection>[] {
    const markdown = readFileSync(join(STEERING_DIR, "tech.md"), "utf8");
    const sections: SteeringSection[] = parseSections(markdown, "tech.md");
    return sections.map((section) => classifySection(section, sections));
  }

  it("detects a synthetic skill snippet duplicating tech.md's 'Test Coverage — Hard Rule' section", () => {
    const classified = loadTechEnforceableRules();
    const coverageRule = classified.find((s) => s.heading.includes("Test Coverage") && s.classification === "Enforceable_Rule");
    expect(coverageRule, "expected 'Test Coverage — Hard Rule' to classify as Enforceable_Rule").toBeDefined();

    // A synthetic skill file whose body duplicates the coverage rule's exact
    // text verbatim (as if someone had copy-pasted it into a skill file).
    const syntheticSkillText = [
      "# Skill — Synthetic Duplicate Test",
      "",
      "**When to load:** For this unit test only.",
      "",
      "---",
      "",
      "## Test Coverage — Hard Rule (Enforced)",
      "",
      coverageRule!.bodyText,
      "",
      "## Some Other Section",
      "",
      "This section is unrelated and should not be flagged.",
    ].join("\n");

    const findings = findEnforceableRuleDuplication(
      [{ file: "synthetic.md", text: syntheticSkillText }],
      classified
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]!.skillFile).toBe("synthetic.md");
    expect(findings[0]!.matchedRuleDocument).toBe("tech.md");
    expect(findings[0]!.matchedRuleHeading).toContain("Test Coverage");

    const replaced = replaceDuplicatedContent(syntheticSkillText, findings[0]!);

    // The duplicated body text is gone, replaced by a steering reference.
    expect(replaced).not.toContain(coverageRule!.bodyText);
    expect(replaced).toContain("> See steering: `tech.md`");
    expect(replaced).toContain("Test Coverage");
    // The unrelated section is untouched.
    expect(replaced).toContain("## Some Other Section");
    expect(replaced).toContain("This section is unrelated and should not be flagged.");
  });

  it("does not flag an unrelated skill block against the same Enforceable_Rule set", () => {
    const classified = loadTechEnforceableRules();
    const syntheticSkillText = [
      "# Skill — Unrelated",
      "",
      "**When to load:** Never, this is just a test fixture.",
      "",
      "## Something Else Entirely",
      "",
      "This paragraph has nothing to do with test coverage, finance, or any",
      "other Enforceable_Rule from tech.md. It should not match anything.",
    ].join("\n");

    const findings = findEnforceableRuleDuplication([{ file: "unrelated.md", text: syntheticSkillText }], classified);
    expect(findings).toHaveLength(0);
  });

  it("replaceDuplicatedContent is a no-op when the snippet is no longer present", () => {
    const classified = loadTechEnforceableRules();
    const coverageRule = classified.find((s) => s.heading.includes("Test Coverage"))!;
    const finding = {
      skillFile: "synthetic.md",
      matchedRuleHeading: coverageRule.heading,
      matchedRuleDocument: "tech.md",
      overlapSnippet: "this exact text does not appear anywhere in the target",
    };

    const text = "# Some skill\n\nUnrelated content.";
    expect(replaceDuplicatedContent(text, finding)).toBe(text);
  });
});
