export class DomainError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

export const FILE_CLASSIFICATIONS = ["top_secret", "secret", "confidential", "public"] as const;
export const FILE_STATUSES = ["draft", "active", "closed", "archived"] as const;

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
