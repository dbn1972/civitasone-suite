import type { FormFieldDefinition } from "@/app/_components/ds/designer/formTypes";
import type { MergeField } from "@/app/_components/ds/designer/MergeFieldPicker";
import {
  defaultTemplateBodyForOutputType,
  formatNumberingPreview,
  type IssuanceDesignState,
  type NumberingToken,
  type OutputType,
  type ValidityMode,
} from "@/app/_components/ds/designer/issuanceTypes";

/** Core merge fields always available in B7 templates. */
export const CORE_MERGE_FIELDS: MergeField[] = [
  { key: "applicant_name", label: "Applicant name", group: "Application" },
  { key: "app_no", label: "Application number", group: "Application" },
  { key: "service_name", label: "Service name", group: "Service" },
  { key: "cert_no", label: "Certificate / note number", group: "Issuance" },
  { key: "issued_on", label: "Issued / closed on", group: "Issuance" },
  { key: "valid_from", label: "Valid from", group: "Issuance" },
  { key: "valid_to", label: "Valid until", group: "Issuance" },
  { key: "signatory_name", label: "Signatory name", group: "Issuance" },
  { key: "resolution_summary", label: "Resolution summary", group: "Grievance" },
  { key: "amount", label: "Fee amount", group: "Payment" },
  { key: "pay_link", label: "Payment link", group: "Payment" },
  { key: "office_name", label: "Office name", group: "Tenant" },
  { key: "ward", label: "Ward", group: "Location" },
];

export interface SampleMergeValues {
  applicant_name: string;
  app_no: string;
  service_name: string;
  cert_no: string;
  issued_on: string;
  valid_from: string;
  valid_to: string;
  signatory_name: string;
  resolution_summary: string;
  amount: string;
  pay_link: string;
  office_name: string;
  ward: string;
  [key: string]: string;
}

export interface SandboxPreviewResult {
  /** Plain merged text for the preview pane. */
  mergedText: string;
  /** Honest provenance for the UI banner. */
  mode: "pipeline" | "sandbox";
  banner: string;
  numberingExample: string;
}

export function mergeFieldsForDesign(
  formFields: FormFieldDefinition[] = [],
  outputType?: OutputType,
): MergeField[] {
  const formMerge: MergeField[] = formFields
    .filter((f) => f.apiName)
    .map((f) => ({
      key: f.apiName,
      label: f.label || f.apiName,
      group: "Form answers",
    }));

  const core =
    outputType === "closure_note"
      ? CORE_MERGE_FIELDS
      : CORE_MERGE_FIELDS.filter((f) => f.group !== "Grievance" || f.key === "resolution_summary");

  const seen = new Set<string>();
  const out: MergeField[] = [];
  for (const field of [...core, ...formMerge]) {
    if (seen.has(field.key)) continue;
    seen.add(field.key);
    out.push(field);
  }
  return out;
}

export function filterMergeFields(fields: MergeField[], query: string): MergeField[] {
  const q = query.trim().toLowerCase();
  if (!q) return fields;
  return fields.filter(
    (f) =>
      f.key.toLowerCase().includes(q) ||
      f.label.toLowerCase().includes(q) ||
      f.group.toLowerCase().includes(q),
  );
}

export function numberingHasSequence(tokens: NumberingToken[]): boolean {
  return tokens.some((t) => t.kind === "seq");
}

export function numberingWarning(tokens: NumberingToken[]): string | null {
  if (tokens.length === 0) return "Add at least one numbering segment.";
  if (!numberingHasSequence(tokens)) {
    return "Include a Sequence segment so each issue gets a unique number.";
  }
  return null;
}

export function validitySummary(design: Pick<
  IssuanceDesignState,
  "validityMode" | "validityYears" | "validityFixedDate" | "renewable" | "renewalWindowDays" | "outputType"
>): string {
  if (design.outputType === "closure_note") {
    return "Closure notes do not expire — validity controls stay off.";
  }
  if (design.validityMode === "none") return "No expiry date on the issued document.";
  if (design.validityMode === "fixed_date") {
    return design.validityFixedDate
      ? `Valid until ${design.validityFixedDate}.`
      : "Choose a fixed end date.";
  }
  const years = design.validityYears || 1;
  const base = `Valid for ${years} year${years === 1 ? "" : "s"} from issue date.`;
  if (!design.renewable) return base;
  return `${base} Renewal may open ${design.renewalWindowDays || 30} days before expiry (FN-15).`;
}

export function renewalGuidance(
  design: Pick<IssuanceDesignState, "renewable" | "outputType" | "validityMode">,
): string | null {
  if (design.outputType === "closure_note" || design.outputType === "receipt") return null;
  if (design.validityMode === "none") {
    return design.renewable
      ? "Renewal is marked on, but there is no expiry — set a duration or fixed date so the renewal window has meaning."
      : null;
  }
  if (!design.renewable) {
    return "Turn on Renewable when applicants should request a renewal before this document expires.";
  }
  return "Renewal uses a lighter follow-on flow (FN-15) once published — this flag only marks the service as renewable.";
}

