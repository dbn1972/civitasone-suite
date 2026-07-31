/**
 * enrolments/domain.ts — Pure domain logic for member enrolments.
 * Status machine: active → suspended → cancelled
 */

export type EnrolmentStatus = "active" | "suspended" | "cancelled";

const TRANSITIONS: Record<EnrolmentStatus, EnrolmentStatus[]> = {
  active: ["suspended", "cancelled"],
  suspended: ["active", "cancelled"],
  cancelled: [],
};

/**
 * Check whether a status transition is valid.
 */
export function isValidTransition(from: EnrolmentStatus, to: EnrolmentStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Validate that the program is in a state that allows new enrolments.
 */
export function canEnrol(programStatus: string): boolean {
  return programStatus === "active";
}

/**
 * Validate enrolment eligibility — checks for duplicate enrolments.
 */
export function validateEnrolment(input: {
  programStatus: string;
  existingEnrolment: boolean;
}): { valid: boolean; error?: string } {
  if (!canEnrol(input.programStatus)) {
    return { valid: false, error: "program is not active" };
  }
  if (input.existingEnrolment) {
    return { valid: false, error: "profile is already enrolled in this program" };
  }
  return { valid: true };
}

/**
 * Determine if an enrolment can accrue points.
 */
export function canAccrue(enrolmentStatus: EnrolmentStatus): boolean {
  return enrolmentStatus === "active";
}

/**
 * Determine if an enrolment can redeem points.
 */
export function canRedeem(enrolmentStatus: EnrolmentStatus): boolean {
  return enrolmentStatus === "active";
}
