// scripts/governance/skills-audit.ts
//
// Skill Auditor — see design.md's
// "4. Skill Auditor (scripts/governance/skills-audit.ts)" component.
//
// This file implements tasks 8.1 (inventorySkills) and 8.2
// (findEnforceableRuleDuplication, replaceDuplicatedContent).

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { ClassifiedSection } from "./steering-audit.js";

// ─────────────────────────────────────────────────────────────────────────────
// inventorySkills() — task 8.1
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Inventory entry for a single Skill_File under `civitasone-suite/.claude/skills/`.
 */
export interface SkillFileInfo {
  file: string; // "01-finance-double-entry.md"
  domain: string; // parsed from the "When to load" header line
  lineCount: number;
}

// Matches every real skill file's "**When to load:** <domain text>" line
// (task 8.1's "When to load" header). All 11 existing skill files (and the
// new ones added by this feature) use this exact bold-label convention on
// its own line, so a single-line regex is sufficient — no skill file wraps
// its "When to load" scope across multiple lines.
const WHEN_TO_LOAD_RE = /^\*\*When to load:\*\*\s*(.+)$/m;

/**
 * Reads every `*.md` file directly under `skillsDir` and records its stated
 * domain (parsed from the "When to load" header line) and line count.
 *
 * A skill file missing a "When to load" line (malformed/incomplete) gets an
 * empty-string domain rather than throwing — inventorying is a read-only
 * audit step, not a validator; a missing header is visible in the
 * Governance_Report as an empty domain rather than crashing the audit.
 *
 * Results are sorted by file name for deterministic output (mirrors
 * `listServiceRegistry`'s determinism rationale in reconcile-services.ts).
 */
export function inventorySkills(skillsDir: string): SkillFileInfo[] {
  const entries = readdirSync(skillsDir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name)
    .sort();

  return files.map((file) => {
    const text = readFileSync(join(skillsDir, file), "utf8");
    const match = WHEN_TO_LOAD_RE.exec(text);
    const domain = match?.[1] !== undefined ? match[1].trim() : "";
    const lineCount = text.split(/\r?\n/).length;
    return { file, domain, lineCount };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// findEnforceableRuleDuplication() / replaceDuplicatedContent() — task 8.2
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A single instance of a Skill_File duplicating an `Enforceable_Rule`
 * steering section, per design.md's Skill Auditor component.
 */
export interface DuplicationFinding {
  skillFile: string;
  matchedRuleHeading: string; // e.g. "## Test Coverage — Hard Rule (Enforced)"
  matchedRuleDocument: string; // "tech.md"
  overlapSnippet: string; // the exact skill-file substring that duplicates the rule
}

const DUPLICATE_OVERLAP_THRESHOLD = 0.9;

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

function tokenize(text: string): string[] {
  return normalizeText(text)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0);
}

/**
 * Directional token-overlap ratio, matching steering-audit.ts's
 * `tokenOverlapRatio`: the fraction of the *smaller* text's unique tokens
 * that also appear in the other text. This means a short skill-file block
 * fully contained inside a longer steering rule (or vice versa) still
 * registers as a near-duplicate, consistent with the design's "≥90%
 * normalized token overlap" framing used for the analogous steering-vs-
 * steering duplicate check.
 */
function tokenOverlapRatio(a: string, b: string): number {
  const tokensA = new Set(tokenize(a));
  const tokensB = new Set(tokenize(b));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let shared = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) shared += 1;
  }
  return shared / Math.min(tokensA.size, tokensB.size);
}

