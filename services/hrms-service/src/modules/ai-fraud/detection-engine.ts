/**
 * CivitasOne HRMS — AI/ML Fraud Detection Engine
 *
 * Detects: GPS spoofing, buddy punching, ghost employees, payroll anomalies,
 * leave pattern abuse, attrition risk, and generates smart recommendations.
 *
 * Architecture:
 * - Rule-based detectors run on every attendance/leave event (realtime)
 * - Statistical anomaly detection runs as scheduled batch (daily/weekly)
 * - ML risk scoring aggregates signals into per-employee risk profile
 * - Alerts flow to HR admin dashboard for investigation
 */

import { eq, and, sql, gte, lte } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { hrmsGeoAttendance } from "../geo-attendance/schema.js";
import { randomUUID } from "node:crypto";

// ═══ Types ═══
export interface FraudAlert {
  alertType: string;
  severity: "low" | "medium" | "high" | "critical";
  employeeId: string | null;
  description: string;
  evidence: Record<string, unknown>;
  riskScore: number;
  mlModel: string;
}

export interface RiskScore {
  employeeId: string;
  overall: number;
  attendance: number;
  leave: number;
  payroll: number;
  attrition: number;
  factors: string[];
}

// ═══════════════════════════════════════════════════════════
// DETECTOR 1: Attendance Fraud (Realtime — runs on each check-in)
// ═══════════════════════════════════════════════════════════

/** GPS Spoofing Detection: checks if location jump is physically impossible */
export function detectGpsSpoofing(
  currentLat: number, currentLng: number,
  prevLat: number | null, prevLng: number | null,
  timeDiffMinutes: number
): { isSuspicious: boolean; reason: string; score: number } {
  if (prevLat === null || prevLng === null) return { isSuspicious: false, reason: "", score: 0 };

  const distanceKm = haversineKm(currentLat, currentLng, prevLat, prevLng);
  const maxPossibleKmPerMinute = 2; // ~120 km/h max travel speed
  const maxPossibleDistance = maxPossibleKmPerMinute * timeDiffMinutes;

  if (distanceKm > maxPossibleDistance && timeDiffMinutes < 60) {
    return {
      isSuspicious: true,
      reason: `Location jumped ${distanceKm.toFixed(1)}km in ${timeDiffMinutes}min (max possible: ${maxPossibleDistance.toFixed(1)}km)`,
      score: Math.min(1, distanceKm / maxPossibleDistance),
    };
  }

  // Check for exact GPS coordinates (indicates mock location)
  if (currentLat % 0.001 === 0 && currentLng % 0.001 === 0) {
    return { isSuspicious: true, reason: "Suspiciously round GPS coordinates (possible mock location app)", score: 0.7 };
  }

  return { isSuspicious: false, reason: "", score: 0 };
}

/** Buddy Punch Detection: same device used by multiple employees */
export function detectBuddyPunch(
  deviceId: string | null,
  employeeId: string,
  recentCheckIns: Array<{ employeeId: string; deviceId: string | null; markedAt: string }>
): { isSuspicious: boolean; reason: string; score: number } {
  if (!deviceId) return { isSuspicious: false, reason: "", score: 0 };

  const otherEmployeesOnSameDevice = recentCheckIns.filter(
    c => c.deviceId === deviceId && c.employeeId !== employeeId
  );

  if (otherEmployeesOnSameDevice.length > 0) {
    const otherIds = [...new Set(otherEmployeesOnSameDevice.map(c => c.employeeId))];
    return {
      isSuspicious: true,
      reason: `Device ${deviceId.slice(0, 8)}... used by ${otherIds.length + 1} different employees today`,
      score: Math.min(1, otherIds.length * 0.5),
    };
  }

  return { isSuspicious: false, reason: "", score: 0 };
}

