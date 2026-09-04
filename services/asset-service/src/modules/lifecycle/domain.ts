export class DomainError extends Error {
  constructor(public code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = "DomainError";
  }
}

export function assertAssetTransferable(status: string): void {
  // Only "active" assets may be transferred. An asset under maintenance is
  // physically unavailable for handover and must not be reassigned mid-repair
  // (see tests/routes-coverage-full.test.ts "assertAssetTransferable throws for
  // non-active" and tests/lifecycle-deep.test.ts).
  const transferableStatuses = ["active"];
  if (!transferableStatuses.includes(status)) {
    throw new DomainError("ASSET_NOT_TRANSFERABLE", `asset with status '${status}' cannot be transferred`);
  }
}

export function assertAssetDisposable(status: string): void {
  if (status === "disposed" || status === "written_off") {
    throw new DomainError("ASSET_ALREADY_DISPOSED", `asset already ${status}`);
  }
}

/** Disposal gain/loss: proceeds - book_value (positive = gain, negative = loss) */
export function computeDisposalGainLoss(proceedsMinor: bigint, bookValueMinor: bigint): bigint {
  return proceedsMinor - bookValueMinor;
}
