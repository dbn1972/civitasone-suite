export type OutputType = "certificate" | "licence" | "closure_note" | "receipt";

export type ValidityMode = "fixed_date" | "duration" | "none";

export interface NumberingToken {
  kind: "prefix" | "ward" | "year" | "seq";
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
}

export const OUTPUT_TYPE_OPTIONS: { id: OutputType; label: string }[] = [
  { id: "certificate", label: "Certificate" },
  { id: "licence", label: "Licence" },
  { id: "closure_note", label: "Closure note" },
  { id: "receipt", label: "Receipt" },
];

export function defaultOutputTypeForPattern(pattern: string): OutputType {
  return pattern === "grievance" ? "closure_note" : "certificate";
}

export function emptyIssuanceDesign(pattern = "certificate"): IssuanceDesignState {
  return {
    outputType: defaultOutputTypeForPattern(pattern),
    templateBody: "This is to certify that {{applicant_name}} has been granted {{service_name}}.\n\nCertificate number: {{cert_no}}\nValid until: {{valid_to}}",
    numberingTokens: [
      { kind: "prefix", value: "TL" },
      { kind: "ward" },
      { kind: "year" },
      { kind: "seq", seqWidth: 5 },
    ],
    signatoryDesignationId: "",
    signatoryLabel: "",
    digitalSignature: false,
    validityMode: "duration",
    validityYears: 1,
    validityFixedDate: "",
    renewable: false,
  };
}

export function formatNumberingPreview(tokens: NumberingToken[]): string {
  const year = new Date().getFullYear();
  return tokens.map((t) => {
    switch (t.kind) {
      case "prefix": return t.value || "XX";
      case "ward": return "W12";
      case "year": return String(year);
      case "seq": return String(41).padStart(t.seqWidth ?? 5, "0");
      default: return "";
    }
  }).join("/");
}