/** Impossible Time Detection: check-in at unusual hours */
export function detectImpossibleTime(
  checkInHour: number,
  shiftStartHour: number,
  shiftEndHour: number
): { isSuspicious: boolean; reason: string; score: number } {
  const earlyThreshold = shiftStartHour - 3; // 3 hours before shift
  const lateThreshold = shiftEndHour + 3;    // 3 hours after shift

  if (checkInHour < earlyThreshold || checkInHour > lateThreshold) {
    return {
      isSuspicious: true,
      reason: `Check-in at ${checkInHour}:00 is outside shift window (${shiftStartHour}:00-${shiftEndHour}:00 ±3h)`,
      score: 0.6,
    };
  }

  // Weekend check-in without overtime approval
  return { isSuspicious: false, reason: "", score: 0 };
}

// ═══════════════════════════════════════════════════════════
// DETECTOR 2: Ghost Employee & Payroll Fraud (Batch — daily)
// ═══════════════════════════════════════════════════════════

export interface GhostEmployeeSignal {
  employeeId: string;
  reason: string;
  score: number;
}

/** Ghost Employee: on payroll but never attends */
export function detectGhostEmployee(
  employeeId: string,
  attendanceDaysLast90: number,
  isOnPayroll: boolean,
  status: string
): GhostEmployeeSignal | null {
  if (!isOnPayroll || status !== "confirmed") return null;

  if (attendanceDaysLast90 === 0) {
    return { employeeId, reason: "Zero attendance in last 90 days but on active payroll", score: 0.95 };
  }
  if (attendanceDaysLast90 < 5) {
    return { employeeId, reason: `Only ${attendanceDaysLast90} attendance days in 90 days (expected ~60)`, score: 0.8 };
  }
  return null;
}

/** Duplicate Bank Account: same account across multiple employees */
export function detectDuplicateBankAccount(
  bankAccounts: Array<{ employeeId: string; bankAccountNo: string; bankIfsc: string }>
): FraudAlert[] {
  const accountMap = new Map<string, string[]>();
  for (const emp of bankAccounts) {
    if (!emp.bankAccountNo) continue;
    const key = `${emp.bankAccountNo}|${emp.bankIfsc}`;
    if (!accountMap.has(key)) accountMap.set(key, []);
    accountMap.get(key)!.push(emp.employeeId);
  }

  const alerts: FraudAlert[] = [];
  for (const [account, empIds] of accountMap) {
    if (empIds.length > 1) {
      alerts.push({
        alertType: "duplicate_bank",
        severity: "critical",
        employeeId: empIds[0] ?? null,
        description: `Bank account ${account.split("|")[0]} shared by ${empIds.length} employees`,
        evidence: { employeeIds: empIds, account },
        riskScore: 0.95,
        mlModel: "rule_based_v1",
      });
    }
  }
  return alerts;
}

/** Salary Anomaly: sudden unexplained salary change */
export function detectSalaryAnomaly(
  employeeId: string,
  currentGross: number,
  previousGross: number,
  hasPromotionOrder: boolean
): FraudAlert | null {
  if (previousGross === 0) return null;
  const changePct = Math.abs(currentGross - previousGross) / previousGross;

  if (changePct > 0.25 && !hasPromotionOrder) {
    return {
      alertType: "salary_anomaly",
      severity: changePct > 0.5 ? "critical" : "high",
      employeeId,
      description: `Salary changed by ${(changePct * 100).toFixed(1)}% without promotion/revision order`,
      evidence: { currentGross, previousGross, changePct, hasPromotionOrder },
      riskScore: Math.min(1, changePct),
      mlModel: "statistical_v1",
    };
  }
  return null;
}

// ═══════════════════════════════════════════════════════════
// DETECTOR 3: Leave Pattern Abuse (Batch — weekly)
// ═══════════════════════════════════════════════════════════

export interface LeavePatternResult {
  isSuspicious: boolean;
  pattern: string;
  score: number;
  details: string;
}