const SKILL_HEADING_RE = /^(#{1,6})\s+/;

/**
 * A single "##" (level 2) heading-delimited block of a skill file's
 * markdown. Mirrors steering-audit.ts's `parseSections` boundary rule
 * exactly (only level-2 headings start a block; the block runs until the
 * next same-or-higher-level heading, i.e. level 1 or 2; deeper headings
 * stay nested inside the enclosing block's body) so a skill file's `##`
 * sections are compared against steering's `##` sections on equal terms.
 * The file's preamble (level-1 title, "When to load" line, anything before
 * the first "##") is deliberately NOT emitted as a block, for the same
 * reason steering-audit.ts skips its preamble — it carries no independently
 * governed content of its own.
 */
interface SkillBlock {
  heading: string; // e.g. "## Test Coverage — Hard Rule (Enforced)"
  body: string; // raw text under the heading, exactly as it appears in the file
}

/**
 * Splits a skill file's markdown into `##`-delimited blocks. Each block's
 * `body` is the exact original substring between its heading line and the
 * next same-or-higher-level heading (or EOF) — preserved verbatim so
 * `replaceDuplicatedContent` can perform a plain string replacement.
 */
function splitIntoBlocks(text: string): SkillBlock[] {
  const lines = text.split(/\r?\n/);
  const headingLines: { index: number; level: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const match = SKILL_HEADING_RE.exec(lines[i] ?? "");
    if (match && match[1] !== undefined) {
      headingLines.push({ index: i, level: match[1].length });
    }
  }

  const blocks: SkillBlock[] = [];

  for (let h = 0; h < headingLines.length; h++) {
    const current = headingLines[h];
    if (current === undefined || current.level !== 2) continue; // only "##" headings start a block

    let endIndex = lines.length;
    for (let j = h + 1; j < headingLines.length; j++) {
      const next = headingLines[j];
      if (next !== undefined && next.level <= 2) {
        endIndex = next.index;
        break;
      }
    }
    blocks.push({
      heading: lines[current.index] ?? "",
      body: lines.slice(current.index + 1, endIndex).join("\n"),
    });
  }

  return blocks;
}

/**
 * Compares every Skill_File's text against the `Enforceable_Rule`-classified
 * steering sections (produced by `classifySection` in task 2.2) to find
 * duplicated content: a skill-file heading-delimited block whose body has
 * ≥90% directional token overlap with an Enforceable_Rule section's
 * `bodyText`.
 *
 * `enforceableRules` may contain sections of any classification — only those
 * with `classification === "Enforceable_Rule"` are compared against, so
 * callers can pass the full classified-section list from
 * `auditSteeringDocuments` without pre-filtering.
 *
 * A block with empty/near-empty body (fewer than 3 tokens) is skipped: a
 * bare heading or a one-word body can trivially "overlap" 100% with a short
 * rule fragment without being a meaningful duplication.
 */
export function findEnforceableRuleDuplication(
  skills: { file: string; text: string }[],
  enforceableRules: ClassifiedSection[]
): DuplicationFinding[] {
  const rules = enforceableRules.filter((section) => section.classification === "Enforceable_Rule");
  const findings: DuplicationFinding[] = [];

  for (const skill of skills) {
    const blocks = splitIntoBlocks(skill.text);
    for (const block of blocks) {
      if (tokenize(block.body).length < 3) continue;

      for (const rule of rules) {
        if (tokenOverlapRatio(block.body, rule.bodyText) >= DUPLICATE_OVERLAP_THRESHOLD) {
          findings.push({
            skillFile: skill.file,
            matchedRuleHeading: rule.heading,
            matchedRuleDocument: rule.document,
            overlapSnippet: block.body,
          });
          break; // one finding per block is enough; move to the next block
        }
      }
    }
  }

  return findings;
}

/**
 * Replaces the duplicated block identified by `finding` with a reference to
 * the authoritative steering rule, per design.md's Skill Auditor component:
 *
 *   > See steering: `<document>` → "<heading>" for the authoritative rule.
 *
 * Performs a plain substring replacement of `finding.overlapSnippet` (the
 * exact original text captured by `findEnforceableRuleDuplication`) — if
 * `skillText` no longer contains that exact snippet (e.g. it was already
 * edited), `skillText` is returned unchanged rather than throwing.
 */
export function replaceDuplicatedContent(skillText: string, finding: DuplicationFinding): string {
  if (!skillText.includes(finding.overlapSnippet)) return skillText;

  const headingText = finding.matchedRuleHeading.replace(/^#+\s*/, "");
  const referenceLine = `> See steering: \`${finding.matchedRuleDocument}\` → "${headingText}" for the authoritative rule.`;

  return skillText.replace(finding.overlapSnippet, referenceLine);
}
