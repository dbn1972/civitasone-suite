/**
 * The three product journeys this engine was built for, driven end to end through
 * the pure functions. These are the acceptance tests: if a journey cannot be
 * expressed in the model, the model is wrong.
 */
import { describe, it, expect } from "vitest";
import { evaluateCompletion } from "../src/completion.js";
import { buildResponses, freezeStructure, mergeResponses } from "../src/structure.js";
import { validateStructure } from "../src/validate.js";
import type { ChecklistResponses, ChecklistSection } from "../src/types.js";
import { AT } from "./fixtures.js";

function submit(existing: ChecklistResponses, values: Record<string, unknown>): ChecklistResponses {
  return mergeResponses(
    existing,
    buildResponses(
      Object.entries(values).map(([questionId, value]) => ({ questionId, value })),
      AT,
    ),
  );
}

// ── Journey 1: exporter readiness (IEC / AD-code guidance) ────────────────────
const exporterReadiness: ChecklistSection[] = [
  {
    id: "registration",
    title: "Statutory registration",
    sortOrder: 1,
    weight: 3,
    questions: [
      { id: "has_iec", text: "Do you hold an IEC?", type: "boolean", sortOrder: 1, weight: 2, required: true },
      {
        id: "iec_number",
        text: "IEC number",
        type: "text",
        sortOrder: 2,
        weight: 2,
        required: true,
        conditionalLogic: [{ dependsOn: "has_iec", operator: "eq", value: true, action: "show" }],
      },
      {
        id: "iec_application_ref",
        text: "DGFT application reference",
        type: "text",
        sortOrder: 3,
        weight: 1,
        required: true,
        conditionalLogic: [{ dependsOn: "has_iec", operator: "eq", value: false, action: "show" }],
      },
    ],
  },
  {
    id: "banking",
    title: "AD code and banking",
    sortOrder: 2,
    weight: 2,
    // AD-code registration is only meaningful once statutory registration is settled.
    prerequisite: { sectionId: "registration", minScore: 100 },
    questions: [
      { id: "ad_code", text: "AD code", type: "text", sortOrder: 1, weight: 1, required: true },
      { id: "port_codes", text: "Ports registered", type: "multi_select", sortOrder: 2, weight: 1, required: true },
    ],
  },
];

// ── Journey 2: insurance proposal (medical / verification requirements) ───────
const insuranceProposal: ChecklistSection[] = [
  {
    id: "proposer",
    title: "Proposer details",
    sortOrder: 1,
    weight: 2,
    questions: [
      { id: "sum_assured", text: "Sum assured", type: "number", sortOrder: 1, weight: 1, required: true },
      { id: "age_band", text: "Age band", type: "select", sortOrder: 2, weight: 1, required: true },
      { id: "tobacco", text: "Tobacco use", type: "boolean", sortOrder: 3, weight: 1, required: true },
    ],
  },
  {
    id: "medical",
    title: "Medical requirements",
    sortOrder: 2,
    weight: 3,
    prerequisite: { sectionId: "proposer", minScore: 100 },
    questions: [
      {
        // High-value proposals require a full medical; small ones do not.
        id: "full_medical_report",
        text: "Full medical report",
        type: "document",
        sortOrder: 1,
        weight: 2,
        required: true,
        conditionalLogic: [{ dependsOn: "sum_assured", operator: "gt", value: 5_000_000, action: "show" }],
      },
      {
        id: "tobacco_loading_ack",
        text: "Tobacco loading acknowledgement",
        type: "signature",
        sortOrder: 2,
        weight: 1,
        required: true,
        conditionalLogic: [{ dependsOn: "tobacco", operator: "eq", value: true, action: "show" }],
      },
      { id: "declaration", text: "Health declaration", type: "signature", sortOrder: 3, weight: 1, required: true },
    ],
  },
];

// ── Journey 3: B2B customer onboarding ───────────────────────────────────────
const b2bOnboarding: ChecklistSection[] = [
  {
    id: "kyb",
    title: "Know your business",
    sortOrder: 1,
    weight: 2,
    questions: [
      { id: "gstin", text: "GSTIN", type: "text", sortOrder: 1, weight: 1, required: true },
      { id: "entity_type", text: "Entity type", type: "select", sortOrder: 2, weight: 1, required: true },
      { id: "notes", text: "Notes", type: "text", sortOrder: 3, weight: 0, required: false },
    ],
  },
  {
    id: "commercials",
    title: "Commercial terms",
    sortOrder: 2,
    weight: 1,
    prerequisite: { sectionId: "kyb", minScore: 100 },
    questions: [
      { id: "credit_days", text: "Credit days", type: "number", sortOrder: 1, weight: 1, required: true },
      {
        id: "credit_committee_ref",
        text: "Credit committee approval reference",
        type: "text",
        sortOrder: 2,
        weight: 1,
        required: true,
        conditionalLogic: [{ dependsOn: "credit_days", operator: "gt", value: 30, action: "show" }],
      },
    ],
  },
];

