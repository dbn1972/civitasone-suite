/**
 * Pure onboarding state machine + KYC gate (P1-9).
 *
 * initiated → documents_submitted → verification → provisioning → completed
 * with `cancelled` reachable from any live stage.
 *
 * `completed` and `cancelled` are terminal. A customer that has gone live is not
 * re-onboarded, and a cancelled onboarding is superseded by a new case rather than
 * resurrected, so the stage history stays a faithful record of what happened.
 *
 * The KYC gate is deliberately NOT a stage. Keeping `kycStatus` on its own axis means
 * "verification passed" cannot be smuggled in by walking the right stage sequence:
 * completion is refused while KYC is unverified however the case reached
 * `provisioning`.
 */

export const ONBOARDING_STAGES = [
  "initiated",
  "documents_submitted",
  "verification",
  "provisioning",
  "completed",
  "cancelled",
] as const;

export type OnboardingStage = (typeof ONBOARDING_STAGES)[number];

export const KYC_STATUSES = ["pending", "submitted", "verified", "rejected"] as const;

export type KycStatus = (typeof KYC_STATUSES)[number];

/** Stage every case starts in when a won deal opens it. */
export const INITIAL_STAGE: OnboardingStage = "initiated";

/** KYC status every case starts in. */
export const INITIAL_KYC_STATUS: KycStatus = "pending";

/** Minimum characters required in a cancellation reason. */
export const CANCELLATION_REASON_MIN_LENGTH = 10;

const TRANSITIONS: Readonly<Record<OnboardingStage, readonly OnboardingStage[]>> = {
  initiated: ["documents_submitted", "cancelled"],
  documents_submitted: ["verification", "cancelled"],
  verification: ["provisioning", "cancelled"],
  provisioning: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

/**
 * KYC lifecycle. `rejected` loops back to `submitted` so a customer can re-file after
 * a failed check; `verified` is terminal because un-verifying an identity that has
 * already unlocked completion would leave the case in a state the gate forbids.
 */
const KYC_TRANSITIONS: Readonly<Record<KycStatus, readonly KycStatus[]>> = {
  pending: ["submitted"],
  submitted: ["verified", "rejected"],
  rejected: ["submitted"],
  verified: [],
};

export function isOnboardingStage(value: string): value is OnboardingStage {
  return (ONBOARDING_STAGES as readonly string[]).includes(value);
}

export function isKycStatus(value: string): value is KycStatus {
  return (KYC_STATUSES as readonly string[]).includes(value);
}

/** Stages from which no further transition is permitted. */
export function isTerminalStage(stage: OnboardingStage): boolean {
  return TRANSITIONS[stage].length === 0;
}

export function allowedNextStages(stage: OnboardingStage): readonly OnboardingStage[] {
  return TRANSITIONS[stage];
}

/** True when `from → to` is a legal single step in the onboarding sequence. */
export function canTransition(from: OnboardingStage, to: OnboardingStage): boolean {
  return TRANSITIONS[from].includes(to);
}

export function allowedNextKycStatuses(status: KycStatus): readonly KycStatus[] {
  return KYC_TRANSITIONS[status];
}

export function canKycTransition(from: KycStatus, to: KycStatus): boolean {
  return KYC_TRANSITIONS[from].includes(to);
}

/**
 * THE GATE. Stages that may not be entered until KYC has passed.
 *
 * Completion is what hands the customer a live account, so it is the point at which an
 * unverified identity stops being a paperwork problem and becomes a compliance breach.
 */
export function requiresKycVerification(to: OnboardingStage): boolean {
  return to === "completed";
}

export function isKycSatisfied(status: KycStatus): boolean {
  return status === "verified";
}

/**
 * Convenience predicate combining the two halves of the gate. Both the route (before
 * returning 202) and the consumer (before writing) ask this question.
 */
export function isKycGateSatisfied(to: OnboardingStage, status: KycStatus): boolean {
  return !requiresKycVerification(to) || isKycSatisfied(status);
}

/** A cancellation must be explained — an unexplained abandoned onboarding is unauditable. */
export function requiresCancellationReason(to: OnboardingStage): boolean {
  return to === "cancelled";
}

export function isValidCancellationReason(reason: string | undefined | null): boolean {
  return (reason ?? "").trim().length >= CANCELLATION_REASON_MIN_LENGTH;
}
