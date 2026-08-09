/**
 * FN-32 — Accessibility & GIGW preview.
 * BRD acceptance: "form missing labels fails preview with actionable list."
 */
import { describe, it, expect } from "vitest";
import {
  formatA11yIssues,
  previewAccessibility,
  type PreviewFormDesign,
} from "./a11y-preview.js";
import { hallBookingFormDesign } from "./manifests/hall-booking.js";
import { eventPermissionFormDesign } from "./manifests/event-permission.js";

const BILINGUAL = { locales: ["en", "or"] };

function designOf(fields: Record<string, unknown>, sections: unknown[]): PreviewFormDesign {
  return { fields, sections } as PreviewFormDesign;
}

/** A minimal form that passes everything, so each test perturbs one thing. */
function goodDesign(): PreviewFormDesign {
  return designOf(
    {
      f1: { id: "f1", apiName: "ward", type: "text", label: "Ward", sectionId: "s1" },
      f2: { id: "f2", apiName: "purpose", type: "text", label: "Purpose", sectionId: "s1" },
    },
    [{ id: "s1", label: "Details", fieldIds: ["f1", "f2"] }],
  );
}

describe("FN-32 previewAccessibility — BRD acceptance", () => {
  it("fails a form with a missing label and names the field", () => {
    const d = goodDesign();
    d.fields!.f2!.label = "";

    const r = previewAccessibility(d, BILINGUAL);

    expect(r.passed).toBe(false);
    const issue = r.issues.find((i) => i.code === "FIELD_MISSING_LABEL");
    expect(issue?.severity).toBe("error");
    expect(issue?.fieldId).toBe("f2");
    expect(issue?.wcag).toContain("3.3.2");
    // "actionable list" — the message says what to do, not just what is wrong.
    expect(issue?.message).toContain("purpose");
    expect(issue?.message).toMatch(/add a visible label/i);
  });

  it("treats an absent label the same as an empty one", () => {
    const d = goodDesign();
    delete d.fields!.f2!.label;
    expect(previewAccessibility(d, BILINGUAL).passed).toBe(false);
  });

  it("does not accept whitespace as a label", () => {
    const d = goodDesign();
    d.fields!.f1!.label = "   ";
    expect(previewAccessibility(d, BILINGUAL).errorCount).toBe(1);
  });

  it("renders the issue list one actionable line at a time", () => {
    const d = goodDesign();
    d.fields!.f1!.label = "";
    const lines = formatA11yIssues(previewAccessibility(d, BILINGUAL));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^\[ERROR\] FIELD_MISSING_LABEL \(3\.3\.2/);
  });
});

describe("FN-32 — real packs pass their own preview", () => {
  it.each([
    ["hall-booking", hallBookingFormDesign()],
    ["event-permission", eventPermissionFormDesign()],
  ])("%s passes with no errors", (_name, form) => {
    const r = previewAccessibility({ sections: form.sections, fields: form.fields }, BILINGUAL);
    // A pack we ship that fails our own a11y gate would be indefensible.
    expect(formatA11yIssues(r).filter((l) => l.startsWith("[ERROR"))).toEqual([]);
    expect(r.passed).toBe(true);
  });
});

describe("FN-32 — structure and focus order", () => {
  it("fails a section with no heading", () => {
    const d = goodDesign();
    d.sections![0]!.label = "";
    const r = previewAccessibility(d, BILINGUAL);
    expect(r.issues.find((i) => i.code === "SECTION_MISSING_LABEL")?.wcag).toContain("1.3.1");
    expect(r.passed).toBe(false);
  });

  it("fails a field that no section lists — it has no tab position", () => {
    const d = goodDesign();
    d.sections![0]!.fieldIds = ["f1"];
    const r = previewAccessibility(d, BILINGUAL);
    const issue = r.issues.find((i) => i.code === "FIELD_NOT_IN_ANY_SECTION");
    expect(issue?.fieldId).toBe("f2");
    expect(issue?.wcag).toContain("2.4.3");
  });

  it("fails a field reached twice while tabbing", () => {
    const d = goodDesign();
    d.sections!.push({ id: "s2", label: "More", fieldIds: ["f2"] });
    const r = previewAccessibility(d, BILINGUAL);
    const issue = r.issues.find((i) => i.code === "FIELD_IN_MULTIPLE_SECTIONS");
    expect(issue?.fieldId).toBe("f2");
    expect(issue?.message).toContain("s1");
    expect(issue?.message).toContain("s2");
  });

  it("fails a section pointing at a field that does not exist", () => {
    const d = goodDesign();
    d.sections![0]!.fieldIds = ["f1", "f2", "ghost"];
    const r = previewAccessibility(d, BILINGUAL);
    expect(r.issues.find((i) => i.code === "SECTION_REFERENCES_MISSING_FIELD")?.fieldId).toBe("ghost");
    // The ghost must not also be reported as an unplaced field.
    expect(r.issues.some((i) => i.code === "FIELD_NOT_IN_ANY_SECTION")).toBe(false);
  });

  it("fails a field pointing at a section that does not exist", () => {
    const d = goodDesign();
    d.fields!.f2!.sectionId = "nowhere";
    expect(previewAccessibility(d, BILINGUAL).issues.some((i) => i.code === "FIELD_UNKNOWN_SECTION")).toBe(true);
  });

  it("fails two fields sharing a label in one section", () => {
    const d = goodDesign();
    d.fields!.f2!.label = "ward"; // same as f1's "Ward", different case
    const r = previewAccessibility(d, BILINGUAL);
    const issue = r.issues.find((i) => i.code === "DUPLICATE_LABEL_IN_SECTION");
    expect(issue?.wcag).toContain("2.4.6");
    expect(issue?.message).toContain("f1");
  });

  it("allows the same label in two different sections", () => {
    // "Address" under Applicant and under Premises is legitimate and common.
    const d = designOf(
      {
        f1: { id: "f1", apiName: "applicantAddress", type: "text", label: "Address", sectionId: "s1" },
        f2: { id: "f2", apiName: "premisesAddress", type: "text", label: "Address", sectionId: "s2" },
      },
      [
        { id: "s1", label: "Applicant", fieldIds: ["f1"] },
        { id: "s2", label: "Premises", fieldIds: ["f2"] },
      ],
    );
    expect(previewAccessibility(d, BILINGUAL).passed).toBe(true);
  });

  it("fails an empty form", () => {
    const r = previewAccessibility({ sections: [], fields: {} }, BILINGUAL);
    expect(r.issues.some((i) => i.code === "FORM_EMPTY")).toBe(true);
    expect(r.passed).toBe(false);
  });

  it("handles a null or undefined design without throwing", () => {
    expect(previewAccessibility(null, BILINGUAL).passed).toBe(false);
    expect(previewAccessibility(undefined, BILINGUAL).passed).toBe(false);
  });
});

