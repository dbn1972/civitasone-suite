/**
 * PAY-PROFILES: per-employee pay-profile + engagement block for the internal
 * payroll-input feed (and the advisories list, which uses the same shaping so
 * the two can never disagree). Pure over pre-loaded inputs.
 */
import type { ResolvedEngagement } from "../employee/engagement-policy.js";
import type { PayProfileFeedInputs } from "./repo.js";
import {
  buildPayProfileFeed, payProfileAdvisories, resolveProfileForMonth, type PayProfileFeed,
} from "./domain.js";

export interface EngagementFeed {
  category: string;
  payMode: string;
  taxSection: string;
  eligibleForGratuity: boolean;
  eligibleForBonus: boolean;
  leaveEncashment: boolean;
}

export interface EmployeePayFeed {
  payProfile: PayProfileFeed;
  engagement: EngagementFeed;
  advisories: string[];
}

export function buildEmployeePayFeed(
  emp: { id: string; employeeType: string; dateOfJoining: string | null },
  inputs: PayProfileFeedInputs,
  engagement: ResolvedEngagement,
  month: string,
): EmployeePayFeed {
  const resolved = resolveProfileForMonth(inputs.profilesByEmployee.get(emp.id) ?? [], month, emp.dateOfJoining);
  const deputation = resolved.row?.deputationId ? inputs.deputationsById.get(resolved.row.deputationId) ?? null : null;
  const payProfile = buildPayProfileFeed(resolved, deputation);
  const advisories = payProfileAdvisories({
    feed: payProfile,
    payMode: engagement.policy.payMode,
    employeeType: emp.employeeType,
    activeDeputation: inputs.activeDeputationByEmployee.get(emp.id) ?? null,
    month,
  });
  return {
    payProfile,
    engagement: {
      category: engagement.category,
      payMode: engagement.policy.payMode,
      taxSection: engagement.policy.taxSection,
      eligibleForGratuity: engagement.policy.eligibleForGratuity,
      eligibleForBonus: engagement.policy.eligibleForBonus,
      leaveEncashment: engagement.policy.leaveEncashment,
    },
    advisories,
  };
}
