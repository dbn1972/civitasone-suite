/**
 * Churn/Revenue Forecasting — Domain Logic
 *
 * - Risk level classification: high > 0.70, medium 0.40–0.70, low < 0.40
 * - Feature extraction for subscription churn scoring
 * - Revenue forecast with cohort analysis and retention curves
 * - Linear extrapolation fallback when no ML model is available
 *
 * No side effects — pure functions.
 */

import type { ExplainabilityFactor } from "./adapter.js";

// ── Types ─────────────────────────────────────────────────────────

export type RiskLevel = "high" | "medium" | "low";

export interface ChurnRiskResult {
  probability: number;
  factors: ExplainabilityFactor[];
  riskLevel: RiskLevel;
}

export interface SubscriptionFeatures {
  paymentDelayAvgDays: number;
  supportTicketCount90d: number;
  daysSinceLastLogin: number;
  usageScore: number;
  tenureDays: number;
}

export interface MrrDataPoint {
  month: string; // ISO date (YYYY-MM-01)
  mrr: number;   // amount in paise
}

export interface CashFlowProjection {
  month: string;
  projectedMrr: number;
  churnLoss: number;
  expansionGain: number;
  netMrr: number;
}

export interface RevenueForecastResult {
  currentMrr: number;
  projectedMrr: number;
  churnImpact: number;
  expansionImpact: number;
  cashFlowProjection: CashFlowProjection[];
}

export interface CohortEntry {
  cohortMonth: string;
  startCount: number;
  retentionCurve: number[]; // percentage retained per period
}

// ── Risk Classification ───────────────────────────────────────────

/**
 * Classify churn probability into risk levels.
 * - high: probability > 0.70
 * - medium: 0.40 ≤ probability ≤ 0.70
 * - low: probability < 0.40
 */
export function classifyRiskLevel(probability: number): RiskLevel {
  if (probability > 0.70) return "high";
  if (probability >= 0.40) return "medium";
  return "low";
}

// ── Feature Extraction ────────────────────────────────────────────

export interface SubscriptionContext {
  lastLoginAt: Date | null;
  avgPaymentDelayDays: number;
  supportTicketCount90d: number;
  usageScore: number;
  subscriptionStartDate: Date;
}

/**
 * Extract numeric features from subscription context for ML scoring.
 */
export function extractFeatures(ctx: SubscriptionContext): SubscriptionFeatures {
  const now = new Date();
  const daysSinceLastLogin = ctx.lastLoginAt
    ? Math.max(0, Math.floor((now.getTime() - ctx.lastLoginAt.getTime()) / (1000 * 60 * 60 * 24)))
    : 365; // max penalty if never logged in

  const tenureDays = Math.max(0, Math.floor((now.getTime() - ctx.subscriptionStartDate.getTime()) / (1000 * 60 * 60 * 24)));

  return {
    paymentDelayAvgDays: Math.max(0, ctx.avgPaymentDelayDays),
    supportTicketCount90d: Math.max(0, ctx.supportTicketCount90d),
    daysSinceLastLogin,
    usageScore: Math.max(0, Math.min(100, ctx.usageScore)),
    tenureDays,
  };
}

// ── Fallback: Rule-Based Churn Score ──────────────────────────────

/**
 * Simple rule-based churn probability when no ML model is available.
 * Uses weighted heuristics on feature values.
 */
export function fallbackChurnScore(features: SubscriptionFeatures): ChurnRiskResult {
  // Weighted scoring heuristic
  let score = 0;
  const factors: ExplainabilityFactor[] = [];

  // Payment delays increase churn risk
  const paymentFactor = Math.min(features.paymentDelayAvgDays / 30, 1.0) * 0.30;
  score += paymentFactor;
  if (paymentFactor > 0.05) {
    factors.push({ feature: "paymentDelayAvgDays", contribution: paymentFactor, direction: "positive" });
  }

  // High support tickets signal dissatisfaction
  const ticketFactor = Math.min(features.supportTicketCount90d / 10, 1.0) * 0.20;
  score += ticketFactor;
  if (ticketFactor > 0.05) {
    factors.push({ feature: "supportTicketCount90d", contribution: ticketFactor, direction: "positive" });
  }

  // Days since login (disengagement)
  const loginFactor = Math.min(features.daysSinceLastLogin / 60, 1.0) * 0.25;
  score += loginFactor;
  if (loginFactor > 0.05) {
    factors.push({ feature: "daysSinceLastLogin", contribution: loginFactor, direction: "positive" });
  }

  // Low usage score
  const usageFactor = Math.max(0, (100 - features.usageScore) / 100) * 0.15;
  score += usageFactor;
  if (usageFactor > 0.05) {
    factors.push({ feature: "usageScore", contribution: usageFactor, direction: "negative" });
  }

  // Short tenure increases risk
  const tenureFactor = features.tenureDays < 90 ? 0.10 : 0;
  score += tenureFactor;
  if (tenureFactor > 0) {
    factors.push({ feature: "tenureDays", contribution: tenureFactor, direction: "positive" });
  }

  const probability = Math.min(1.0, Math.max(0.0, score));

  // Keep top 3 factors
  factors.sort((a, b) => b.contribution - a.contribution);
  const topFactors = factors.slice(0, 3);

  return {
    probability,
    factors: topFactors,
    riskLevel: classifyRiskLevel(probability),
  };
}

