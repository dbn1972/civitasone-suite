import { DomainError } from "./domain.js";

export interface Appropriation {
  allocatedMinor: bigint;
  committedMinor: bigint;
  actualMinor: bigint;
}

/** Available appropriation = allocated - (committed + actual). */
export function appropriationAvailable(a: Pick<Appropriation, "allocatedMinor" | "committedMinor" | "actualMinor">): bigint {
  return a.allocatedMinor - (a.committedMinor + a.actualMinor);
}

/**
 * Block over-appropriation: cumulative committed+actual+requested must not
 * exceed allocation. Always enforced — see the `enforce` flag removal note in
 * allocation-routes.ts (a soft/non-blocking ceiling was never actually
 * achievable once chk_allocation_no_overcommit was added at the DB level).
 */
export function assertWithinAppropriation(a: Appropriation, requestedMinor: bigint): void {
  const available = appropriationAvailable(a);
  if (requestedMinor > available) {
    throw new DomainError(
      "OVER_APPROPRIATION",
      `requested ${requestedMinor} paise exceeds available appropriation ${available} paise (allocated=${a.allocatedMinor}, committed=${a.committedMinor}, actual=${a.actualMinor})`,
    );
  }
}

/** A re-appropriation must move a positive amount and not exceed the source's available balance. */
export function assertReappropriable(
  from: Pick<Appropriation, "allocatedMinor" | "committedMinor" | "actualMinor">,
  amountMinor: bigint,
): void {
  if (amountMinor <= 0n) {
    throw new DomainError("INVALID_AMOUNT", "re-appropriation amount must be positive");
  }
  const available = appropriationAvailable(from);
  if (amountMinor > available) {
    throw new DomainError(
      "REAPPROPRIATION_EXCEEDS_BALANCE",
      `re-appropriation ${amountMinor} paise exceeds source available ${available} paise`,
    );
  }
}
