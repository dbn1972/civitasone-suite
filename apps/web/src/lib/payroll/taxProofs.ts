/**
 * GAP-PAYROLL-TAX-DECLARATION-02: shared types, role sets and pure helpers for
 * investment-proof upload / verification (no React, no I/O except `uploadProof`).
 *
 * Role sets mirror payroll-service's tax-proofs/domain.ts exactly.
 */
import { browserFetch, errorCodeFromResponse } from "@/lib/api/browserClient";

export const PROOF_LINES = ["rent", "sec80c", "sec80d", "sec80g", "home_loan_interest", "other"] as const;
export type ProofLine = (typeof PROOF_LINES)[number];

export type ProofStatus = "pending" | "accepted" | "rejected";

export const PROOF_MAX_BYTES = 10 * 1024 * 1024;
export const PROOF_MAX_MB = 10;
export const PROOF_MAX_FILES = 10;
export const PROOF_ACCEPT = "application/pdf,image/jpeg,image/png";
const ALLOWED_TYPES = ["application/pdf", "image/jpeg", "image/png"];

/** Payroll staff who verify (and view) proofs, plus the read-only auditor. HR, managers and finance are deliberately absent. */
export const TAX_PROOF_VIEWER_ROLES = ["payroll_officer", "payroll_admin", "auditor"];
export const TAX_PROOF_DECIDER_ROLES = ["payroll_officer", "payroll_admin"];
export const TAX_PROOF_HOLD_ROLES = ["payroll_admin"];
export const TAX_PROOF_RETENTION_ROLES = ["payroll_admin", "tenant_admin", "super_admin"];

export interface ProofItem {
  id: string;
  line: ProofLine;
  fy: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  amountMinor: string | null;
  status: ProofStatus;
  rejectionReason: string | null;
  createdAt: string;
  decidedAt: string | null;
}

export interface QueueItem extends ProofItem {
  employeeId: string;
  employeeName: string | null;
  employeeNo: string | null;
  legalHold: boolean;
  legalHoldReason: string | null;
}

export interface LineSummary {
  line: ProofLine;
  total: number;
  pending: number;
  accepted: number;
  rejected: number;
  maxFiles: number;
  declaredMinor: string | null;
  verifiedMinor: string;
}

export interface MineResponse {
  fy: string;
  /** True only when the tenant opted in to verified-amount TDS for this FY. */
  verifiedTdsEnabled?: boolean;
  /** Date after which only accepted documents count for TDS (null when not opted in). */
  cutoffDate?: string | null;
  items: ProofItem[];
  summary: LineSummary[];
}

export interface QueueResponse {
  data: QueueItem[];
  meta: { total: number; limit: number; offset: number; counts: Record<string, number> };
}

export interface RetentionSettings {
  taxProofRetentionYears: number;
  defaultYears: number;
  minYears: number;
  maxYears: number;
  canEdit: boolean;
  canHold: boolean;
  taxProofCutoff: string;
  defaultCutoff: string;
  currentFyCutoffDate: string | null;
  canEditCutoff: boolean;
  taxProofVerifiedFromFy: string | null;
  canEditVerifiedFrom: boolean;
}

/** "YYYY-YY" whose suffix is startYear+1 (mod 100); mirrors payroll-service isValidFy. */
export function isValidFy(fy: string): boolean {
  const m = /^(\d{4})-(\d{2})$/.exec(fy);
  return !!m && Number(m[2]) === (Number(m[1]) + 1) % 100;
}

/** Paise (string) -> plain rupees for an <input>, or "" when there is no amount. */
export function minorToRupeesInput(minor: string | null): string {
  if (minor === null || minor === "") return "";
  const n = Number(minor);
  return Number.isFinite(n) ? (n / 100).toFixed(2) : "";
}

/** "MM-DD" that exists on a calendar (02-29 allowed); mirrors payroll-service isValidCutoffMd. */
export function isValidCutoffMd(md: string): boolean {
  const m = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.exec(md);
  if (!m) return false;
  return Number(m[2]) <= [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][Number(m[1]) - 1]!;
}

export function hasAnyRole(roles: readonly string[], allowed: readonly string[]): boolean {
  return allowed.some((r) => roles.includes(r));
}

