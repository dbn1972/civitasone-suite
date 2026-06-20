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

export function isTopSecret(classification: string): boolean {
  return classification === "top_secret";
}
