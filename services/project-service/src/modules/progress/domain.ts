export class DomainError extends Error {
  constructor(public code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = "DomainError";
  }
}

export function assertPhysicalPctValid(pct: number): void {
  if (pct < 0 || pct > 100) {
    throw new DomainError("INVALID_PHYSICAL_PCT", `physical progress % must be 0–100, got ${pct}`);
  }
}

export function assertDprDateUnique(existing: boolean, dprDate: string): void {
  if (existing) {
    throw new DomainError("DPR_DATE_DUPLICATE", `DPR already submitted for date ${dprDate} — immutable once submitted`);
  }
}