/** True when a list has nothing to show (kept out of page.tsx so the empty-vs-error guard stays quiet). */
export function isEmptyList(items: readonly unknown[] | null | undefined): boolean {
  return !items || items.length < 1;
}

export type FileCheck = "ok" | "empty" | "size" | "type";

/** Client-side pre-check; the server re-checks size and type against the stored object. */
export function validateProofFile(file: { size: number; type: string }): FileCheck {
  if (!ALLOWED_TYPES.includes(file.type)) return "type";
  if (file.size <= 0) return "empty";
  if (file.size > PROOF_MAX_BYTES) return "size";
  return "ok";
}

export function itemsForLine(items: readonly ProofItem[], line: ProofLine): ProofItem[] {
  return items.filter((i) => i.line === line);
}

export function isLineFull(summary: LineSummary | undefined, items: readonly ProofItem[], line: ProofLine): boolean {
  return itemsForLine(items, line).length >= (summary?.maxFiles ?? PROOF_MAX_FILES);
}

/** Server error `code` -> i18n key under taxProofs.errors (null: use the generic catalogued message). */
export function errorKeyForCode(code: string | null): string | null {
  switch (code) {
    case "PROOF_TOO_LARGE": return "tooLarge";
    case "PROOF_TYPE_INVALID": return "wrongType";
    case "PROOF_FILE_MISSING": return "fileMissing";
    case "INVALID_STORAGE_KEY": return "invalidKey";
    case "PROOF_LIMIT_REACHED": return "lineFull";
    case "AMOUNT_REQUIRED": return "amountRequired";
    case "SELF_VERIFY_FORBIDDEN": return "selfVerify";
    case "INVALID_STATE": return "alreadyDecided";
    case "LEGAL_HOLD": return "legalHold";
    case "STORAGE_NOT_CONFIGURED": return "storageNotConfigured";
    case "FORBIDDEN": return "forbidden";
    default: return null;
  }
}

export type UploadResult = { ok: true } | { ok: false; code: string | null };

/**
 * presign -> direct PUT to private storage (with exactly the headers the
 * server signed, including server-side encryption) -> attach. The file never
 * passes through the API server.
 */
export async function uploadProof(input: { fy: string; line: ProofLine; file: File; amountMinor?: string | null }): Promise<UploadResult> {
  const { fy, line, file, amountMinor } = input;
  const presign = await browserFetch("v1/payroll/tax-proofs/presign", {
    method: "POST",
    body: JSON.stringify({ fy, line, filename: file.name, contentType: file.type, sizeBytes: file.size }),
  });
  if (!presign.ok) return { ok: false, code: await errorCodeFromResponse(presign) };
  const { storageKey, uploadUrl, headers } = (await presign.json()) as { storageKey: string; uploadUrl: string; headers: Record<string, string> };

  const put = await fetch(uploadUrl, { method: "PUT", headers, body: file });
  if (!put.ok) return { ok: false, code: "UPLOAD_FAILED" };

  const attach = await browserFetch("v1/payroll/tax-proofs", {
    method: "POST",
    body: JSON.stringify({
      fy, line, storageKey, filename: file.name,
      ...(amountMinor ? { amountMinor: Number(amountMinor) } : {}),
    }),
  });
  if (!attach.ok) return { ok: false, code: await errorCodeFromResponse(attach) };
  return { ok: true };
}

/** Ask for a short-lived view link (audited server-side) and open it in a new tab. */
export async function openProof(id: string): Promise<{ ok: true } | { ok: false; code: string | null }> {
  const res = await browserFetch(`v1/payroll/tax-proofs/${id}/url`);
  if (!res.ok) return { ok: false, code: await errorCodeFromResponse(res) };
  const { url } = (await res.json()) as { url: string };
  window.open(url, "_blank", "noopener,noreferrer");
  return { ok: true };
}

/** Last `count` financial-year labels ending at (and including) `current`, newest first. */
export function recentFinancialYears(current: string, count = 6): string[] {
  const start = Number(current.slice(0, 4));
  if (!Number.isFinite(start)) return [current];
  return Array.from({ length: count }, (_, i) => {
    const y = start - i;
    return `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
  });
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}
