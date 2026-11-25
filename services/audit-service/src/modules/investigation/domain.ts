export class DomainError extends Error {
  constructor(public code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = "DomainError";
  }
}

export const CLOSE_OUTCOMES = ["substantiated", "unsubstantiated", "inconclusive", "referred"] as const;

/** Closed is terminal: a closed case can be neither re-assigned nor closed again. */
export function assertCanAssign(status: string): void {
  if (status === "closed") throw new DomainError("INVALID_STATUS", "a closed investigation cannot be reassigned");
}

export function assertCanClose(status: string): void {
  if (status === "closed") throw new DomainError("INVALID_STATUS", "investigation is already closed");
}
