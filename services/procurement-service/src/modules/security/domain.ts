export class DomainError extends Error {
  constructor(public code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = "DomainError";
  }
}

export type EmdStatus = "collected" | "forfeited" | "refunded";
const EMD_TRANSITIONS: Record<EmdStatus, EmdStatus[]> = {
  collected: ["forfeited", "refunded"],
  forfeited: [],
  refunded:  [],
};
export function assertEmdTransition(from: string, to: EmdStatus): void {
  const allowed = EMD_TRANSITIONS[from as EmdStatus] ?? [];
  if (!allowed.includes(to)) {
    throw new DomainError("INVALID_EMD_TRANSITION", `EMD cannot transition from '${from}' to '${to}'`);
  }
}

export type PbgStatus = "active" | "forfeited" | "released";
const PBG_TRANSITIONS: Record<PbgStatus, PbgStatus[]> = {
  active:    ["forfeited", "released"],
  forfeited: [],
  released:  [],
};
export function assertPbgTransition(from: string, to: PbgStatus): void {
  const allowed = PBG_TRANSITIONS[from as PbgStatus] ?? [];
  if (!allowed.includes(to)) {
    throw new DomainError("INVALID_PBG_TRANSITION", `PBG cannot transition from '${from}' to '${to}'`);
  }
}

export function assertPositiveAmount(amount: bigint): void {
  if (amount <= 0n) {
    throw new DomainError("INVALID_AMOUNT", "security amount must be positive (paise)");
  }
}
