export class DomainError extends Error {
  constructor(public code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = "DomainError";
  }
}

export function assertNotExpired(expiry: string): void {
  if (new Date(expiry) < new Date()) {
    throw new DomainError("CONTRACT_EXPIRED", `contract expired on ${expiry}`);
  }
}

export function assertCanAmend(status: string): void {
  if (status !== "active") {
    throw new DomainError("INVALID_STATUS", `only active contracts can be amended, got '${status}'`);
  }
}
