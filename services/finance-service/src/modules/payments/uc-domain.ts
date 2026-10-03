/** Pure rules for utilisation certificates (UC). */
import { DomainError } from "./domain.js";

/** A UC in these states counts against the sanctioned grant; a returned (rejected) one does not. */
export const UC_CLAIMING_STATUSES = ["pending", "submitted", "verified"] as const;

/**
 * GAP-FINANCE-EXPENDITURE-UTILIZATION-CERTIFICATES-NEW-02: a certificate cannot
 * certify more than the sanctioned grant still leaves. `claimedMinor` is the sum
 * of the OTHER claiming UCs already recorded against the same grant reference.
 */
export function assertUCWithinSanction(sanctionedMinor: bigint, claimedMinor: bigint, newMinor: bigint): void {
  if (newMinor <= 0n) throw new DomainError("UC_AMOUNT_INVALID", "utilised amount must be greater than zero");
  if (claimedMinor + newMinor > sanctionedMinor) {
    throw new DomainError(
      "UC_OVERCLAIM",
      `utilised amount ${newMinor} exceeds the sanctioned amount still unclaimed (sanctioned ${sanctionedMinor}, already certified ${claimedMinor})`,
    );
  }
}

export function assertUCPeriodValid(periodFrom: string | undefined, periodTo: string | undefined): void {
  if (periodFrom && periodTo && periodFrom > periodTo) {
    throw new DomainError("UC_PERIOD_INVALID", "the period start must not be after the period end");
  }
}

/** Verification and return both act only on a submitted certificate. */
export function assertUCDecidable(status: string): void {
  if (status !== "submitted") {
    throw new DomainError("UC_NOT_SUBMITTED", `only a submitted certificate can be verified or returned (this one is ${status})`);
  }
}

export function assertUCResubmittable(status: string): void {
  if (status !== "rejected") {
    throw new DomainError("UC_NOT_REJECTED", `only a returned certificate can be resubmitted (this one is ${status})`);
  }
}
