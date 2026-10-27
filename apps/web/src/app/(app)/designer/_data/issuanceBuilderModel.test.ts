import { describe, expect, it } from "vitest";
import type { FormFieldDefinition } from "@/app/_components/ds/designer/formTypes";
import {
  closureNoteTemplateBody,
  emptyIssuanceDesign,
} from "@/app/_components/ds/designer/issuanceTypes";
import {
  applyOutputTypeChange,
  buildSandboxPreview,
  filterMergeFields,
  isSignatoryBlocking,
  mergeFieldsForDesign,
  numberingAdvisories,
  numberingWarning,
  renderMergedTemplate,
  renewalGuidance,
  signatoryWarning,
  validitySummary,
} from "./issuanceBuilderModel";

const sampleField: FormFieldDefinition = {
  id: "f1",
  apiName: "trade_name",
  type: "text",
  label: "Trade name",
  required: true,
  sectionId: "s1",
};

describe("issuanceBuilderModel", () => {
  it("seeds grievance packs with closure-note defaults", () => {
    const design = emptyIssuanceDesign("grievance");
    expect(design.outputType).toBe("closure_note");
    expect(design.templateBody).toBe(closureNoteTemplateBody());
    expect(design.validityMode).toBe("none");
    expect(design.qrVerifyEnabled).toBe(false);
    expect(design.numberingTokens[0]).toMatchObject({ kind: "prefix", value: "GRV" });
  });

  it("includes form answers in merge field list", () => {
    const fields = mergeFieldsForDesign([sampleField], "certificate");
    expect(fields.some((f) => f.key === "trade_name" && f.group === "Form answers")).toBe(true);
    expect(fields.some((f) => f.key === "applicant_name")).toBe(true);
  });

  it("filters merge fields by search query", () => {
    const fields = mergeFieldsForDesign([], "certificate");
    expect(filterMergeFields(fields, "ward").map((f) => f.key)).toContain("ward");
    expect(filterMergeFields(fields, "zzz")).toHaveLength(0);
  });

  it("warns when numbering lacks a sequence segment", () => {
    expect(numberingWarning([{ kind: "prefix", value: "TL" }, { kind: "year" }])).toMatch(/Sequence/i);
    expect(numberingWarning([
      { kind: "prefix", value: "TL" },
      { kind: "seq", seqWidth: 5 },
    ])).toBeNull();
  });

  it("switches stock template when output type changes", () => {
    const cert = emptyIssuanceDesign("certificate");
    const next = applyOutputTypeChange(cert, "closure_note");
    expect(next.outputType).toBe("closure_note");
    expect(next.templateBody).toBe(closureNoteTemplateBody());
    expect(next.validityMode).toBe("none");
    expect(next.qrVerifyEnabled).toBe(false);
  });

  it("preserves custom template body across output type change", () => {
    const custom = { ...emptyIssuanceDesign("certificate"), templateBody: "Custom {{applicant_name}}" };
    const next = applyOutputTypeChange(custom, "licence");
    expect(next.templateBody).toBe("Custom {{applicant_name}}");
    expect(next.renewable).toBe(true);
  });

  it("builds an honest sandbox preview without pipeline claims", () => {
    const design = emptyIssuanceDesign("certificate");
    const preview = buildSandboxPreview(design, "Trade Licence", { pipelineAvailable: false });
    expect(preview.mode).toBe("sandbox");
    expect(preview.banner).toMatch(/sandbox/i);
    expect(preview.banner).toMatch(/no fake payment or NPCI claims/i);
    expect(preview.banner).not.toMatch(/live NPCI|payment settled|UPI confirmed/i);
    expect(preview.mergedText).toContain("Sample Applicant");
    expect(preview.mergedText).toContain("Trade Licence");
  });

  it("labels pipeline mode without claiming a live citizen certificate", () => {
    const design = emptyIssuanceDesign("certificate");
    const preview = buildSandboxPreview(design, "Trade Licence", { pipelineAvailable: true });
    expect(preview.mode).toBe("pipeline");
    expect(preview.banner).toMatch(/not a live citizen certificate/i);
  });

  it("renders merge tokens and leaves unknowns marked", () => {
    expect(renderMergedTemplate("Hi {{applicant_name}} {{missing}}", { applicant_name: "Ada" })).toBe(
      "Hi Ada ⟨missing⟩",
    );
  });

  it("summarises validity and renewal guidance", () => {
    const design = emptyIssuanceDesign("certificate");
    design.renewable = true;
    design.renewalWindowDays = 45;
    expect(validitySummary(design)).toMatch(/45 days/i);
    expect(renewalGuidance(design)).toMatch(/FN-15/i);
  });
});

