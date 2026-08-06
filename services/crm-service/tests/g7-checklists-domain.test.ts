/**
 * G7 — crm-service checklist module domain logic.
 *
 * Covers the part that is CRM's own: the two status machines and the rules about when a
 * template may be amended, published or instantiated. The scoring / visibility /
 * prerequisite / completion mathematics is tested in @civitasone/checklist and is only
 * exercised here through the thin delegating wrappers, to prove CRM is actually calling
 * the shared engine rather than a local copy.
 */
import { describe, it, expect } from "vitest";
import type { ChecklistSection } from "@civitasone/checklist";
import { ChecklistDomainError } from "@civitasone/checklist";
import {
  INSTANCE_STATUSES,
  TEMPLATE_STATUSES,
  SUBJECT_TYPES,
  allowedNextInstanceStatuses,
  allowedNextTemplateStatuses,
  applyResponses,
  assertValidStructure,
  buildInstanceStructure,
  canInstanceTransition,
  canTemplateTransition,
  completesInstance,
  completionOf,
  isInstanceStatus,
  isPublishable,
  isSubjectType,
  isTemplateEditable,
  isTemplateInstantiable,
  isTemplateStatus,
  nextVersionNumber,
  statusAfterSubmission,
} from "../src/modules/checklists/domain.js";

const AT = "2026-01-01T00:00:00.000Z";

const sections: ChecklistSection[] = [
  {
    id: "registration",
    title: "Statutory registration",
    sortOrder: 1,
    weight: 2,
    questions: [
      { id: "has_iec", text: "Do you hold an IEC?", type: "boolean", sortOrder: 1, weight: 1, required: true },
      {
        id: "iec_number",
        text: "IEC number",
        type: "text",
        sortOrder: 2,
        weight: 1,
        required: true,
        conditionalLogic: [{ dependsOn: "has_iec", operator: "eq", value: true, action: "show" }],
      },
    ],
  },
  {
    id: "banking",
    title: "AD code",
    sortOrder: 2,
    weight: 1,
    prerequisite: { sectionId: "registration", minScore: 100 },
    questions: [
      { id: "ad_code", text: "AD code", type: "text", sortOrder: 1, weight: 1, required: true },
    ],
  },
];

describe("G7 domain — vocabularies", () => {
  it("recognises its own status and subject values", () => {
    for (const status of TEMPLATE_STATUSES) expect(isTemplateStatus(status)).toBe(true);
    for (const status of INSTANCE_STATUSES) expect(isInstanceStatus(status)).toBe(true);
    for (const subject of SUBJECT_TYPES) expect(isSubjectType(subject)).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isTemplateStatus("archived")).toBe(false);
    expect(isInstanceStatus("done")).toBe(false);
    expect(isSubjectType("lead")).toBe(false);
  });
});

describe("G7 domain — template status machine", () => {
  it("walks draft → published → deprecated", () => {
    expect(canTemplateTransition("draft", "published")).toBe(true);
    expect(canTemplateTransition("published", "deprecated")).toBe(true);
  });

  it("allows a draft to be abandoned straight to deprecated", () => {
    expect(canTemplateTransition("draft", "deprecated")).toBe(true);
  });

  it("never re-opens a published template for editing", () => {
    expect(canTemplateTransition("published", "draft")).toBe(false);
    expect(isTemplateEditable("published")).toBe(false);
    expect(isTemplateEditable("deprecated")).toBe(false);
    expect(isTemplateEditable("draft")).toBe(true);
  });

  it("treats deprecated as terminal", () => {
    expect(allowedNextTemplateStatuses("deprecated")).toEqual([]);
    expect(canTemplateTransition("deprecated", "published")).toBe(false);
    expect(canTemplateTransition("deprecated", "draft")).toBe(false);
  });

  it("refuses to re-publish an already published version", () => {
    expect(canTemplateTransition("published", "published")).toBe(false);
    expect(allowedNextTemplateStatuses("draft")).toEqual(["published", "deprecated"]);
  });

  it("only a published template may be instantiated", () => {
    expect(isTemplateInstantiable("published")).toBe(true);
    expect(isTemplateInstantiable("draft")).toBe(false);
    expect(isTemplateInstantiable("deprecated")).toBe(false);
  });
});

