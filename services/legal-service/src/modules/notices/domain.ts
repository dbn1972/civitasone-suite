export class DomainError extends Error {
  constructor(public code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = "DomainError";
  }
}

export function assertCanRespond(status: string): void {
  if (status !== "open") {
    throw new DomainError("INVALID_STATUS", `notice cannot be responded to from status '${status}'`);
  }
}
