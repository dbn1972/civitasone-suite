import type { ParaStatus } from "./schema.js";

export class DomainError extends Error {
  constructor(public code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = "DomainError";
  }
}

const VALID_TRANSITIONS: Record<ParaStatus, ParaStatus[]> = {
  draft:             ["issued"],
  issued:            ["replied"],
  replied:           ["settled", "pending_recovery"],
  settled:           ["closed"],
  pending_recovery:  ["closed"],
  closed:            [],
};

export function assertCanTransition(from: ParaStatus, to: ParaStatus): void {
  if (!VALID_TRANSITIONS[from]?.includes(to)) {
    throw new DomainError("INVALID_TRANSITION", `cannot transition from '${from}' to '${to}'`);
  }
}

export function assertBodyMutable(status: ParaStatus): void {
  if (status !== "draft") {
    throw new DomainError("BODY_IMMUTABLE", "para body cannot be changed after issue");
  }
}

export function isValidTransition(from: ParaStatus, to: ParaStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}
