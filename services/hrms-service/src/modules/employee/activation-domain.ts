/**
 * 0180 — Gate employee activation on mandatory-condition check.
 * Validates that all required conditions are met before an employee can
 * transition from probation/draft to active status.
 */

export interface ActivationCandidate {
  id: string;
  fullName: string;
  fitnessStatus: string | null;
  departmentId: string | null;
  designationId: string | null;
  dateOfJoining: string | null;
  bankAccountNo: string | null;
  pan: string | null;
  employeeType: string;
}

export interface MandatoryConditionResult {
  canActivate: boolean;
  failures: Array<{ field: string; reason: string }>;
}

/**
 * Check mandatory conditions for employee activation.
 * An employee cannot be activated (status → "active") unless:
 * 1. fitnessStatus is "fit" or "exempt"
 * 2. departmentId is set
 * 3. designationId is set
 * 4. dateOfJoining is set
 * 5. bankAccountNo is set (for salary disbursement)
 *
 * These are configurable per employee type in production, but the core
 * checks are enforced at the domain level.
 */
export function checkMandatoryConditions(
  candidate: ActivationCandidate,
  requiredDocTypes?: string[],
  uploadedDocTypes?: string[],
): MandatoryConditionResult {
  const failures: Array<{ field: string; reason: string }> = [];

  // 1. Fitness check
  const fitStatus = candidate.fitnessStatus ?? "pending";
  if (fitStatus !== "fit" && fitStatus !== "exempt") {
    failures.push({
      field: "fitnessStatus",
      reason: `medical fitness must be 'fit' or 'exempt', currently '${fitStatus}'`,
    });
  }

  // 2. Department
  if (!candidate.departmentId) {
    failures.push({ field: "departmentId", reason: "department must be assigned" });
  }

  // 3. Designation
  if (!candidate.designationId) {
    failures.push({ field: "designationId", reason: "designation must be assigned" });
  }

  // 4. Date of joining
  if (!candidate.dateOfJoining) {
    failures.push({ field: "dateOfJoining", reason: "date of joining must be set" });
  }

  // 5. Bank account (not required for consultants/apprentices)
  const exemptTypes = new Set(["consultant", "apprentice", "intern"]);
  if (!exemptTypes.has(candidate.employeeType) && !candidate.bankAccountNo) {
    failures.push({ field: "bankAccountNo", reason: "bank account must be set for salary disbursement" });
  }

  // 6. Mandatory documents (if configured)
  if (requiredDocTypes && uploadedDocTypes) {
    const uploaded = new Set(uploadedDocTypes);
    for (const docType of requiredDocTypes) {
      if (!uploaded.has(docType)) {
        failures.push({ field: `document:${docType}`, reason: `mandatory document '${docType}' not uploaded` });
      }
    }
  }

  return { canActivate: failures.length === 0, failures };
}