describe("journey: exporter readiness", () => {
  it("is a valid template", () => {
    expect(validateStructure(exporterReadiness)).toBe(true);
  });

  it("asks for an IEC number when the exporter has one, and only then", () => {
    const structure = freezeStructure(exporterReadiness);
    let responses: ChecklistResponses = {};

    const start = evaluateCompletion(structure, responses);
    expect(start.unansweredRequired).toEqual(["has_iec"]);
    expect(start.lockedSectionIds).toEqual(["banking"]);

    responses = submit(responses, { has_iec: true });
    const withIec = evaluateCompletion(structure, responses);
    expect(withIec.unansweredRequired).toEqual(["iec_number"]);
    // The "no IEC" branch is not asked at all.
    expect(withIec.unansweredRequired).not.toContain("iec_application_ref");
  });

  it("asks for a DGFT application reference when the exporter has no IEC", () => {
    const structure = freezeStructure(exporterReadiness);
    const responses = submit({}, { has_iec: false });
    const state = evaluateCompletion(structure, responses);
    expect(state.unansweredRequired).toEqual(["iec_application_ref"]);
  });

  it("unlocks AD-code registration only once statutory registration is complete", () => {
    const structure = freezeStructure(exporterReadiness);
    let responses = submit({}, { has_iec: true });
    expect(evaluateCompletion(structure, responses).lockedSectionIds).toEqual(["banking"]);

    responses = submit(responses, { iec_number: "0312345678" });
    const unlocked = evaluateCompletion(structure, responses);
    expect(unlocked.lockedSectionIds).toEqual([]);
    expect(unlocked.unansweredRequired).toEqual(["ad_code", "port_codes"]);
    expect(unlocked.complete).toBe(false);

    responses = submit(responses, { ad_code: "6390004", port_codes: ["INNSA1"] });
    const done = evaluateCompletion(structure, responses);
    expect(done.complete).toBe(true);
    expect(done.progressPercent).toBe(100);
    expect(done.score).toBe(100);
  });
});

describe("journey: insurance proposal", () => {
  it("is a valid template", () => {
    expect(validateStructure(insuranceProposal)).toBe(true);
  });

  it("demands a full medical report only above the sum-assured threshold", () => {
    const structure = freezeStructure(insuranceProposal);
    const small = submit({}, { sum_assured: 1_000_000, age_band: "30-35", tobacco: false });
    const smallState = evaluateCompletion(structure, small);
    expect(smallState.unansweredRequired).toEqual(["declaration"]);

    const large = submit({}, { sum_assured: 9_000_000, age_band: "45-50", tobacco: true });
    const largeState = evaluateCompletion(structure, large);
    expect(largeState.unansweredRequired).toEqual([
      "full_medical_report",
      "tobacco_loading_ack",
      "declaration",
    ]);
  });

  it("keeps medical requirements locked until proposer details are complete", () => {
    const structure = freezeStructure(insuranceProposal);
    const partial = submit({}, { sum_assured: 9_000_000 });
    const state = evaluateCompletion(structure, partial);
    expect(state.lockedSectionIds).toEqual(["medical"]);
    expect(state.unansweredRequired).toEqual(["age_band", "tobacco"]);
    // The locked section contributes nothing to the score yet.
    expect(state.score).toBe(33);
  });

  it("completes a non-tobacco, low-value proposal without medical evidence", () => {
    const structure = freezeStructure(insuranceProposal);
    let responses = submit({}, { sum_assured: 500_000, age_band: "25-30", tobacco: false });
    responses = submit(responses, { declaration: "signed" });
    const state = evaluateCompletion(structure, responses);
    expect(state.complete).toBe(true);
    expect(state.score).toBe(100);
  });
});

describe("journey: B2B customer onboarding", () => {
  it("is a valid template", () => {
    expect(validateStructure(b2bOnboarding)).toBe(true);
  });

  it("escalates to a credit committee reference only past 30 credit days", () => {
    const structure = freezeStructure(b2bOnboarding);
    let responses = submit({}, { gstin: "27AAAAA0000A1Z5", entity_type: "private_limited" });
    responses = submit(responses, { credit_days: 15 });
    expect(evaluateCompletion(structure, responses).complete).toBe(true);

    const stretched = submit(responses, { credit_days: 60 });
    const state = evaluateCompletion(structure, stretched);
    expect(state.complete).toBe(false);
    expect(state.unansweredRequired).toEqual(["credit_committee_ref"]);
  });

  it("ignores the optional notes field entirely", () => {
    const structure = freezeStructure(b2bOnboarding);
    const responses = submit({}, { notes: "spoke to the CFO" });
    const state = evaluateCompletion(structure, responses);
    expect(state.requiredAnswered).toBe(0);
    expect(state.progressPercent).toBe(0);
  });

  it("reports partial progress accurately mid-flight", () => {
    const structure = freezeStructure(b2bOnboarding);
    const responses = submit({}, { gstin: "27AAAAA0000A1Z5" });
    const state = evaluateCompletion(structure, responses);
    expect(state.requiredTotal).toBe(2);
    expect(state.requiredAnswered).toBe(1);
    expect(state.progressPercent).toBe(50);
  });
});
