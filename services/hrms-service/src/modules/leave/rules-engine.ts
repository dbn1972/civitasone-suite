/**
 * CivitasOne HRMS — Leave Rules Engine
 * Configurable rules for different employee types (Permanent/Contractual/Deputation)
 * Validates: balance, eligibility, holidays, sandwich, prefix/suffix, max continuous
 */

import { eq, and, gte, lte } from "drizzle-orm";
import { scopedRead } from "../../shared/db.js";
import { hrmsHolidays } from "../holidays/schema.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export type EmployeeType = "permanent" | "temporary" | "contract" | "deputation";

export type LeaveCategory = "CL" | "EL" | "HPL" | "COML" | "ML" | "PL" | "CCL" | "SL" | "SCL" | "CO";

export interface LeavePolicy {
  code: LeaveCategory;
  name: string;
  maxDaysPerYear: number;
  carryForward: boolean;
  maxAccumulation: number;
  encashable: boolean;
  countMethod: "calendar" | "working_days";
  maxContinuousDays: number;
  minServiceYears: number;
  applicableTo: EmployeeType[];
  prefixSuffixRule: boolean;
  sandwichRule: boolean;
}

export interface LeaveValidationInput {
  employeeType: EmployeeType;
  leaveCode: LeaveCategory;
  fromDate: string;       // YYYY-MM-DD
  toDate: string;         // YYYY-MM-DD
  daysApplied: number;
  currentBalance: number;
  totalAccumulated: number;
  serviceStartDate: string;
  tenantId: string;
  isOnProbation: boolean;
  gender?: "male" | "female" | "other";
  childrenCount?: number;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  computedDays: number;   // actual days debited after holiday calculation
  holidaysInRange: string[];
  workingDaysInRange: number;
}

// ─── Leave Policy Master ────────────────────────────────────────────────────

export const LEAVE_POLICIES: LeavePolicy[] = [
  { code: "CL",   name: "Casual Leave",       maxDaysPerYear: 8,   carryForward: false, maxAccumulation: 8,   encashable: false, countMethod: "calendar",     maxContinuousDays: 8,   minServiceYears: 0, applicableTo: ["permanent", "temporary", "contract", "deputation"], prefixSuffixRule: true,  sandwichRule: true },
  { code: "EL",   name: "Earned Leave",        maxDaysPerYear: 30,  carryForward: true,  maxAccumulation: 300, encashable: true,  countMethod: "working_days", maxContinuousDays: 180, minServiceYears: 1, applicableTo: ["permanent", "deputation"],                          prefixSuffixRule: false, sandwichRule: false },
  { code: "HPL",  name: "Half Pay Leave",      maxDaysPerYear: 20,  carryForward: true,  maxAccumulation: 9999,encashable: false, countMethod: "calendar",     maxContinuousDays: 180, minServiceYears: 0, applicableTo: ["permanent", "deputation"],                          prefixSuffixRule: false, sandwichRule: false },
  { code: "COML", name: "Commuted Leave",      maxDaysPerYear: 0,   carryForward: false, maxAccumulation: 0,   encashable: false, countMethod: "calendar",     maxContinuousDays: 180, minServiceYears: 0, applicableTo: ["permanent"],                                        prefixSuffixRule: false, sandwichRule: false },
  { code: "ML",   name: "Maternity Leave",     maxDaysPerYear: 180, carryForward: false, maxAccumulation: 180, encashable: false, countMethod: "calendar",     maxContinuousDays: 180, minServiceYears: 0, applicableTo: ["permanent", "deputation"],                          prefixSuffixRule: false, sandwichRule: false },
  { code: "PL",   name: "Paternity Leave",     maxDaysPerYear: 15,  carryForward: false, maxAccumulation: 15,  encashable: false, countMethod: "calendar",     maxContinuousDays: 15,  minServiceYears: 0, applicableTo: ["permanent", "deputation"],                          prefixSuffixRule: false, sandwichRule: false },
  { code: "CCL",  name: "Child Care Leave",    maxDaysPerYear: 365, carryForward: false, maxAccumulation: 730, encashable: false, countMethod: "calendar",     maxContinuousDays: 365, minServiceYears: 0, applicableTo: ["permanent"],                                        prefixSuffixRule: false, sandwichRule: false },
  { code: "SL",   name: "Study Leave",         maxDaysPerYear: 365, carryForward: false, maxAccumulation: 730, encashable: false, countMethod: "calendar",     maxContinuousDays: 730, minServiceYears: 5, applicableTo: ["permanent"],                                        prefixSuffixRule: false, sandwichRule: false },
  { code: "SCL",  name: "Special Casual Leave",maxDaysPerYear: 10,  carryForward: false, maxAccumulation: 10,  encashable: false, countMethod: "calendar",     maxContinuousDays: 10,  minServiceYears: 0, applicableTo: ["permanent", "deputation"],                          prefixSuffixRule: false, sandwichRule: false },
  { code: "CO",   name: "Compensatory Off",    maxDaysPerYear: 0,   carryForward: false, maxAccumulation: 0,   encashable: false, countMethod: "calendar",     maxContinuousDays: 3,   minServiceYears: 0, applicableTo: ["permanent", "temporary", "contract", "deputation"], prefixSuffixRule: false, sandwichRule: false },
];