// GAP-DESIGNER-DETAIL-B7-03
describe("numberingAdvisories", () => {
  const seq = { kind: "seq" as const, seqWidth: 5 };
  it("warns on more than one Sequence segment", () => {
    expect(numberingAdvisories([seq, seq], "financial_year").join(" ")).toMatch(/one Sequence/i);
  });
  it("asks for a restart policy when none is chosen", () => {
    expect(numberingAdvisories([{ kind: "prefix", value: "TL" }, seq], "").join(" ")).toMatch(/when the sequence restarts/i);
  });
  it("warns when the policy never restarts but the number carries a year", () => {
    expect(numberingAdvisories([{ kind: "year" }, seq], "never").join(" ")).toMatch(/never restarts/i);
    expect(numberingAdvisories([{ kind: "fy" }, seq], "never").join(" ")).toMatch(/never restarts/i);
  });
  it("warns when the policy and year segment disagree", () => {
    expect(numberingAdvisories([{ kind: "year" }, seq], "financial_year").join(" ")).toMatch(/FY segment/);
    expect(numberingAdvisories([{ kind: "fy" }, seq], "calendar_year").join(" ")).toMatch(/Year segment/);
  });
  it("warns for a multi-office service without an Office segment", () => {
    expect(numberingAdvisories([seq], "never", { multiOffice: true }).join(" ")).toMatch(/Office segment/);
    expect(numberingAdvisories([{ kind: "office", value: "HO" }, seq], "never", { multiOffice: true }).join(" ")).not.toMatch(/Office segment/);
  });
  it("is quiet for a coherent scheme", () => {
    expect(numberingAdvisories([{ kind: "prefix", value: "TL" }, { kind: "fy" }, seq], "financial_year")).toEqual([]);
  });
});

describe("isSignatoryBlocking (D4c #7 — the signatory is statute-related, so it blocks Next)", () => {
  it("blocks a certificate with no designation and no label", () => {
    expect(isSignatoryBlocking({ outputType: "certificate", signatoryDesignationId: "", signatoryLabel: "" })).toBe(true);
  });
  it("clears with a designation or a typed label, and never blocks a receipt", () => {
    expect(isSignatoryBlocking({ outputType: "certificate", signatoryDesignationId: "p1", signatoryLabel: "" })).toBe(false);
    expect(isSignatoryBlocking({ outputType: "licence", signatoryDesignationId: "", signatoryLabel: "Licensing Officer" })).toBe(false);
    expect(isSignatoryBlocking({ outputType: "receipt", signatoryDesignationId: "", signatoryLabel: "" })).toBe(false);
  });
});

describe("signatoryWarning follows the chosen signature method (D4c #9)", () => {
  const base = { outputType: "certificate" as const, signatoryDesignationId: "p1" };
  it("names the method that will be required at issue time", () => {
    expect(signatoryWarning({ ...base, signatureMethod: "dsc" })).toMatch(/DSC token/);
    expect(signatoryWarning({ ...base, signatureMethod: "esign" })).toMatch(/Aadhaar eSign/);
    expect(signatoryWarning({ ...base, signatureMethod: "none" })).toBeNull();
  });
  it("switching to a licence keeps a chosen method, and a receipt may stay unsigned", () => {
    const d = { ...emptyIssuanceDesign("certificate"), signatureMethod: "esign" as const };
    expect(applyOutputTypeChange(d, "licence").signatureMethod).toBe("esign");
    expect(applyOutputTypeChange({ ...d, signatureMethod: "none" }, "receipt").signatureMethod).toBe("none");
    expect(applyOutputTypeChange({ ...d, signatureMethod: "none" }, "licence").signatureMethod).toBe("dsc");
  });
});
