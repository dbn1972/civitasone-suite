/**
 * ivr domain logic — pure functions for IVR hit validation and ordering.
 */

/** Maximum number of IVR hits per call. */
export const MAX_IVR_HITS_PER_CALL = 50;

/** Valid DTMF digit pattern: 0-9, *, # */
const DTMF_PATTERN = /^[0-9*#]+$/;

export interface IvrHitInput {
  menuKey: string;
  digit: string;
  timestamp: string;
}

export interface ValidatedIvrHit {
  menuKey: string;
  digit: string;
  timestamp: Date;
}

export class IvrLimitExceededError extends Error {
  constructor(callId: string, currentCount: number) {
    super(`IVR hit limit exceeded for call ${callId}: ${currentCount}/${MAX_IVR_HITS_PER_CALL}`);
    this.name = "IvrLimitExceededError";
  }
}

export class InvalidDtmfError extends Error {
  constructor(digit: string) {
    super(`Invalid DTMF digit: ${digit}. Must match [0-9*#]+`);
    this.name = "InvalidDtmfError";
  }
}

/**
 * Validate an IVR hit input. Returns the validated hit or throws.
 */
export function validateIvrHit(input: IvrHitInput): ValidatedIvrHit {
  if (input.menuKey.length === 0 || input.menuKey.length > 64) {
    throw new Error("menuKey must be between 1 and 64 characters");
  }
  if (input.digit.length === 0 || input.digit.length > 8) {
    throw new Error("digit must be between 1 and 8 characters");
  }
  if (!DTMF_PATTERN.test(input.digit)) {
    throw new InvalidDtmfError(input.digit);
  }
  return {
    menuKey: input.menuKey,
    digit: input.digit,
    timestamp: new Date(input.timestamp),
  };
}

/**
 * Check whether adding more hits would exceed the per-call limit.
 */
export function canAddHits(currentCount: number, newCount: number): boolean {
  return currentCount + newCount <= MAX_IVR_HITS_PER_CALL;
}
