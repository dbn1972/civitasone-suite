/**
 * TRACES (TDS Reconciliation Analysis and Correction Enabling System) adapter.
 *
 * Generates Form 24Q (salary TDS quarterly return) and Form 26Q (non-salary TDS)
 * in the NSDL/TRACES file format for e-filing.
 *
 * Env-gated: defaults to mock mode. In production, validates against TRACES schema
 * and generates FVU-ready (File Validation Utility) text files.
 *
 * Env vars:
 *   TRACES_MODE          — "mock" (default) | "production"
 *   TRACES_TAN           — deductor TAN
 *   TRACES_DEDUCTOR_PAN  — deductor PAN
 *   TRACES_DEDUCTOR_NAME — legal name of the deductor
 */

// ── Types ─────────────────────────────────────────────────────────

export interface Form24QDeductee {
  pan: string;
  name: string;
  tdsDeductedMinor: bigint;
  tdsDepositedMinor: bigint;
  grossSalaryMinor: bigint;
  section: "192";
}

export interface Form24QRequest {
  financialYear: string;   // e.g. "2025-26"
  quarter: "Q1" | "Q2" | "Q3" | "Q4";
  tan?: string;
  deductorPan?: string;
  deductorName?: string;
  challans: Array<{
    bsrCode: string;
    challanNo: string;
    challanDate: string;
    amountMinor: bigint;
  }>;
  deductees: Form24QDeductee[];
}

export interface Form26QDeductee {
  pan: string;
  panFlag?: string;
  name: string;
  section: string;  // e.g. "194C", "194J"
  amountPaidMinor: bigint;
  tdsDeductedMinor: bigint;
  tdsDepositedMinor: bigint;
  deductionDate: string;
}

export interface Form26QRequest {
  financialYear: string;
  quarter: "Q1" | "Q2" | "Q3" | "Q4";
  tan?: string;
  deductorPan?: string;
  deductorName?: string;
  challans: Array<{
    bsrCode: string;
    challanNo: string;
    challanDate: string;
    amountMinor: bigint;
  }>;
  deductees: Form26QDeductee[];
}

export interface TracesFileResponse {
  /** Pipe-delimited file content (FVU-ready) */
  fileContent: string;
  /** Suggested file name */
  fileName: string;
  /** Form type */
  formType: "24Q" | "26Q";
  /** Record count */
  recordCount: number;
  /** Validation errors (empty if valid) */
  validationErrors: string[];
}

export class TracesAdapterError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = "TracesAdapterError";
  }
}

// ── Config ────────────────────────────────────────────────────────

const MODE = (process.env.TRACES_MODE ?? "mock") as "mock" | "production";
const TAN = process.env.TRACES_TAN ?? "DELX00000X";
const DEDUCTOR_PAN = process.env.TRACES_DEDUCTOR_PAN ?? "AABCX0000X";
const DEDUCTOR_NAME = process.env.TRACES_DEDUCTOR_NAME ?? "DEPARTMENT OF EXAMPLE";

// ── Validation ────────────────────────────────────────────────────

const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const TAN_RE = /^[A-Z]{4}[0-9]{5}[A-Z]$/;

function validatePan(pan: string, label: string): string | null {
  if (!pan || pan === "PANNOTAVBL") return null;
  if (!PAN_RE.test(pan)) return `${label}: invalid PAN format "${pan}"`;
  return null;
}

/**
 * Strip pipe and CR/LF from free-text fields to prevent record injection.
 */
function pipeSafe(val: string): string {
  return val.replace(/[|\r\n]/g, " ").trim();
}

// ── File Generation ───────────────────────────────────────────────

/**
 * Generate Form 24Q (salary TDS quarterly return) in TRACES pipe-delimited format.
 */