/** Monday/Friday pattern: frequent leaves on Mon or Fri to extend weekends */
export function detectMondayFridayPattern(
  leaveRecords: Array<{ fromDate: string; toDate: string }>
): LeavePatternResult {
  let monFriCount = 0;
  let totalLeaves = leaveRecords.length;

  for (const record of leaveRecords) {
    const fromDay = new Date(`${record.fromDate}T00:00:00Z`).getUTCDay();
    const toDay = new Date(`${record.toDate}T00:00:00Z`).getUTCDay();
    if (fromDay === 1 || fromDay === 5 || toDay === 1 || toDay === 5) monFriCount++;
  }

  const ratio = totalLeaves > 0 ? monFriCount / totalLeaves : 0;
  if (ratio > 0.6 && totalLeaves >= 4) {
    return {
      isSuspicious: true,
      pattern: "monday_friday_pattern",
      score: ratio,
      details: `${monFriCount} of ${totalLeaves} leaves (${(ratio * 100).toFixed(0)}%) fall on Monday/Friday — possible long-weekend abuse`,
    };
  }
  return { isSuspicious: false, pattern: "", score: 0, details: "" };
}

/** Sandwich Avoidance: takes leave around holidays to avoid sandwich rule */
export function detectSandwichAvoidance(
  leaveRecords: Array<{ fromDate: string; toDate: string }>,
  holidays: Set<string>
): LeavePatternResult {
  let suspiciousCount = 0;

  for (const record of leaveRecords) {
    const from = new Date(`${record.fromDate}T00:00:00Z`);
    const dayBefore = new Date(from);
    dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);
    const dayBeforeStr = dayBefore.toISOString().slice(0, 10);

    const to = new Date(`${record.toDate}T00:00:00Z`);
    const dayAfter = new Date(to);
    dayAfter.setUTCDate(dayAfter.getUTCDate() + 1);
    const dayAfterStr = dayAfter.toISOString().slice(0, 10);

    // If leave is strategically placed to avoid prefix/suffix holiday
    if (holidays.has(dayBeforeStr) || holidays.has(dayAfterStr)) {
      suspiciousCount++;
    }
  }

  if (suspiciousCount >= 3) {
    return {
      isSuspicious: true,
      pattern: "sandwich_avoidance",
      score: Math.min(1, suspiciousCount * 0.25),
      details: `${suspiciousCount} leaves strategically placed around holidays — possible sandwich rule avoidance`,
    };
  }
  return { isSuspicious: false, pattern: "", score: 0, details: "" };
}

/** Approver Collusion: same approver always approves for specific employee */
export function detectApproverCollusion(
  leaveRecords: Array<{ approvedBy: string | null; employeeId: string }>,
  totalApprovers: number
): LeavePatternResult {
  if (leaveRecords.length < 5 || totalApprovers <= 1) {
    return { isSuspicious: false, pattern: "", score: 0, details: "" };
  }

  const approverCounts = new Map<string, number>();
  for (const r of leaveRecords) {
    if (r.approvedBy) {
      approverCounts.set(r.approvedBy, (approverCounts.get(r.approvedBy) ?? 0) + 1);
    }
  }

  for (const [approver, count] of approverCounts) {
    const ratio = count / leaveRecords.length;
    if (ratio > 0.9 && totalApprovers > 2) {
      return {
        isSuspicious: true,
        pattern: "approver_collusion",
        score: ratio,
        details: `Single approver handles ${(ratio * 100).toFixed(0)}% of this employee's leaves despite ${totalApprovers} available approvers`,
      };
    }
  }
  return { isSuspicious: false, pattern: "", score: 0, details: "" };
}

// ═══════════════════════════════════════════════════════════
// DETECTOR 4: Attrition Risk Prediction
// ═══════════════════════════════════════════════════════════

export interface AttritionSignal {
  signal: string;
  weight: number;
  present: boolean;
}

