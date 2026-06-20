export class DomainError extends Error {
  constructor(public code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = "DomainError";
  }
}

export function assertAdvancePositive(amount: bigint): void {
  if (amount <= 0n) {
    throw new DomainError("INVALID_AMOUNT", "advance amount must be positive");
  }
}
