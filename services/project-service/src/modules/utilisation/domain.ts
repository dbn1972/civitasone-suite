export class DomainError extends Error {
  constructor(public code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = "DomainError";
  }
}

export function assertUcExpenditureWithinReleased(
  releasedMinor: bigint,
  expenditureMinor: bigint
): void {
  if (expenditureMinor > releasedMinor) {
    throw new DomainError(
      "UC_EXPENDITURE_EXCEEDS_RELEASED",
      `UC expenditure ${expenditureMinor} paise exceeds total released ${releasedMinor} paise`
    );
  }
}
