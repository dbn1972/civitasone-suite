// scripts/governance/correction-gate.ts
//
// Apply-vs-flag correction gate — see design.md's "Data Models" section
// (`Correction.touchesRolesCommandsOrBusinessRules`) and the Architecture
// diagram's `R6` decision node inside the Refresh_Process.
//
// Implements task 14.1:
//   - classifyCorrection() — the small pure heuristic rule set that decides
//     whether a proposed hook correction touches roles, commands, or
//     business rules (and must therefore be flagged needs-manual-review
//     rather than auto-applied).
//   - applyOrFlag()        — the R6 branch itself: reads a Correction's
//     precomputed `touchesRolesCommandsOrBusinessRules` flag and either
//     calls the caller-supplied apply function (mechanical fix, safe to
//     auto-apply) or refuses to (flagged, left for manual review).
//
// _Requirements: 8.3, 8.4

import type { Correction } from "./types.js";

// ─────────────────────────────────────────────────────────────────────────────
// Role-name detection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Known role words. Matched case-insensitively with underscore-tolerant
 * boundaries (so "finance_officer" is detected via "officer", and
 * "tenant_admin" is detected via "admin") but NOT as a substring of an
 * unrelated word (so "administrator" does not match "admin", and
 * "checkered" does not match "checker").
 */
const ROLE_WORDS = [
  "chairperson",
  "approver",
  "submitter",
  "maker",
  "checker",
  "admin",
  "officer",
  "requirerole",
  "requirepermission",
] as const;

/**
 * Builds a case-insensitive, underscore-tolerant "whole word" regex for a
 * lowercase role word: matches the word only when it is not immediately
 * preceded/followed by another a-z letter (so underscores, digits, spaces,
 * punctuation, and string boundaries all count as valid neighbors, but
 * "admin" inside "administrator" does not match).
 */
function wholeWordRegExp(word: string): RegExp {
  return new RegExp(`(?<![a-z])${word}(?![a-z])`, "i");
}

const ROLE_WORD_PATTERNS: readonly { word: string; pattern: RegExp }[] = ROLE_WORDS.map((word) => ({
  word,
  pattern: wholeWordRegExp(word),
}));

/**
 * Returns the set of known role words mentioned in `text`.
 */
function extractRoleMentions(text: string): Set<string> {
  const found = new Set<string>();
  for (const { word, pattern } of ROLE_WORD_PATTERNS) {
    if (pattern.test(text)) found.add(word);
  }
  return found;
}