/** Predicts attrition risk based on behavioral signals */
export function predictAttritionRisk(signals: {
  attendanceDecline: boolean;        // attendance dropped >20% in last 30 days
  leaveExhausted: boolean;           // leave balance at 0
  noTrainingLast12Months: boolean;   // no training/development
  sameRoleOver3Years: boolean;       // role stagnation
  recentPeerDepartures: number;      // colleagues who left recently
  overtimeIncreasing: boolean;       // burnout signal
  appraisalRatingLow: boolean;       // poor performance review
  salaryBelowMarket: boolean;        // underpaid vs market rate
  noPromotionLast5Years: boolean;    // career stagnation
}): RiskScore {
  const factors: AttritionSignal[] = [
    { signal: "Attendance declining", weight: 0.15, present: signals.attendanceDecline },
    { signal: "Leave balance exhausted", weight: 0.05, present: signals.leaveExhausted },
    { signal: "No training in 12 months", weight: 0.10, present: signals.noTrainingLast12Months },
    { signal: "Same role >3 years", weight: 0.12, present: signals.sameRoleOver3Years },
    { signal: "Peer departures (team instability)", weight: 0.08, present: signals.recentPeerDepartures >= 2 },
    { signal: "Overtime increasing (burnout)", weight: 0.12, present: signals.overtimeIncreasing },
    { signal: "Low appraisal rating", weight: 0.15, present: signals.appraisalRatingLow },
    { signal: "Below-market salary", weight: 0.13, present: signals.salaryBelowMarket },
    { signal: "No promotion in 5 years", weight: 0.10, present: signals.noPromotionLast5Years },
  ];

  const totalWeight = factors.filter(f => f.present).reduce((sum, f) => sum + f.weight, 0);
  const activeFactors = factors.filter(f => f.present).map(f => f.signal);

  return {
    employeeId: "",
    overall: Math.min(1, totalWeight),
    attendance: signals.attendanceDecline ? 0.7 : 0.1,
    leave: signals.leaveExhausted ? 0.6 : 0.1,
    payroll: signals.salaryBelowMarket ? 0.5 : 0.1,
    attrition: Math.min(1, totalWeight),
    factors: activeFactors,
  };
}

// ═══════════════════════════════════════════════════════════
// DETECTOR 5: Smart Recommendations Generator
// ═══════════════════════════════════════════════════════════

export interface Recommendation {
  category: "wellness" | "compliance" | "retention" | "performance" | "staffing" | "cost_optimization";
  title: string;
  description: string;
  priority: "low" | "medium" | "high";
  employeeId?: string;
}

export function generateRecommendations(data: {
  employeesWithNoLeave6Months: string[];
  employeesWithHighOvertime: string[];
  departmentsUnderstaffed: string[];
  leaveBalanceExpiring: Array<{ empId: string; days: number }>;
  upcomingProbationEnd: string[];
}): Recommendation[] {
  const recs: Recommendation[] = [];

  for (const empId of data.employeesWithNoLeave6Months) {
    recs.push({
      category: "wellness",
      title: "Employee hasn't taken leave in 6 months",
      description: "Consider encouraging a mandatory wellness break to prevent burnout.",
      priority: "medium",
      employeeId: empId,
    });
  }

  for (const empId of data.employeesWithHighOvertime) {
    recs.push({
      category: "staffing",
      title: "High overtime — possible understaffing",
      description: "Employee is consistently working overtime. Consider workload redistribution or additional hiring.",
      priority: "high",
      employeeId: empId,
    });
  }

  for (const dept of data.departmentsUnderstaffed) {
    recs.push({
      category: "staffing",
      title: `Department ${dept} is understaffed`,
      description: "Vacancy-to-headcount ratio exceeds threshold. Recommend initiating recruitment.",
      priority: "high",
    });
  }

  for (const { empId, days } of data.leaveBalanceExpiring) {
    recs.push({
      category: "compliance",
      title: `${days} leave days expiring at year-end`,
      description: "Employee's CL balance will lapse. Notify to plan leave or apply for encashment.",
      priority: "low",
      employeeId: empId,
    });
  }

  for (const empId of data.upcomingProbationEnd) {
    recs.push({
      category: "performance",
      title: "Probation period ending soon",
      description: "Review performance for confirmation decision. Schedule assessment meeting.",
      priority: "high",
      employeeId: empId,
    });
  }

  return recs;
}

// ═══ Utility ═══
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
