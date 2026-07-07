/**
 * Documents DMS domain logic — pure functions for folder depth validation
 * and legal-hold enforcement.
 */

/** Maximum folder nesting depth allowed. */
export const MAX_FOLDER_DEPTH = 5;

export class DocumentDomainError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "DocumentDomainError";
  }
}

/**
 * Validates that creating a child at the given parent depth would not exceed
 * the maximum folder depth (5 levels).
 *
 * Depth 0 = root level, depth 4 = 5th level (max). Attempting depth 5+ is rejected.
 */
export function validateFolderDepth(parentDepth: number): void {
  const childDepth = parentDepth + 1;
  if (childDepth > MAX_FOLDER_DEPTH - 1) {
    throw new DocumentDomainError(
      "MAX_DEPTH_EXCEEDED",
      `Folder hierarchy cannot exceed ${MAX_FOLDER_DEPTH} levels deep (attempted depth ${childDepth + 1})`,
    );
  }
}

/**
 * Asserts that a document under legal hold cannot be deleted.
 */
export function assertCanDelete(legalHold: boolean): void {
  if (legalHold) {
    throw new DocumentDomainError(
      "LEGAL_HOLD_ACTIVE",
      "Document is under legal hold and cannot be deleted",
    );
  }
}

/**
 * Asserts that a document under legal hold cannot have its content modified.
 * Metadata reads and updates (name, etc.) are still allowed.
 */
export function assertCanModifyContent(legalHold: boolean): void {
  if (legalHold) {
    throw new DocumentDomainError(
      "LEGAL_HOLD_ACTIVE",
      "Document is under legal hold and its content cannot be modified",
    );
  }
}

/**
 * Computes the depth of a new document/folder based on parent.
 * Root-level items (no parent) have depth 0.
 */
export function computeDepth(parentDepth: number | null): number {
  if (parentDepth === null) return 0;
  return parentDepth + 1;
}