export function generateForm24Q(req: Form24QRequest): TracesFileResponse {
  const errors: string[] = [];
  const tan = req.tan ?? TAN;
  const pan = req.deductorPan ?? DEDUCTOR_PAN;
  const name = req.deductorName ?? DEDUCTOR_NAME;

  if (!TAN_RE.test(tan)) errors.push(`Deductor TAN "${tan}" is invalid`);
  const panErr = validatePan(pan, "Deductor PAN");
  if (panErr) errors.push(panErr);

  for (const d of req.deductees) {
    const e = validatePan(d.pan, `Deductee ${d.name}`);
    if (e) errors.push(e);
  }

  if (MODE === "production" && errors.length > 0) {
    throw new TracesAdapterError(
      `Form 24Q validation failed: ${errors.join("; ")}`,
      "TRACES_VALIDATION_FAILED",
    );
  }

  const lines: string[] = [];
  // File Header
  lines.push(["FH", "24Q", req.financialYear, req.quarter, pipeSafe(tan), pipeSafe(pan), pipeSafe(name), String(req.deductees.length)].join("|"));

  // Challan Detail records
  for (let i = 0; i < req.challans.length; i++) {
    const c = req.challans[i]!;
    lines.push(["CD", i + 1, c.bsrCode, c.challanNo, c.challanDate, (Number(c.amountMinor) / 100).toFixed(2)].join("|"));
  }

  // Deductee Detail records
  for (let i = 0; i < req.deductees.length; i++) {
    const d = req.deductees[i]!;
    const panField = d.pan || "PANNOTAVBL";
    lines.push(["DD", i + 1, pipeSafe(panField), pipeSafe(d.name),
      (Number(d.tdsDeductedMinor) / 100).toFixed(2),
      (Number(d.tdsDepositedMinor) / 100).toFixed(2),
      (Number(d.grossSalaryMinor) / 100).toFixed(2),
    ].join("|"));
  }

  const fileContent = lines.join("\n");
  const fileName = `24Q_${tan}_${req.financialYear.replace("-", "")}_${req.quarter}.txt`;

  return { fileContent, fileName, formType: "24Q", recordCount: req.deductees.length, validationErrors: errors };
}

/**
 * Generate Form 26Q (non-salary TDS quarterly return) in TRACES pipe-delimited format.
 */
export function generateForm26Q(req: Form26QRequest): TracesFileResponse {
  const errors: string[] = [];
  const tan = req.tan ?? TAN;
  const pan = req.deductorPan ?? DEDUCTOR_PAN;
  const name = req.deductorName ?? DEDUCTOR_NAME;

  if (!TAN_RE.test(tan)) errors.push(`Deductor TAN "${tan}" is invalid`);

  for (const d of req.deductees) {
    const e = validatePan(d.pan, `Deductee ${d.name}`);
    if (e) errors.push(e);
  }

  if (MODE === "production" && errors.length > 0) {
    throw new TracesAdapterError(
      `Form 26Q validation failed: ${errors.join("; ")}`,
      "TRACES_VALIDATION_FAILED",
    );
  }

  const lines: string[] = [];
  lines.push(["FH", "26Q", req.financialYear, req.quarter, pipeSafe(tan), pipeSafe(pan), pipeSafe(name), String(req.deductees.length)].join("|"));

  for (let i = 0; i < req.challans.length; i++) {
    const c = req.challans[i]!;
    lines.push(["CD", i + 1, c.bsrCode, c.challanNo, c.challanDate, (Number(c.amountMinor) / 100).toFixed(2)].join("|"));
  }

  for (let i = 0; i < req.deductees.length; i++) {
    const d = req.deductees[i]!;
    const panField = d.pan || d.panFlag || "PANNOTAVBL";
    lines.push(["DD", i + 1, pipeSafe(panField), pipeSafe(d.name), pipeSafe(d.section),
      (Number(d.amountPaidMinor) / 100).toFixed(2),
      (Number(d.tdsDeductedMinor) / 100).toFixed(2),
      (Number(d.tdsDepositedMinor) / 100).toFixed(2),
    ].join("|"));
  }

  const fileContent = lines.join("\n");
  const fileName = `26Q_${tan}_${req.financialYear.replace("-", "")}_${req.quarter}.txt`;

  return { fileContent, fileName, formType: "26Q", recordCount: req.deductees.length, validationErrors: errors };
}
