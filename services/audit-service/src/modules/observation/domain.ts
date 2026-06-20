export class DomainError extends Error {
  constructor(public code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = "DomainError";
  }
}

export function assertCanDraftPara(status: string): void {
  if (status !== "open") {
    throw new DomainError("INVALID_STATUS", `only open observations can be drafted to para, got '${status}'`);
  }
}
