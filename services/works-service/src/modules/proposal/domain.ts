/**
 * Proposal domain logic — pure functions for work number generation,
 * category resolution, COA validation, DAO finalization, and split rules.
 */

export interface WorkProposal {
  id: string;
  status: string;
  description: string;
  workTypeId: string;
  estimatedCostMinor: bigint;
  executingDivisionId?: string | null;
}

export interface CoaMapping {
  majorHead: string;
  subMajorHead?: string | null;
  minorHead?: string | null;
  subHead?: string | null;
  detailHead?: string | null;
  objectHead?: string | null;
}

export interface WorkSplit {
  id: string;
  status: string;
}

export interface OfficeMapping {
  workId: string;
  divisionId: string;
  isNodal: boolean;
}

/**
 * Generate a unique work number in format: DIV/YEAR/SEQ
 * e.g., "PWD-PUN/2024/0001"
 */
export function generateWorkNumber(division: string, year: number, sequence: number): string {
  const paddedSeq = String(sequence).padStart(4, "0");
  return `${division}/${year}/${paddedSeq}`;
}

/**
 * Resolve category string to valid enum value.
 */
export function resolveCategory(category: string): "regular" | "deposit" | "salary" {
  const normalized = category.toLowerCase().trim();
  if (normalized === "regular") return "regular";
  if (normalized === "deposit") return "deposit";
  if (normalized === "salary") return "salary";
  throw new Error(`Invalid category: ${category}. Must be one of: regular, deposit, salary`);
}

/**
 * Check if DAO finalization is allowed.
 * Proposal must be in 'draft' status and have required fields populated.
 */
export function canDaoFinalize(proposal: WorkProposal): { allowed: boolean; reason?: string } {
  if (proposal.status !== "draft") {
    return { allowed: false, reason: `Cannot finalize: current status is '${proposal.status}', must be 'draft'` };
  }
  if (!proposal.description || proposal.description.trim().length === 0) {
    return { allowed: false, reason: "Cannot finalize: description is required" };
  }
  if (!proposal.workTypeId) {
    return { allowed: false, reason: "Cannot finalize: work type is required" };
  }
  if (proposal.estimatedCostMinor <= 0n) {
    return { allowed: false, reason: "Cannot finalize: estimated cost must be greater than zero" };
  }
  return { allowed: true };
}

/**
 * Validate COA mapping — majorHead is mandatory, other heads have format constraints.
 */
export function validateCoa(coa: CoaMapping): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!coa.majorHead || coa.majorHead.trim().length === 0) {
    errors.push("majorHead is required");
  }
  if (coa.majorHead && !/^\d{4}$/.test(coa.majorHead)) {
    errors.push("majorHead must be a 4-digit code");
  }
  if (coa.subMajorHead && !/^\d{2}$/.test(coa.subMajorHead)) {
    errors.push("subMajorHead must be a 2-digit code");
  }
  if (coa.minorHead && !/^\d{3}$/.test(coa.minorHead)) {
    errors.push("minorHead must be a 3-digit code");
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Check if a split can be deleted.
 * Cannot delete if there are dependent records (e.g., office mappings, tenders).
 */
export function canDeleteSplit(split: WorkSplit, hasDependents: boolean): boolean {
  if (split.status === "closed") return false;
  if (hasDependents) return false;
  return true;
}

/**
 * Check if an office mapping is the nodal office.
 */
export function isNodalOffice(mapping: OfficeMapping): boolean {
  return mapping.isNodal;
}
