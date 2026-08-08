export type OutputType = "certificate" | "licence" | "closure_note" | "receipt";

export type ValidityMode = "fixed_date" | "duration" | "none";

export type TemplateOrientation = "portrait" | "landscape";

export interface NumberingToken {
  kind: "prefix" | "ward" | "year" | "seq" | "office";
  value?: string;
  seqWidth?: number;
}

export interface IssuanceDesignState {
  outputType: OutputType;
  templateBody: string;
  numberingTokens: NumberingToken[];
  signatoryDesignationId: string;
  signatoryLabel: string;
  digitalSignature: boolean;
  validityMode: ValidityMode;
  validityYears: number;
  validityFixedDate: string;
  renewable: boolean;
  /** Days before expiry when renewal may open (FN-15 linkage note). */
  renewalWindowDays: number;
  orientation: TemplateOrientation;
  /** QR verify zone on certificate / licence templates. */
  qrVerifyEnabled: boolean;
}

export const OUTPUT_TYPE_OPTIONS: { id: OutputType; label: string; hint: string }[] = [
  { id: "certificate", label: "Certificate", hint: "Signed credential handed to the applicant" },
  { id: "licence", label: "Licence", hint: "Permission with validity and usually renewal" },
  { id: "closure_note", label: "Closure note", hint: "Resolution summary — default for grievances" },
  { id: "receipt", label: "Receipt", hint: "Payment or acknowledgement slip" },
];

export function defaultOutputTypeForPattern(pattern: string): OutputType {
  return pattern === "grievance" ? "closure_note" : "certificate";
}

export function certificateTemplateBody(serviceHint = "{{service_name}}"): string {
  return (
    `This is to certify that {{applicant_name}} has been granted ${serviceHint}.\n\n` +
    `Certificate number: {{cert_no}}\n` +
    `Issued on: {{issued_on}}\n` +
    `Valid until: {{valid_to}}\n` +
    `Office: {{office_name}}`
  );
}

export function closureNoteTemplateBody(): string {
  return (
    `Closure note\n\n` +
    `Case / application: {{app_no}}\n` +
    `Complainant: {{applicant_name}}\n` +
    `Service: {{service_name}}\n\n` +
    `Resolution summary:\n` +
    `{{resolution_summary}}\n\n` +
    `Closed on: {{issued_on}}\n` +
    `Closed by: {{signatory_name}}\n` +
    `Office: {{office_name}}`
  );
}

export function licenceTemplateBody(): string {
  return (
    `Licence\n\n` +
    `This licence is hereby granted to {{applicant_name}} for {{service_name}}.\n\n` +
    `Licence number: {{cert_no}}\n` +
    `Valid from: {{valid_from}}\n` +
    `Valid until: {{valid_to}}\n` +
    `Ward: {{ward}}\n` +
    `Office: {{office_name}}`
  );
}

export function receiptTemplateBody(): string {
  return (
    `Receipt\n\n` +
    `Received from {{applicant_name}} for {{service_name}}.\n` +
    `Application: {{app_no}}\n` +
    `Amount: {{amount}}\n` +
    `Receipt number: {{cert_no}}\n` +
    `Date: {{issued_on}}`
  );
}

export function defaultTemplateBodyForOutputType(outputType: OutputType): string {
  switch (outputType) {
    case "closure_note":
      return closureNoteTemplateBody();
    case "licence":
      return licenceTemplateBody();
    case "receipt":
      return receiptTemplateBody();
    default:
      return certificateTemplateBody();
  }
}

export function emptyIssuanceDesign(pattern = "certificate"): IssuanceDesignState {
  const outputType = defaultOutputTypeForPattern(pattern);
  const isClosure = outputType === "closure_note";
  return {
    outputType,
    templateBody: defaultTemplateBodyForOutputType(outputType),
    numberingTokens: isClosure
      ? [
          { kind: "prefix", value: "GRV" },
          { kind: "year" },
          { kind: "seq", seqWidth: 5 },
        ]
      : [
          { kind: "prefix", value: "TL" },
          { kind: "ward" },
          { kind: "year" },
          { kind: "seq", seqWidth: 5 },
        ],
    signatoryDesignationId: "",
    signatoryLabel: "",
    digitalSignature: !isClosure,
    validityMode: isClosure ? "none" : "duration",
    validityYears: 1,
    validityFixedDate: "",
    renewable: outputType === "licence",
    renewalWindowDays: 30,
    orientation: "portrait",
    qrVerifyEnabled: !isClosure && outputType !== "receipt",
  };
}

export function formatNumberingPreview(tokens: NumberingToken[]): string {
  const year = new Date().getFullYear();
  return tokens
    .map((t) => {
      switch (t.kind) {
        case "prefix":
          return t.value || "XX";
        case "ward":
          return "W12";
        case "year":
          return String(year);
        case "office":
          return t.value || "HO";
        case "seq":
          return String(41).padStart(t.seqWidth ?? 5, "0");
        default:
          return "";
      }
    })
    .filter(Boolean)
    .join("/");
}
