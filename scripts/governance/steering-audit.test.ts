// scripts/governance/steering-audit.test.ts
//
// Unit tests for known classifications against the real steering docs.
// Task 2.3: assert the 6 known Stale_Content sections and the one
// verified Enforceable_Rule section classify correctly.
//
// NOTE: as of task 18.1, the 6 Stale_Content sections below have already
// been moved (verbatim) out of the 4 always-loaded documents into the new
// Conditional_Steering_Document `point-in-time-metrics.md` by
// `pnpm governance:apply`. This test now verifies classification against
// wherever each section currently lives (the always-loaded docs for the
// Enforceable_Rule check, `point-in-time-metrics.md` for the Stale_Content
// sections) — proving the classifier still correctly labels this content as
// Stale_Content even after relocation, and proving it never reappears in
// the always-loaded documents post-refresh.
//
// Feature: agent-context-governance-refresh

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseSections, classifySection, type ClassifiedSection, type SteeringSection } from "./steering-audit.js";

const STEERING_DIR = join(__dirname, "../../../.kiro/steering");

const DOCUMENTS = ["tech.md", "structure.md", "quick-reference.md", "product.md"];
const POINT_IN_TIME_METRICS_DOC = "point-in-time-metrics.md";

function loadAllSections(): SteeringSection[] {
  const allSections: SteeringSection[] = [];
  for (const doc of DOCUMENTS) {
    const markdown = readFileSync(join(STEERING_DIR, doc), "utf8");
    allSections.push(...parseSections(markdown, doc));
  }
  return allSections;
}

function loadPointInTimeMetricsSections(): SteeringSection[] {
  const markdown = readFileSync(join(STEERING_DIR, POINT_IN_TIME_METRICS_DOC), "utf8");
  return parseSections(markdown, POINT_IN_TIME_METRICS_DOC);
}

function classifyByHeading(
  allSections: SteeringSection[],
  document: string,
  headingSubstring: string
): ClassifiedSection {
  const section = allSections.find(
    (s) => s.document === document && s.heading.includes(headingSubstring)
  );
  if (!section) {
    throw new Error(`Section with heading containing "${headingSubstring}" not found in ${document}`);
  }
  return classifySection(section, allSections);
}

describe("classifySection against the real steering docs", () => {
  const allSections = loadAllSections();

  // _Requirements: 1.2

  it("classifies 'Test Coverage — Hard Rule (Enforced)' (tech.md) as Enforceable_Rule", () => {
    const classified = classifyByHeading(allSections, "tech.md", "Test Coverage");
    expect(classified.classification).toBe("Enforceable_Rule");
  });

  it("no longer finds any of the 6 known Stale_Content headings in the always-loaded documents (they were relocated by task 18.1's apply run)", () => {
    const staleHeadings = [
      "Performance Budget (Targets vs Actuals)",
      "Security Posture & Compliance",
      "Service Maturity (July 2026)",
      "Migration Count (July 2026)",
      "Current Phase",
      "Success Metrics (V1 Launch)",
    ];
    for (const heading of staleHeadings) {
      const found = allSections.some((s) => s.heading.includes(heading));
      expect(found, `expected "${heading}" to have been moved out of the always-loaded docs`).toBe(false);
    }
  });
});

describe("classifySection against the relocated point-in-time-metrics.md", () => {
  const pointInTimeSections = loadPointInTimeMetricsSections();

  // _Requirements: 1.2, 2.2

  it("classifies 'Performance Budget (Targets vs Actuals)' (relocated to point-in-time-metrics.md) as Stale_Content", () => {
    const classified = classifyByHeading(pointInTimeSections, POINT_IN_TIME_METRICS_DOC, "Performance Budget (Targets vs Actuals)");
    expect(classified.classification).toBe("Stale_Content");
  });

  it("classifies 'Security Posture & Compliance' (relocated to point-in-time-metrics.md) as Stale_Content", () => {
    const classified = classifyByHeading(pointInTimeSections, POINT_IN_TIME_METRICS_DOC, "Security Posture & Compliance");
    expect(classified.classification).toBe("Stale_Content");
  });

  it("classifies 'Service Maturity (July 2026)' (relocated to point-in-time-metrics.md) as Stale_Content", () => {
    const classified = classifyByHeading(pointInTimeSections, POINT_IN_TIME_METRICS_DOC, "Service Maturity (July 2026)");
    expect(classified.classification).toBe("Stale_Content");
  });

  it("classifies 'Migration Count (July 2026)' (relocated to point-in-time-metrics.md) as Stale_Content", () => {
    const classified = classifyByHeading(pointInTimeSections, POINT_IN_TIME_METRICS_DOC, "Migration Count (July 2026)");
    expect(classified.classification).toBe("Stale_Content");
  });

  it("classifies 'Current Phase' status table (relocated to point-in-time-metrics.md) as Stale_Content", () => {
    const classified = classifyByHeading(pointInTimeSections, POINT_IN_TIME_METRICS_DOC, "Current Phase");
    expect(classified.classification).toBe("Stale_Content");
  });

  it("classifies 'Success Metrics (V1 Launch)' (relocated to point-in-time-metrics.md) as Stale_Content", () => {
    const classified = classifyByHeading(pointInTimeSections, POINT_IN_TIME_METRICS_DOC, "Success Metrics (V1 Launch)");
    expect(classified.classification).toBe("Stale_Content");
  });
});
