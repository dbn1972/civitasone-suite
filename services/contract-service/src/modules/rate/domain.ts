export class DomainError extends Error {
  constructor(public code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = "DomainError";
  }
}

export function assertRcActive(status: string): void {
  if (status !== "active") {
    throw new DomainError("RC_NOT_ACTIVE", `rate contract is not active, got '${status}'`);
  }
}