describe("G7 domain — instance status machine", () => {
  it("moves an open instance to completed or cancelled", () => {
    expect(canInstanceTransition("in_progress", "completed")).toBe(true);
    expect(canInstanceTransition("in_progress", "cancelled")).toBe(true);
  });

  it("treats completed and cancelled as terminal", () => {
    expect(allowedNextInstanceStatuses("completed")).toEqual([]);
    expect(allowedNextInstanceStatuses("cancelled")).toEqual([]);
    expect(canInstanceTransition("completed", "in_progress")).toBe(false);
    expect(canInstanceTransition("cancelled", "in_progress")).toBe(false);
  });
});

describe("G7 domain — publishability", () => {
  it("refuses an empty template", () => {
    expect(isPublishable([])).toBe(false);
  });

  it("refuses a template whose sections hold no questions", () => {
    expect(
      isPublishable([{ id: "s1", title: "S", sortOrder: 1, weight: 1, questions: [] }]),
    ).toBe(false);
  });

  it("accepts a template with at least one question", () => {
    expect(isPublishable(sections)).toBe(true);
  });
});

describe("G7 domain — version numbering", () => {
  it("starts a brand-new key at 1", () => {
    expect(nextVersionNumber(null)).toBe(1);
  });

  it("takes the next number after the highest existing version", () => {
    expect(nextVersionNumber(1)).toBe(2);
    expect(nextVersionNumber(7)).toBe(8);
  });
});

describe("G7 domain — delegation to the shared engine", () => {
  it("validates a structure through @civitasone/checklist", () => {
    expect(assertValidStructure(sections)).toBe(true);
  });

  it("surfaces the shared engine's domain error, not a local one", () => {
    const broken: ChecklistSection[] = [
      { id: "s1", title: "S", sortOrder: 1, weight: 1, questions: [] },
      { id: "s1", title: "S again", sortOrder: 2, weight: 1, questions: [] },
    ];
    expect(() => assertValidStructure(broken)).toThrow(ChecklistDomainError);
  });

  it("freezes a deep copy for an instance", () => {
    const frozen = buildInstanceStructure(sections);
    frozen[0]!.title = "edited";
    expect(sections[0]!.title).toBe("Statutory registration");
    expect(frozen.map((s) => s.id)).toEqual(["registration", "banking"]);
  });

  it("merges a partial submission into what is already recorded", () => {
    const merged = applyResponses(
      { has_iec: { value: true, answeredAt: AT } },
      { iec_number: { value: "0312345678", answeredAt: AT } },
    );
    expect(Object.keys(merged).sort()).toEqual(["has_iec", "iec_number"]);
  });

  it("computes completion with visibility and prerequisites applied", () => {
    const empty = completionOf(sections, {});
    // iec_number is hidden and the banking section is locked, so only has_iec is due.
    expect(empty.unansweredRequired).toEqual(["has_iec"]);
    expect(empty.lockedSectionIds).toEqual(["banking"]);

    const partial = completionOf(sections, { has_iec: { value: true, answeredAt: AT } });
    expect(partial.unansweredRequired).toEqual(["iec_number"]);

    const done = completionOf(sections, {
      has_iec: { value: true, answeredAt: AT },
      iec_number: { value: "0312345678", answeredAt: AT },
      ad_code: { value: "6390004", answeredAt: AT },
    });
    expect(done.complete).toBe(true);
    expect(done.score).toBe(100);
  });
});

describe("G7 domain — derived instance status", () => {
  const completion = completionOf(sections, {
    has_iec: { value: false, answeredAt: AT },
  });
  const finished = completionOf(sections, {
    has_iec: { value: true, answeredAt: AT },
    iec_number: { value: "0312345678", answeredAt: AT },
    ad_code: { value: "6390004", answeredAt: AT },
  });

  it("keeps an incomplete instance in progress", () => {
    expect(completion.complete).toBe(false);
    expect(statusAfterSubmission("in_progress", completion)).toBe("in_progress");
    expect(completesInstance("in_progress", completion)).toBe(false);
  });

  it("completes an instance once nothing required is outstanding", () => {
    expect(statusAfterSubmission("in_progress", finished)).toBe("completed");
    expect(completesInstance("in_progress", finished)).toBe(true);
  });

  it("never resurrects a terminal instance, and never re-completes one", () => {
    expect(statusAfterSubmission("completed", finished)).toBe("completed");
    expect(statusAfterSubmission("cancelled", finished)).toBe("cancelled");
    expect(completesInstance("completed", finished)).toBe(false);
    expect(completesInstance("cancelled", finished)).toBe(false);
  });
});
