export class DomainError extends Error {
  constructor(public code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = "DomainError";
  }
}

export function assertCanDraft(status: string): void {
  if (status !== "sought") {
    throw new DomainError("INVALID_STATUS", `opinion cannot be drafted from status '${status}'`);
  }
}

export function assertCanIssue(status: string): void {
  if (status !== "drafted") {
    throw new DomainError("INVALID_STATUS", `opinion cannot be issued from status '${status}'`);
  }
}
