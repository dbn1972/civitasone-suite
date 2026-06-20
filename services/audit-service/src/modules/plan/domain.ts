export class DomainError extends Error {
  constructor(public code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = "DomainError";
  }
}

export function assertCanStart(status: string): void {
  if (status !== "draft") {
    throw new DomainError("INVALID_STATUS", `only draft plans can be started, got '${status}'`);
  }
}
