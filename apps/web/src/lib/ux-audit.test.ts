/**
 * UX Audit Tests — automated checks for clerk-facing quality.
 *
 * These tests enforce product requirements:
 * - R5: No raw HTTP codes, stack traces, or transport details reach the clerk
 * - R12: Same term uses same label everywhere
 * - R14: No platform jargon in user-facing copy
 */
import { describe, it, expect } from "vitest";
import { findBannedTerms } from "./labels";
import { HELP_MODULES } from "./helpContent";
import { GLOSSARY } from "./glossary";
import { toHumanError, type MessageKind } from "./messages";

const ALL_KINDS: MessageKind[] = ["load", "save", "offline", "unknownStatus", "accepted"];

// ---------------------------------------------------------------------------
// R14: Jargon scan — no banned terms in any clerk-facing copy
// ---------------------------------------------------------------------------
describe("UX Audit: Jargon-Free Copy (R14)", () => {
  it("help content contains no banned clerk terms", () => {
    const violations: string[] = [];
    for (const mod of HELP_MODULES) {
      const allCopy = [
        mod.title,
        mod.summary,
        ...mod.tasks.flatMap((t) => [t.title, ...t.steps]),
      ].join(" ");
      const found = findBannedTerms(allCopy);
      if (found.length > 0) {
        violations.push(`${mod.slug}: [${found.join(", ")}]`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("error messages contain no banned clerk terms", () => {
    const violations: string[] = [];
    for (const kind of ALL_KINDS) {
      const err = toHumanError(kind);
      const allCopy = [err.what, err.next].join(" ");
      const found = findBannedTerms(allCopy);
      if (found.length > 0) {
        violations.push(`${kind}: [${found.join(", ")}]`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("glossary definitions contain no banned clerk terms", () => {
    const violations: string[] = [];
    for (const [term, definition] of Object.entries(GLOSSARY)) {
      const found = findBannedTerms(definition);
      if (found.length > 0) {
        violations.push(`${term}: [${found.join(", ")}]`);
      }
    }
    expect(violations).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// R5: Error messages never expose transport details
// ---------------------------------------------------------------------------
describe("UX Audit: Error Messages (R5, R6)", () => {
  const HTTP_CODE_PATTERN = /\b(4\d{2}|5\d{2})\b/;
  const TECHNICAL_PATTERNS = [
    /stack\s*trace/i,
    /TypeError/,
    /ReferenceError/,
    /ECONNREFUSED/,
    /ETIMEDOUT/,
    /at\s+\w+\.\w+\s*\(/,
    /\.ts:\d+/,
    /\.js:\d+/,
  ];

  it("no error message contains HTTP status codes", () => {
    const violations: string[] = [];
    for (const kind of ALL_KINDS) {
      const err = toHumanError(kind);
      if (HTTP_CODE_PATTERN.test(err.what) || HTTP_CODE_PATTERN.test(err.next)) {
        violations.push(kind);
      }
    }
    expect(violations).toEqual([]);
  });

  it("no error message contains technical stack trace patterns", () => {
    const violations: string[] = [];
    for (const kind of ALL_KINDS) {
      const err = toHumanError(kind);
      for (const pattern of TECHNICAL_PATTERNS) {
        if (pattern.test(err.what) || pattern.test(err.next)) {
          violations.push(`${kind} matches ${pattern}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("every error message has at least one recovery action", () => {
    for (const kind of ALL_KINDS) {
      const err = toHumanError(kind);
      expect(err.actions.length, `${kind} has no actions`).toBeGreaterThan(0);
    }
  });

  it("every error message has a 'what happened' and 'what to do next'", () => {
    for (const kind of ALL_KINDS) {
      const err = toHumanError(kind);
      expect(err.what.length, `${kind}.what is empty`).toBeGreaterThan(0);
      expect(err.next.length, `${kind}.next is empty`).toBeGreaterThan(0);
    }
  });

  it("error messages with area placeholder produce jargon-free copy", () => {
    const areas = ["bill", "leave request", "voucher", "purchase order", "salary slip"];
    const violations: string[] = [];
    for (const area of areas) {
      for (const kind of ALL_KINDS) {
        const err = toHumanError(kind, { area });
        const found = findBannedTerms(`${err.what} ${err.next}`);
        if (found.length > 0) violations.push(`${kind}(${area}): ${found}`);
      }
    }
    expect(violations).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// R12: Terminology consistency — glossary covers all specialist terms used
// ---------------------------------------------------------------------------
describe("UX Audit: Terminology Consistency (R12)", () => {
  const SPECIALIST_TERMS = [
    "GRN", "DDO", "UC", "HoA", "PFMS", "Sanction", "Indent",
    "Voucher", "TDS", "GST", "APAR",
  ];

  it("all specialist terms have a glossary definition", () => {
    const missing: string[] = [];
    for (const term of SPECIALIST_TERMS) {
      if (!(term in GLOSSARY) && !(term.toLowerCase() in GLOSSARY)) {
        missing.push(term);
      }
    }
    // Known gap: HoA and GST need glossary entries (tracked for remediation)
    expect(missing).toEqual([]);
  });

  it("every help module has at least one task", () => {
    for (const mod of HELP_MODULES) {
      expect(mod.tasks.length, `${mod.slug} has no tasks`).toBeGreaterThan(0);
    }
  });

  it("every help module has a summary under 120 chars (warm one-liner)", () => {
    const violations: string[] = [];
    for (const mod of HELP_MODULES) {
      if (mod.summary.length > 120) {
        violations.push(`${mod.slug}: ${mod.summary.length} chars`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("help modules cover all major domain areas", () => {
    const slugs = HELP_MODULES.map((m) => m.slug);
    const requiredSlugs = ["finance", "hr", "procurement", "projects"];
    for (const required of requiredSlugs) {
      expect(slugs, `missing help for: ${required}`).toContain(required);
    }
  });
});
