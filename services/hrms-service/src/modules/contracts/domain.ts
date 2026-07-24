/**
 * Contract Renewal Workflows — Pure Domain Logic.
 *
 * All functions here are pure (no DB, no I/O, no side effects).
 * They implement: status state machine, duration calculations,
 * expiry detection, and terms diffing.
 */

import type { ContractStatus, ContractTerms, TermsDiff, RenewalEligibility } from "./types.js";

// ---------------------------------------------------------------------------
// Domain Error
// ---------------------------------------------------------------------------

export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

// ---------------------------------------------------------------------------
// Task 2.1 — Contract Status State Machine
// ---------------------------------------------------------------------------

export const CONTRACT_STATUSES: readonly ContractStatus[] = [
  "draft",
  "active",
  "expiring",
  "expired",
  "renewed",
  "terminated",
  "escalated",
];

export const CONTRACT_TRANSITIONS: Record<ContractStatus, ContractStatus[]> = {
  draft: ["active"],
  active: ["expiring", "terminated"],
  expiring: ["expired", "renewed"],
  escalated: ["expiring"],
  expired: [],
  renewed: [],
  terminated: [],
};

export function isValidTransition(from: ContractStatus, to: ContractStatus): boolean {
  return CONTRACT_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertValidTransition(from: ContractStatus, to: ContractStatus): void {
  if (!isValidTransition(from, to)) {
    throw new DomainError(
      "INVALID_TRANSITION",
      `Cannot transition contract from '${from}' to '${to}'. Allowed: ${CONTRACT_TRANSITIONS[from]?.join(", ") || "none"}`,
      { from, to, allowed: CONTRACT_TRANSITIONS[from] },
    );
  }
}

// ---------------------------------------------------------------------------
// Task 2.2 — Duration and Renewal Logic
// ---------------------------------------------------------------------------

export function calculateDurationMonths(startDate: string, endDate: string): number {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const months =
    (end.getFullYear() - start.getFullYear()) * 12 +
    (end.getMonth() - start.getMonth());
  // Subtract partial month if end day < start day
  return end.getDate() >= start.getDate() ? months : months - 1;
}

export function totalContractDurationMonths(
  contracts: Array<{ startDate: string; endDate: string }>,
): number {
  return contracts.reduce(
    (sum, c) => sum + Math.max(0, calculateDurationMonths(c.startDate, c.endDate)),
    0,
  );
}

export function canRenew(
  existingContracts: Array<{ startDate: string; endDate: string }>,
  newEndDate: string,
  maxContractMonths: number | null,
): RenewalEligibility {
  if (maxContractMonths === null) {
    return { allowed: true, totalMonths: 0, maxMonths: null };
  }

  const existing = totalContractDurationMonths(existingContracts);

  // Calculate the additional months from the last contract's end to newEndDate
  const lastEnd =
    existingContracts.length > 0
      ? existingContracts[existingContracts.length - 1]!.endDate
      : new Date().toISOString().slice(0, 10);
  const additional = Math.max(0, calculateDurationMonths(lastEnd, newEndDate));
  const total = existing + additional;

  if (total > maxContractMonths) {
    return {
      allowed: false,
      totalMonths: total,
      maxMonths: maxContractMonths,
      shortfall: total - maxContractMonths,
    };
  }

  return { allowed: true, totalMonths: total, maxMonths: maxContractMonths };
}

// ---------------------------------------------------------------------------
// Task 2.3 — Expiry Detection and Notification Helpers
// ---------------------------------------------------------------------------

export function daysUntilExpiry(endDate: string, asOf: string): number {
  const end = new Date(endDate);
  const now = new Date(asOf);
  const diffMs = end.getTime() - now.getTime();
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

export function detectMilestones(
  endDate: string,
  asOf: string,
  milestones: number[],
): number[] {
  const days = daysUntilExpiry(endDate, asOf);
  return milestones
    .filter((m) => days <= m && days > 0)
    .sort((a, b) => b - a);
}

// ---------------------------------------------------------------------------
// Task 2.4 — Terms Diff Utility
// ---------------------------------------------------------------------------

export function diffTerms(original: ContractTerms, revised: ContractTerms): TermsDiff {
  const changedFields: string[] = [];
  const origPartial: Partial<ContractTerms> = {};
  const revPartial: Partial<ContractTerms> = {};

  const keys: (keyof ContractTerms)[] = [
    "role",
    "compensationMinor",
    "currency",
    "workingHours",
    "deliverables",
    "kpis",
    "specialConditions",
  ];

  for (const key of keys) {
    const o = original[key];
    const r = revised[key];
    if (JSON.stringify(o) !== JSON.stringify(r)) {
      changedFields.push(key);
      (origPartial as Record<string, unknown>)[key] = o;
      (revPartial as Record<string, unknown>)[key] = r;
    }
  }

  return { changedFields, original: origPartial, revised: revPartial };
}
