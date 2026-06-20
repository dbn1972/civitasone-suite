export class DomainError extends Error {
  constructor(public code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = "DomainError";
  }
}

export function assertCanClear(status: string): void {
  if (status !== "pending") {
    throw new DomainError("INVALID_STATUS", `only pending reviews can be cleared, got '${status}'`);
  }
}