// ── Revenue Forecast ──────────────────────────────────────────────

/**
 * Compute revenue forecast using linear extrapolation of recent MRR data.
 * This is the fallback when no ML model is available.
 *
 * Uses 6-month trend line (least-squares) to project forward.
 */
export function computeRevenueForecast(
  mrrHistory: MrrDataPoint[],
  horizonMonths: number,
  churnRateMonthly: number,
  expansionRateMonthly: number,
): RevenueForecastResult {
  if (mrrHistory.length === 0) {
    return {
      currentMrr: 0,
      projectedMrr: 0,
      churnImpact: 0,
      expansionImpact: 0,
      cashFlowProjection: [],
    };
  }

  // Use up to the last 6 months
  const recent = mrrHistory.slice(-6);
  const currentMrr = recent[recent.length - 1]!.mrr;

  // Linear regression: y = mx + b
  const { slope } = linearRegression(recent.map((d, i) => ({ x: i, y: d.mrr })));

  const cashFlowProjection: CashFlowProjection[] = [];
  let runningMrr = currentMrr;
  let totalChurnImpact = 0;
  let totalExpansionImpact = 0;

  for (let m = 1; m <= horizonMonths; m++) {
    const churnLoss = Math.round(runningMrr * churnRateMonthly);
    const expansionGain = Math.round(runningMrr * expansionRateMonthly);
    const trendAdjustment = Math.round(slope);

    const netMrr = runningMrr - churnLoss + expansionGain + trendAdjustment;
    totalChurnImpact += churnLoss;
    totalExpansionImpact += expansionGain;

    const monthDate = addMonths(new Date(recent[recent.length - 1]!.month), m);
    cashFlowProjection.push({
      month: formatMonth(monthDate),
      projectedMrr: Math.max(0, netMrr),
      churnLoss,
      expansionGain,
      netMrr: Math.max(0, netMrr),
    });

    runningMrr = Math.max(0, netMrr);
  }

  const projectedMrr = cashFlowProjection.length > 0
    ? cashFlowProjection[cashFlowProjection.length - 1]!.netMrr
    : currentMrr;

  return {
    currentMrr,
    projectedMrr,
    churnImpact: totalChurnImpact,
    expansionImpact: totalExpansionImpact,
    cashFlowProjection,
  };
}

// ── Cohort Analysis ───────────────────────────────────────────────

export interface SubscriptionCohortInput {
  startMonth: string; // YYYY-MM
  subscriptionId: string;
  isActive: boolean;
  monthsActive: number;
}

/**
 * Compute retention curves by cohort (month of subscription start).
 */
export function computeCohortAnalysis(subscriptions: SubscriptionCohortInput[]): CohortEntry[] {
  // Group by start month
  const cohorts = new Map<string, SubscriptionCohortInput[]>();
  for (const sub of subscriptions) {
    const existing = cohorts.get(sub.startMonth) ?? [];
    existing.push(sub);
    cohorts.set(sub.startMonth, existing);
  }

  const results: CohortEntry[] = [];
  for (const [month, subs] of cohorts.entries()) {
    const startCount = subs.length;
    if (startCount === 0) continue;

    // Compute retention curve: for each period (month 1, 2, 3...), what % is still active
    const maxPeriods = Math.max(...subs.map(s => s.monthsActive), 0);
    const retentionCurve: number[] = [];
    for (let period = 1; period <= Math.min(maxPeriods, 12); period++) {
      const retained = subs.filter(s => s.monthsActive >= period).length;
      retentionCurve.push(Math.round((retained / startCount) * 100));
    }

    results.push({ cohortMonth: month, startCount, retentionCurve });
  }

  return results.sort((a, b) => a.cohortMonth.localeCompare(b.cohortMonth));
}

// ── Helpers ───────────────────────────────────────────────────────

function linearRegression(points: Array<{ x: number; y: number }>): { slope: number; intercept: number } {
  const n = points.length;
  if (n <= 1) return { slope: 0, intercept: points[0]?.y ?? 0 };

  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  for (const p of points) {
    sumX += p.x;
    sumY += p.y;
    sumXY += p.x * p.y;
    sumXX += p.x * p.x;
  }

  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return { slope: 0, intercept: sumY / n };

  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

function formatMonth(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}