// ─── Holiday-aware date calculations ────────────────────────────────────────

export async function getHolidaysInRange(tenantId: string, from: string, to: string): Promise<string[]> {
  const rows = await scopedRead((tx) => tx.select({ date: hrmsHolidays.date }).from(hrmsHolidays)
    .where(and(eq(hrmsHolidays.tenantId, tenantId), gte(hrmsHolidays.date, from), lte(hrmsHolidays.date, to))));
  return rows.map(r => String(r.date));
}

function isWeekend(dateStr: string): boolean {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return d.getUTCDay() === 0 || d.getUTCDay() === 6;
}

function dateRange(from: string, to: string): string[] {
  const dates: string[] = [];
  const cur = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cur <= end) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return dates;
}

export function countWorkingDaysExcludingHolidays(from: string, to: string, holidays: Set<string>): number {
  const dates = dateRange(from, to);
  return dates.filter(d => !isWeekend(d) && !holidays.has(d)).length;
}

export function countCalendarDays(from: string, to: string): number {
  return dateRange(from, to).length;
}

// ─── Prefix/Suffix & Sandwich Rules ────────────────────────────────────────

function getPrefixSuffixHolidays(from: string, to: string, holidays: Set<string>): string[] {
  const extra: string[] = [];
  // Check day before from
  const before = new Date(`${from}T00:00:00Z`);
  before.setUTCDate(before.getUTCDate() - 1);
  const beforeStr = before.toISOString().slice(0, 10);
  if (isWeekend(beforeStr) || holidays.has(beforeStr)) extra.push(beforeStr);
  // Check day after to
  const after = new Date(`${to}T00:00:00Z`);
  after.setUTCDate(after.getUTCDate() + 1);
  const afterStr = after.toISOString().slice(0, 10);
  if (isWeekend(afterStr) || holidays.has(afterStr)) extra.push(afterStr);
  return extra;
}

function getSandwichedHolidays(from: string, to: string, holidays: Set<string>): string[] {
  const dates = dateRange(from, to);
  return dates.filter(d => isWeekend(d) || holidays.has(d));
}

// ─── Main Validation ────────────────────────────────────────────────────────

