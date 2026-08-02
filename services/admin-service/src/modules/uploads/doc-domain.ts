/**
 * DM-002 — pure domain logic for document types, mandatory documents and expiry.
 *
 * Three deterministic pieces:
 *   1. expiry classification — `active` | `expiring` | `expired` from a document's
 *      expiry date and its type's warning window.
 *   2. compliance evaluation — for a context, which mandatory types are
 *      satisfied, missing, expiring or expired.
 *   3. guards — expiry is mandatory when the type says so; extension/size rules;
 *      the optimistic-lock check.
 *
 * No I/O and no PII: this module only ever sees type codes, context keys, opaque
 * subject ids and dates.
 */
import { HttpError } from "../../shared/context.js";

export const DOCUMENT_CATEGORIES = [
  "resume", "attachment", "document", "photo", "certificate", "licence",
] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

export const DOCUMENT_STATUSES = ["active", "expiring", "expired", "superseded"] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

const DAY_MS = 24 * 60 * 60_000;

/** Whole days from `now` until `expiresAt` (negative once past). */
export function daysUntil(expiresAt: Date | string, now = new Date()): number {
  const t = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
  return Math.floor((t.getTime() - now.getTime()) / DAY_MS);
}

/**
 * Classify a document by expiry. A document with no expiry date is always
 * `active`. `superseded` is a manual state and is never derived here — a
 * superseded document keeps that status.
 */
export function classifyExpiry(
  current: string,
  expiresAt: Date | string | null | undefined,
  warnDays: number,
  now = new Date(),
): DocumentStatus {
  if (current === "superseded") return "superseded";
  if (expiresAt === null || expiresAt === undefined) return "active";
  const t = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
  if (Number.isNaN(t.getTime())) return "active";
  if (t.getTime() <= now.getTime()) return "expired";
  if (daysUntil(t, now) <= warnDays) return "expiring";
  return "active";
}

export interface RequirementInput {
  documentTypeCode: string;
  mandatory: boolean;
}

export interface DocumentInput {
  documentTypeCode: string;
  status: string;
  expiresAt: Date | string | null;
}

export interface ComplianceLine {
  documentTypeCode: string;
  mandatory: boolean;
  /** satisfied | missing | expiring | expired */
  outcome: "satisfied" | "missing" | "expiring" | "expired";
  daysRemaining: number | null;
}

export interface ComplianceReport {
  lines: ComplianceLine[];
  compliant: boolean;
  missingCount: number;
  expiredCount: number;
  expiringCount: number;
}

/**
 * Evaluate a context against its requirements.
 *
 * Precedence per requirement, using the BEST document held of that type:
 *   an `active` document satisfies it; otherwise an `expiring` one reports
 *   expiring; otherwise `expired`; with no document at all it is `missing`.
 * A context is compliant only when every MANDATORY requirement is satisfied —
 * an expiring mandatory document is compliant-but-flagged, an expired one is not.
 */
export function evaluateCompliance(
  requirements: readonly RequirementInput[],
  held: readonly DocumentInput[],
  warnDaysByType: Readonly<Record<string, number>>,
  now = new Date(),
): ComplianceReport {
  const lines: ComplianceLine[] = [];

  for (const req of requirements) {
    const docs = held.filter((d) => d.documentTypeCode === req.documentTypeCode && d.status !== "superseded");
    if (docs.length === 0) {
      lines.push({ documentTypeCode: req.documentTypeCode, mandatory: req.mandatory, outcome: "missing", daysRemaining: null });
      continue;
    }
    const warnDays = warnDaysByType[req.documentTypeCode] ?? 30;
    const classified = docs.map((d) => ({
      state: classifyExpiry(d.status, d.expiresAt, warnDays, now),
      daysRemaining: d.expiresAt === null ? null : daysUntil(d.expiresAt, now),
    }));
    const best = classified.find((c) => c.state === "active")
      ?? classified.find((c) => c.state === "expiring")
      ?? classified[0];
    const outcome: ComplianceLine["outcome"] =
      best === undefined || best.state === "active" ? "satisfied"
        : best.state === "expiring" ? "expiring" : "expired";
    lines.push({
      documentTypeCode: req.documentTypeCode,
      mandatory: req.mandatory,
      outcome,
      daysRemaining: best?.daysRemaining ?? null,
    });
  }

  const missingCount = lines.filter((l) => l.outcome === "missing").length;
  const expiredCount = lines.filter((l) => l.outcome === "expired").length;
  const expiringCount = lines.filter((l) => l.outcome === "expiring").length;
  const compliant = !lines.some((l) => l.mandatory && (l.outcome === "missing" || l.outcome === "expired"));

  return { lines, compliant, missingCount, expiredCount, expiringCount };
}

// ── guards ──────────────────────────────────────────────────────────────────

/** A type flagged `expiryRequired` cannot have a document registered without one. */
export function assertExpiryPresentWhenRequired(expiryRequired: boolean, expiresAt: string | null | undefined): void {
  if (expiryRequired && (expiresAt === null || expiresAt === undefined)) {
    throw new HttpError(422, "EXPIRY_REQUIRED", "this document type requires an expiry date");
  }
}

/** Expiry must be after issue: an already-expired-on-issue document is a data error. */
export function assertExpiryAfterIssue(issuedAt: string | null | undefined, expiresAt: string | null | undefined): void {
  if (issuedAt === null || issuedAt === undefined || expiresAt === null || expiresAt === undefined) return;
  if (new Date(expiresAt).getTime() <= new Date(issuedAt).getTime()) {
    throw new HttpError(422, "INVALID_EXPIRY", "expiresAt must be after issuedAt");
  }
}

/** The document's file extension must be one the type allows. */
export function assertExtensionAllowed(storageKey: string, allowed: readonly string[]): void {
  if (allowed.length === 0) return; // no restriction configured
  const ext = storageKey.split(".").pop()?.toLowerCase() ?? "";
  if (!allowed.map((e) => e.toLowerCase()).includes(ext)) {
    throw new HttpError(
      422,
      "EXTENSION_NOT_ALLOWED",
      `document type allows only: ${allowed.join(", ")}`,
    );
  }
}

/** A retired document type cannot accept new documents or requirements. */
export function assertTypeActive(status: string): void {
  if (status !== "active") {
    throw new HttpError(422, "DOCUMENT_TYPE_RETIRED", `document type is '${status}' and cannot be used`);
  }
}

/** Optimistic-lock guard — same contract as the other modules'. */
export function assertVersionMatch(current: number, expected: number | undefined): void {
  if (expected === undefined) return;
  if (current !== expected) {
    throw new HttpError(
      409,
      "VERSION_CONFLICT",
      `version conflict: expected ${expected}, current is ${current}`,
    );
  }
}