describe("FN-32 — instructions before the citizen answers", () => {
  it("fails a choice field with no options", () => {
    const d = goodDesign();
    d.fields!.f2! = { id: "f2", apiName: "slot", type: "picklist_single", label: "Slot", sectionId: "s1" };
    const r = previewAccessibility(d, BILINGUAL);
    expect(r.issues.find((i) => i.code === "CHOICE_FIELD_WITHOUT_CHOICES")?.severity).toBe("error");
  });

  it("warns — but does not block — on an upload with no accepted types", () => {
    const d = goodDesign();
    d.fields!.f2! = { id: "f2", apiName: "idProof", type: "file", label: "ID proof", sectionId: "s1" };
    const r = previewAccessibility(d, BILINGUAL);
    expect(r.issues.find((i) => i.code === "UPLOAD_WITHOUT_ACCEPTED_TYPES")?.severity).toBe("warning");
    expect(r.passed).toBe(true);
  });

  it("warns on a format rule the citizen cannot see before typing", () => {
    const d = goodDesign();
    d.fields!.f2!.pattern = "^[0-9]{10}$";
    const r = previewAccessibility(d, BILINGUAL);
    expect(r.issues.find((i) => i.code === "FORMAT_RULE_WITHOUT_HELP_TEXT")?.wcag).toContain("3.3.5");
    expect(r.passed).toBe(true);
  });

  it("stays quiet when the format rule is explained", () => {
    const d = goodDesign();
    d.fields!.f2!.pattern = "^[0-9]{10}$";
    d.fields!.f2!.helpText = "10 digits, no spaces or country code.";
    expect(previewAccessibility(d, BILINGUAL).issues).toEqual([]);
  });
});

describe("FN-32 — GIGW bilingual warning", () => {
  it("warns when no locale is declared", () => {
    const r = previewAccessibility(goodDesign());
    const issue = r.issues.find((i) => i.code === "GIGW_SECONDARY_LOCALE_MISSING");
    expect(issue?.severity).toBe("warning");
    expect(issue?.message).toMatch(/English and at least one regional/i);
  });

  it("warns when only one locale is declared, and names it", () => {
    const r = previewAccessibility(goodDesign(), { locales: ["en"] });
    expect(r.issues.find((i) => i.code === "GIGW_SECONDARY_LOCALE_MISSING")?.message).toContain('"en"');
  });

  it("does not block publish on the bilingual gap alone", () => {
    // GIGW bilingual content is a rollout obligation, not a form defect —
    // blocking publish on it would stop a correct English-first pilot.
    expect(previewAccessibility(goodDesign(), { locales: ["en"] }).passed).toBe(true);
  });

  it("is silent once a second locale exists", () => {
    expect(previewAccessibility(goodDesign(), BILINGUAL).issues).toEqual([]);
  });
});

describe("FN-32 — counts", () => {
  it("reports errors and warnings separately", () => {
    const d = goodDesign();
    d.fields!.f1!.label = ""; // error
    const r = previewAccessibility(d, { locales: ["en"] }); // + bilingual warning
    expect(r.errorCount).toBe(1);
    expect(r.warningCount).toBe(1);
    expect(r.issues).toHaveLength(2);
    expect(r.passed).toBe(false);
  });
});