export async function validateLeaveRequest(input: LeaveValidationInput): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Find applicable policy
  const policy = LEAVE_POLICIES.find(p => p.code === input.leaveCode);
  if (!policy) {
    return { valid: false, errors: [`Unknown leave code: ${input.leaveCode}`], warnings: [], computedDays: 0, holidaysInRange: [], workingDaysInRange: 0 };
  }

  // R1: Eligibility by employee type
  if (!policy.applicableTo.includes(input.employeeType)) {
    errors.push(`${policy.name} (${policy.code}) is not available for ${input.employeeType} employees`);
  }

  // R2: Probation check
  if (input.isOnProbation && input.leaveCode !== "CL") {
    errors.push(`Only Casual Leave (CL) is allowed during probation. ${policy.name} cannot be availed`);
  }

  // R3: Minimum service requirement
  const serviceYears = (new Date().getFullYear() - new Date(input.serviceStartDate).getFullYear());
  if (serviceYears < policy.minServiceYears) {
    errors.push(`${policy.name} requires minimum ${policy.minServiceYears} year(s) of service. Current: ${serviceYears} years`);
  }

  // R4: CCL gender + children check
  if (input.leaveCode === "CCL") {
    if (input.gender !== "female") errors.push("Child Care Leave is available only for women employees");
    if ((input.childrenCount ?? 0) >= 2) errors.push("CCL not available for employees with 2 or more surviving children");
  }

  // R5: Paternity/Maternity gender check
  if (input.leaveCode === "ML" && input.gender === "male") errors.push("Maternity Leave is for women employees only");
  if (input.leaveCode === "PL" && input.gender === "female") errors.push("Paternity Leave is for male employees only");

  // Get holidays from DB for accurate calculation
  const holidaysInRange = await getHolidaysInRange(input.tenantId, input.fromDate, input.toDate);
  const holidaySet = new Set(holidaysInRange);

  // Compute actual days based on count method
  let computedDays: number;
  let workingDaysInRange: number;

  if (policy.countMethod === "working_days") {
    workingDaysInRange = countWorkingDaysExcludingHolidays(input.fromDate, input.toDate, holidaySet);
    computedDays = workingDaysInRange;
  } else {
    workingDaysInRange = countWorkingDaysExcludingHolidays(input.fromDate, input.toDate, holidaySet);
    computedDays = countCalendarDays(input.fromDate, input.toDate);
  }

  // R6: Sandwich rule (CL only)
  if (policy.sandwichRule && computedDays > 1) {
    const sandwiched = getSandwichedHolidays(input.fromDate, input.toDate, holidaySet);
    if (sandwiched.length > 0) {
      computedDays = countCalendarDays(input.fromDate, input.toDate); // all days count
      warnings.push(`Sandwich rule applied: ${sandwiched.length} holiday(s) between leave dates counted as leave`);
    }
  }

  // R7: Prefix/suffix rule (CL only, not for 1-day leave)
  if (policy.prefixSuffixRule && computedDays > 1) {
    const prefSuf = getPrefixSuffixHolidays(input.fromDate, input.toDate, holidaySet);
    if (prefSuf.length > 0) {
      computedDays += prefSuf.length;
      warnings.push(`Prefix/suffix rule: ${prefSuf.length} adjacent holiday(s) added to leave count`);
    }
  }

  // R8: Balance check
  if (computedDays > input.currentBalance) {
    errors.push(`Insufficient balance: requested ${computedDays} days (computed) but only ${input.currentBalance} days available`);
  }

  // R9: Max continuous days — the calendar span (absence from office) must not
  // exceed the policy's maxContinuousDays, regardless of how many are "counted"
  // as leave (working days vs calendar method). CCS defines "continuous" as the
  // full absence period including weekends/holidays in between.
  const calendarSpan = countCalendarDays(input.fromDate, input.toDate);
  if (calendarSpan > policy.maxContinuousDays) {
    errors.push(`Exceeds maximum continuous ${policy.name}: ${calendarSpan} calendar days absent > allowed ${policy.maxContinuousDays} days`);
  }

  // R10: Max accumulation warning
  if (policy.carryForward && input.totalAccumulated > policy.maxAccumulation) {
    warnings.push(`Total accumulated ${policy.code} (${input.totalAccumulated}) exceeds max ${policy.maxAccumulation}. Excess will lapse`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    computedDays,
    holidaysInRange,
    workingDaysInRange,
  };
}
