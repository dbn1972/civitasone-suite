export class DomainError extends Error {
  constructor(public code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = "DomainError";
  }
}

export function assertCanDispose(status: string): void {
  if (!["pending", "appealed", "stayed"].includes(status)) {
    throw new DomainError("INVALID_STATUS", `case cannot be disposed from status '${status}'`);
  }
}
