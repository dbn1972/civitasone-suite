export class DomainError extends Error {
  constructor(public code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = "DomainError";
  }
}

export function assertCanAdjourn(status: string): void {
  if (!["scheduled", "adjourned"].includes(status)) {
    throw new DomainError("INVALID_STATUS", `hearing cannot be adjourned from status '${status}'`);
  }
}
