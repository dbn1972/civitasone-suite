/**
 * ML Breach Prediction — pure domain logic.
 *
 * Feature extraction, breach risk classification, fallback detection,
 * and reassignment candidate selection. No side effects — no DB, no HTTP.
 */

import type { TicketRow } from "../tickets/schema.js";
import type { SlaPolicy } from "../sla/domain.js";
import { resolvePolicy, DEFAULT_SLA_POLICIES } from "../sla/domain.js";

// ── Types ─────────────────────────────────────────────────────────

export interface BreachFeatures {
  category: string;
  priority: number;
  assigneeWorkload: number;
  queueDepth: number;
  timeOfDay: number;
  elapsedPctOfSla: number;
}

export type BreachRiskLevel = "low" | "medium" | "high";

export interface ReassignmentCandidate {
  agentId: string;
  workload: number;
}

export interface BreachRiskResponse {
  probability: number;
  breachRisk: BreachRiskLevel;
  factors: Array<{ feature: string; contribution: number; direction: "positive" | "negative" }>;
  suggestedReassignments: ReassignmentCandidate[];
  isFallback: boolean;
}

// ── Constants ─────────────────────────────────────────────────────

/** Breach risk threshold: probability > 0.70 → high. */
export const BREACH_HIGH_THRESHOLD = 0.70;

/** Fallback threshold: elapsed % of SLA > 0.80 → at risk. */
export const FALLBACK_ELAPSED_THRESHOLD = 0.80;

/** Maximum reassignment candidates to suggest. */
export const MAX_REASSIGNMENT_CANDIDATES = 3;

// ── Feature Extraction ────────────────────────────────────────────

/**
 * Map priority string to numeric value for ML features.
 * critical=4, high=3, medium=2, low=1
 */
export function priorityToNumeric(priority: string): number {
  const p = priority.toLowerCase();
  if (p === "critical") return 4;
  if (p === "high") return 3;
  if (p === "medium") return 2;
  return 1; // low or unknown
}

/**
 * Compute elapsed percentage of SLA resolution window.
 *
 * @param createdAt - ticket creation timestamp
 * @param now - current time
 * @param policies - tenant SLA policies
 * @param priority - ticket priority string
 * @returns value between 0.0 and 1.0+ (can exceed 1.0 if breached)
 */
export function computeElapsedPctOfSla(
  createdAt: Date,
  now: Date,
  policies: SlaPolicy[],
  priority: string,
): number {
  const effectivePolicies = policies.length > 0
    ? policies
    : DEFAULT_SLA_POLICIES.map((p, i) => ({ id: `default-${i}`, tenantId: "", ...p }));

  const policy = resolvePolicy(effectivePolicies, priority, null);
  if (!policy) return 0;

  const totalWindowMs = policy.resolutionMinutes * 60_000;
  if (totalWindowMs <= 0) return 0;

  const elapsedMs = now.getTime() - createdAt.getTime();
  return Math.max(0, elapsedMs / totalWindowMs);
}

/**
 * Extract all ML features from a ticket and context.
 */
export function extractFeatures(
  ticket: TicketRow,
  now: Date,
  assigneeWorkload: number,
  queueDepth: number,
  policies: SlaPolicy[],
): BreachFeatures {
  const createdAt = new Date(ticket.createdAt as unknown as string);
  const category = ticket.ticketType ?? "general";

  return {
    category,
    priority: priorityToNumeric(ticket.priority),
    assigneeWorkload,
    queueDepth,
    timeOfDay: now.getHours(),
    elapsedPctOfSla: computeElapsedPctOfSla(createdAt, now, policies, ticket.priority),
  };
}

// ── Classification ────────────────────────────────────────────────

/**
 * Classify breach risk level based on probability.
 * > 0.70 → high, > 0.40 → medium, else → low
 */
export function classifyBreachRisk(probability: number): BreachRiskLevel {
  if (probability > BREACH_HIGH_THRESHOLD) return "high";
  if (probability > 0.40) return "medium";
  return "low";
}

// ── Fallback Logic ────────────────────────────────────────────────

/**
 * Compute fallback breach probability using time-based detection.
 * When no ML model is available, use elapsed percentage of SLA:
 * - elapsedPct > 0.80 → probability = elapsedPct (capped at 1.0)
 * - else → probability = elapsedPct * 0.5 (low-risk linear scaling)
 */
export function computeFallbackProbability(elapsedPctOfSla: number): number {
  if (elapsedPctOfSla >= FALLBACK_ELAPSED_THRESHOLD) {
    return Math.min(1.0, elapsedPctOfSla);
  }
  return elapsedPctOfSla * 0.5;
}

/**
 * Build a complete fallback breach risk response.
 */
export function buildFallbackResponse(
  features: BreachFeatures,
  candidates: ReassignmentCandidate[],
): BreachRiskResponse {
  const probability = computeFallbackProbability(features.elapsedPctOfSla);
  const risk = classifyBreachRisk(probability);

  return {
    probability: Math.round(probability * 10000) / 10000,
    breachRisk: risk,
    factors: [
      { feature: "elapsedPctOfSla", contribution: features.elapsedPctOfSla, direction: "positive" as const },
    ],
    suggestedReassignments: risk === "high" ? candidates.slice(0, MAX_REASSIGNMENT_CANDIDATES) : [],
    isFallback: true,
  };
}

// ── ML Response Processing ────────────────────────────────────────

/**
 * Build a breach risk response from ML prediction result.
 */
export function buildMlResponse(
  prediction: number,
  factors: Array<{ feature: string; contribution: number; direction: "positive" | "negative" }>,
  candidates: ReassignmentCandidate[],
): BreachRiskResponse {
  const risk = classifyBreachRisk(prediction);

  return {
    probability: Math.round(prediction * 10000) / 10000,
    breachRisk: risk,
    factors: factors.slice(0, 3),
    suggestedReassignments: risk === "high" ? candidates.slice(0, MAX_REASSIGNMENT_CANDIDATES) : [],
    isFallback: false,
  };
}

// ── Reassignment Candidates ───────────────────────────────────────

/**
 * Sort agents by workload ascending and pick top N with lowest workload.
 * Excludes the current assignee.
 */
export function selectReassignmentCandidates(
  agentWorkloads: Array<{ agentId: string; workload: number }>,
  currentAssigneeId: string | null,
): ReassignmentCandidate[] {
  return agentWorkloads
    .filter((a) => a.agentId !== currentAssigneeId)
    .sort((a, b) => a.workload - b.workload)
    .slice(0, MAX_REASSIGNMENT_CANDIDATES)
    .map(({ agentId, workload }) => ({ agentId, workload }));
}
