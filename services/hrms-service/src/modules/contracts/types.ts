/**
 * Contract Renewal Workflows — shared types.
 */

/** Contract terms stored as JSONB on the contract record. */
export interface ContractTerms {
  role: string;
  compensationMinor: bigint;
  currency: string;
  workingHours: string; // e.g. "9:00-18:00 Mon-Fri"
  deliverables?: string[];
  kpis?: string[];
  specialConditions?: string;
}

/** Contract status lifecycle values. */
export type ContractStatus = "draft" | "active" | "expiring" | "expired" | "renewed" | "terminated" | "escalated";

/** Renewal record status values. */
export type RenewalStatus = "pending_approval" | "approved" | "rejected" | "budget_insufficient" | "cancelled";

/** A single approver decision in the approval chain. */
export interface ApproverDecision {
  approverId: string;
  role: string;
  decision: "approved" | "rejected" | "pending";
  decidedAt: string | null;
  reason?: string;
}

/** Result of diffing contract terms (for audit). */
export interface TermsDiff {
  changedFields: string[];
  original: Partial<ContractTerms>;
  revised: Partial<ContractTerms>;
}

/** Result of the canRenew check. */
export interface RenewalEligibility {
  allowed: boolean;
  totalMonths: number;
  maxMonths: number | null;
  shortfall?: number;
}

/** Result of bulk renewal processing (per contract). */
export interface BulkRenewalResult {
  contractId: string;
  success: boolean;
  renewalId?: string;
  error?: string;
}

/** Contract config (tenant-level settings). */
export interface ContractConfig {
  reminderMilestones: number[]; // e.g. [90, 60, 30, 15, 7]
  approvalChain: Array<{ role: string }>;
  autoSeparationEnabled: boolean;
  schedulerTimeUtc: string; // e.g. "02:00"
}

/** Dashboard expiring contract item. */
export interface ExpiringContractItem {
  contractId: string;
  contractNo: string;
  employeeId: string;
  employeeName: string;
  endDate: string;
  daysRemaining: number;
  renewalStatus: "not_initiated" | "in_progress" | "approved";
}
