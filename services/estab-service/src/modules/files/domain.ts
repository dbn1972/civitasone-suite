import { createHash } from "node:crypto";

export class DomainError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

export const FILE_CLASSIFICATIONS = ["top_secret", "secret", "confidential", "public"] as const;
export const FILE_STATUSES = ["draft", "active", "closed", "archived"] as const;

/** CSMOP file-type taxonomy (R2). */
export const FILE_TYPES = ["main", "part", "volume", "linked", "standing_guard", "ephemeral"] as const;
export type FileType = (typeof FILE_TYPES)[number];

export function assertValidFileType(v: string): asserts v is FileType {
  if (!(FILE_TYPES as readonly string[]).includes(v)) {
    throw new DomainError("INVALID_FILE_TYPE", `file_type must be one of: ${FILE_TYPES.join(", ")}`);
  }
}

const ROMAN: ReadonlyArray<[number, string]> = [
  [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"],
  [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
];
export function toRoman(n: number): string {
  let rem = Math.max(1, Math.floor(n));
  let out = "";
  for (const [v, sym] of ROMAN) { while (rem >= v) { out += sym; rem -= v; } }
  return out;
}

/**
 * Derive a child file number from a base file number (CSMOP). A volume appends
 * `/Vol-<roman>`; a part appends `(Part-<n>)`. The base (main file) number stays
 * the immutable parent reference.
 */
export function deriveChildFileNo(baseFileNo: string, type: FileType, n: number): string {
  if (type === "volume") return `${baseFileNo}/Vol-${toRoman(n)}`;
  if (type === "part") return `${baseFileNo}(Part-${n})`;
  return baseFileNo;
}

export type FileClassification = (typeof FILE_CLASSIFICATIONS)[number];

export function assertValidClassification(v: string): asserts v is FileClassification {
  if (!(FILE_CLASSIFICATIONS as readonly string[]).includes(v)) {
    throw new DomainError("INVALID_CLASSIFICATION", `classification must be one of: ${FILE_CLASSIFICATIONS.join(", ")}`);
  }
}

export const NOTE_TYPES = ["yellow", "green", "remark", "order"] as const;
export const NOTE_STATUSES = ["draft", "submitted", "approved", "rejected"] as const;
export type NoteType = (typeof NOTE_TYPES)[number];
export type NoteStatus = (typeof NOTE_STATUSES)[number];

/** SLA default: 15 working days from receipt (simplified as calendar days). */
export function computeFileDueBy(from: Date = new Date()): Date {
  const d = new Date(from);
  d.setDate(d.getDate() + 15);
  return d;
}

export function mapNoteTypeForUi(noteType: string, eSigned: boolean): "note" | "order" | "remark" {
  if (noteType === "green" || (noteType === "yellow" && eSigned)) return "order";
  if (noteType === "remark") return "remark";
  return "note";
}

export function isTopSecret(classification: string): boolean {
  return classification === "top_secret";
}

/**
 * Tamper-evident noting signature hash. Each green note links to the previous
 * green note's hash (prevHash), forming a per-file chain SO → US → DS that a
 * DBA cannot silently rewrite without breaking every subsequent link.
 */
export function computeNotingHash(
  notingId: string,
  body: string,
  officerId: string,
  prevHash: string,
  signedAtMs: number,
): string {
  return createHash("sha256")
    .update(`${notingId}:${body}:${officerId}:${prevHash}:${signedAtMs}`)
    .digest("hex");
}
