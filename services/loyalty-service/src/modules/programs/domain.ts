/**
 * programs/domain.ts — Pure domain logic for loyalty programs.
 * State machine: draft → active → suspended → archived
 */

export type ProgramStatus = "draft" | "active" | "suspended" | "archived";

/** Allowed status transitions for program lifecycle. */
const TRANSITIONS: Record<ProgramStatus, ProgramStatus[]> = {
  draft: ["active", "archived"],
  active: ["suspended", "archived"],
  suspended: ["active", "archived"],
  archived: [],
};

/**
 * Returns true if the given status transition is valid.
 */
export function isValidTransition(from: ProgramStatus, to: ProgramStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Validate that a program can be edited (only in draft or active state).
 */
export function canEdit(status: ProgramStatus): boolean {
  return status === "draft" || status === "active";
}

export interface ProgramValidationInput {
  name: string;
  earnRatio?: bigint;
  expiryDays?: number | null;
  tierConfig?: Record<string, unknown>;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate program creation/update fields.
 */
export function validateProgram(input: ProgramValidationInput): ValidationResult {
  const errors: string[] = [];

  if (!input.name || input.name.trim().length === 0) {
    errors.push("name is required");
  }
  if (input.name && input.name.length > 200) {
    errors.push("name must not exceed 200 characters");
  }
  if (input.earnRatio !== undefined && input.earnRatio <= BigInt(0)) {
    errors.push("earnRatio must be positive");
  }
  if (input.expiryDays !== undefined && input.expiryDays !== null && input.expiryDays < 1) {
    errors.push("expiryDays must be at least 1 if set");
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate tier configuration thresholds are in ascending order.
 */
export function validateTierThresholds(tiers: Array<{ level: number; minPoints: bigint }>): ValidationResult {
  const errors: string[] = [];
  const sorted = [...tiers].sort((a, b) => a.level - b.level);

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const curr = sorted[i]!;
    if (curr.minPoints <= prev.minPoints) {
      errors.push(`tier level ${curr.level} threshold must be greater than level ${prev.level}`);
    }
  }

  return { valid: errors.length === 0, errors };
}
