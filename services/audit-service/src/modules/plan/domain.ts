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

export function assertCanDefer(status: string): void {
  if (status !== "draft" && status !== "in_progress") {
    throw new DomainError("INVALID_STATUS", `only draft or in-progress plans can be deferred, got '${status}'`);
  }
}

export function assertCanComplete(status: string): void {
  if (status !== "in_progress") {
    throw new DomainError("INVALID_STATUS", `only in-progress plans can be completed, got '${status}'`);
  }
}