function setsDiffer(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return true;
  for (const value of a) {
    if (!b.has(value)) return true;
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Command detection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Known command/tool executable names. A correction "changes the command
 * being run" when the (tool, action) pairs extracted from `before` differ
 * from those extracted from `after` — as opposed to merely changing a path
 * or directory string that happens to sit elsewhere in the same text (the
 * `docs/database/` → `docs/DATABASE-SCHEMA.md` worked example: neither side
 * mentions a command/tool token at all, so no command change is detected).
 */
const COMMAND_TOOLS = [
  "pnpm",
  "npm",
  "npx",
  "yarn",
  "tsx",
  "tsc",
  "vitest",
  "playwright",
  "eslint",
  "jest",
  "docker",
  "git",
  "k6",
  "terraform",
  "ansible",
  "helm",
  "curl",
  "bash",
  "sh",
] as const;

const COMMAND_TOOLS_SET: ReadonlySet<string> = new Set(COMMAND_TOOLS);

function isFlagToken(token: string): boolean {
  return token.startsWith("-");
}

function isPathOrPackageToken(token: string): boolean {
  return token.includes("/") || token.startsWith("@");
}

/**
 * Extracts a set of `"tool action"` signatures from free text: for every
 * occurrence of a known tool token, the next token that is not a flag
 * (`--coverage`), not a path (`docs/api/`), and not a scoped package
 * specifier (`@civitasone/finance-service`) is taken as the tool's "action"
 * (subcommand or script name, e.g. `test`, `lint`, `build`, `run`).
 *
 * A tool mention with no qualifying action token still contributes a
 * `"tool"`-only signature, so a bare tool-name change (e.g. `docker` →
 * `terraform`) is still detected even without a following action word.
 */
function extractCommandSignatures(text: string): Set<string> {
  const tokens = text.split(/\s+/).filter((t) => t.length > 0);
  const signatures = new Set<string>();

  for (let i = 0; i < tokens.length; i++) {
    const raw = tokens[i];
    if (raw === undefined) continue;
    const normalized = raw.replace(/^[("'`]+|[)"'`.,;:]+$/g, "");
    const lower = normalized.toLowerCase();
    if (!COMMAND_TOOLS_SET.has(lower)) continue;

    let action: string | null = null;
    for (let j = i + 1; j < tokens.length; j++) {
      const candidateRaw = tokens[j];
      if (candidateRaw === undefined) continue;
      const candidate = candidateRaw.replace(/^[("'`]+|[)"'`.,;:]+$/g, "");
      if (candidate.length === 0) continue;
      if (isFlagToken(candidate)) continue;
      if (isPathOrPackageToken(candidate)) continue;
      action = candidate.toLowerCase();
      break;
    }

    signatures.add(action === null ? lower : `${lower} ${action}`);
  }

  return signatures;
}

// ─────────────────────────────────────────────────────────────────────────────
// Business-rule sentence detection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Markers that make a sentence "business-rule-like": normative language
 * (must/cannot/required/mandatory/shall/never/always), numeric thresholds
 * (percentages, ≥/≤/>=/<=), and the maker-checker separation-of-duties
 * phrasing already used across real hooks ("approver ≠ submitter",
 * "approver != submitter", "approver ne submitter").
 */
const BUSINESS_RULE_MARKER = /\bmust\b|\bcannot\b|\bmust not\b|\brequired\b|\bmandatory\b|\bshall\b|\bnever\b|\balways\b|\d+(\.\d+)?\s*%|>=|<=|≥|≤|approver\s*(≠|!=|ne)\s*submitter/i;

/**
 * Splits free text into sentences on `.`, `!`, `?`, `;`, and newlines, then
 * normalizes each (collapse whitespace, lowercase, trim) and returns the
 * subset that match `BUSINESS_RULE_MARKER`.
 */
function extractBusinessRuleSentences(text: string): Set<string> {
  const sentences = text.split(/[.!?;\n]+/);
  const found = new Set<string>();
  for (const raw of sentences) {
    const normalized = raw.replace(/\s+/g, " ").trim().toLowerCase();
    if (normalized.length === 0) continue;
    if (BUSINESS_RULE_MARKER.test(normalized)) found.add(normalized);
  }
  return found;
}

// ─────────────────────────────────────────────────────────────────────────────
// classifyCorrection()
// _Requirements: 8.3, 8.4
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Classifies a single before/after correction as touching roles, commands,
 * or business rules (`true`) or being a purely mechanical fix (`false`).
 *
 * `true` iff any of:
 *   (a) the set of known role words mentioned in `before` differs from the
 *       set mentioned in `after` (a role was added, removed, or swapped);
 *   (b) the set of `(tool, action)` command signatures extracted from
 *       `before` differs from `after` (the command/script being run
 *       changed — as opposed to a path/directory string elsewhere in the
 *       same text changing);
 *   (c) the set of business-rule-like sentences (normative language or
 *       numeric thresholds) in `before` differs from `after`.
 *
 * `field` is accepted (per the design's `Correction.field`, e.g.
 * `"then.prompt"`, `"when.patterns[1]"`, `"version"`, `"when.type"`) but is
 * not itself load-bearing for the decision — the heuristics above operate
 * on the actual `before`/`after` text regardless of which field it came
 * from, since a role/command/business-rule change could in principle
 * appear in any of them. It is accepted primarily so callers can pass it
 * through without needing a separate signature, and to allow future
 * field-specific refinement without changing the call site.
 *
 * Deliberately conservative in one direction only: a textually trivial
 * diff (even a one-character change) still gets flagged `true` if it flips
 * a role/command/business-rule marker, and Property 10 requires that
 * triviality never overrides the flag once `true`.
 */
export function classifyCorrection(before: string, after: string, _field: string): boolean {
  const rolesBefore = extractRoleMentions(before);
  const rolesAfter = extractRoleMentions(after);
  if (setsDiffer(rolesBefore, rolesAfter)) return true;

  const commandsBefore = extractCommandSignatures(before);
  const commandsAfter = extractCommandSignatures(after);
  if (setsDiffer(commandsBefore, commandsAfter)) return true;

  const rulesBefore = extractBusinessRuleSentences(before);
  const rulesAfter = extractBusinessRuleSentences(after);
  if (setsDiffer(rulesBefore, rulesAfter)) return true;

  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// applyOrFlag() — Refresh_Process R6 branch
// _Requirements: 8.3, 8.4
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Implements the Architecture diagram's `R6` decision node: given a
 * `Correction` whose `touchesRolesCommandsOrBusinessRules` flag has already
 * been computed (typically via `classifyCorrection`), either applies it or
 * refuses to, and never both.
 *
 * - If `correction.touchesRolesCommandsOrBusinessRules` is `true`:
 *   `applyFn` is never called, and the hook file is left unmodified for
 *   this correction. Returns `{ applied: false }`.
 * - If `false`: `applyFn` is called (performing the actual mechanical
 *   write/fix) and its result is returned. Returns
 *   `{ applied: true, result }`.
 *
 * This holds even when the correction is textually trivial — the branch
 * reads only the precomputed flag, never re-derives or second-guesses it
 * based on the size of the diff, which is what Property 10 requires.
 */
export function applyOrFlag(
  correction: Correction,
  applyFn: () => unknown
): { applied: boolean; result?: unknown } {
  if (correction.touchesRolesCommandsOrBusinessRules) {
    return { applied: false };
  }
  const result = applyFn();
  return { applied: true, result };
}