export function signatoryWarning(
  design: Pick<IssuanceDesignState, "outputType" | "signatoryDesignationId" | "digitalSignature">,
): string | null {
  if (design.outputType === "receipt") return null;
  if (!design.signatoryDesignationId) {
    return design.outputType === "closure_note"
      ? "Pick who closes the case — their designation appears on the closure note."
      : "Pick a signatory designation before publish — certificates need a named authority.";
  }
  if (design.digitalSignature) {
    return "Digital signature will be required at issue time (DSC / eSign when the tenant has it configured).";
  }
  return null;
}

/** When output type changes, refresh template defaults if the body still matches a stock template. */
export function applyOutputTypeChange(
  design: IssuanceDesignState,
  nextType: OutputType,
): IssuanceDesignState {
  const prevDefault = defaultTemplateBodyForOutputType(design.outputType);
  const bodyIsStock = design.templateBody.trim() === prevDefault.trim();
  const isClosure = nextType === "closure_note";
  return {
    ...design,
    outputType: nextType,
    templateBody: bodyIsStock ? defaultTemplateBodyForOutputType(nextType) : design.templateBody,
    validityMode: isClosure ? "none" : design.validityMode === "none" && nextType !== "receipt"
      ? "duration"
      : design.validityMode,
    renewable: nextType === "licence" ? true : isClosure || nextType === "receipt" ? false : design.renewable,
    qrVerifyEnabled: !isClosure && nextType !== "receipt",
    digitalSignature: isClosure ? design.digitalSignature : design.digitalSignature || nextType !== "receipt",
  };
}

export function computeSampleValidTo(
  mode: ValidityMode,
  years: number,
  fixedDate: string,
  from = new Date(),
): string {
  if (mode === "none") return "—";
  if (mode === "fixed_date") return fixedDate || "—";
  const d = new Date(from);
  d.setFullYear(d.getFullYear() + (years || 1));
  return d.toISOString().slice(0, 10);
}

export function buildSampleMergeValues(
  design: IssuanceDesignState,
  serviceName: string,
  formFields: FormFieldDefinition[] = [],
): SampleMergeValues {
  const issued = new Date().toISOString().slice(0, 10);
  const values: SampleMergeValues = {
    applicant_name: "Sample Applicant",
    app_no: "APP/2026/00099",
    service_name: serviceName || "Sample service",
    cert_no: formatNumberingPreview(design.numberingTokens) || "XX/00001",
    issued_on: issued,
    valid_from: issued,
    valid_to: computeSampleValidTo(design.validityMode, design.validityYears, design.validityFixedDate),
    signatory_name: design.signatoryLabel || "Licensing Officer",
    resolution_summary: "Issue resolved after site verification. No further action required.",
    amount: "₹500",
    pay_link: "https://pay.example.local/sample",
    office_name: "Ward Office 12",
    ward: "W12",
  };
  for (const f of formFields) {
    if (!f.apiName || values[f.apiName] !== undefined) continue;
    if (f.type === "number") values[f.apiName] = "100";
    else if (f.type === "boolean") values[f.apiName] = "Yes";
    else if (f.type === "date") values[f.apiName] = issued;
    else if (f.choices?.length) values[f.apiName] = f.choices[0] ?? "Sample";
    else values[f.apiName] = `Sample ${f.label || f.apiName}`;
  }
  return values;
}

/** Replace {{tokens}} with sample values; unknown tokens stay as ⟨token⟩ markers. */
export function renderMergedTemplate(body: string, values: Record<string, string>): string {
  return body.replace(/\{\{([^}]+)\}\}/g, (_, raw: string) => {
    const key = raw.trim();
    if (key in values && values[key] !== undefined && values[key] !== "") return values[key]!;
    return `⟨${key}⟩`;
  });
}

export function buildSandboxPreview(
  design: IssuanceDesignState,
  serviceName: string,
  opts?: { pipelineAvailable?: boolean; formFields?: FormFieldDefinition[] },
): SandboxPreviewResult {
  const values = buildSampleMergeValues(design, serviceName, opts?.formFields ?? []);
  const mergedText = renderMergedTemplate(design.templateBody, values);
  const numberingExample = formatNumberingPreview(design.numberingTokens);
  if (opts?.pipelineAvailable) {
    return {
      mergedText,
      mode: "pipeline",
      banner:
        "Sample queued on the issuance pipeline. Preview below uses designer sample data — not a live citizen certificate.",
      numberingExample,
    };
  }
  return {
    mergedText,
    mode: "sandbox",
    banner:
      "Designer sandbox preview — sample data only. Live PDF issuance is unavailable in this environment (no fake payment or NPCI claims).",
    numberingExample,
  };
}

export function tabLabelForOutputType(outputType: OutputType): string {
  switch (outputType) {
    case "closure_note":
      return "Closure note";
    case "licence":
      return "Licence";
    case "receipt":
      return "Receipt";
    default:
      return "Certificate";
  }
}

export function isIssuanceDesignReady(design: IssuanceDesignState): boolean {
  if (!design.templateBody.trim()) return false;
  if (numberingWarning(design.numberingTokens)) return false;
  if (design.outputType !== "receipt" && !design.signatoryDesignationId) return false;
  if (design.validityMode === "fixed_date" && !design.validityFixedDate) return false;
  return true;
}
