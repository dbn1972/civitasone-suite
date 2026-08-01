/**
 * intelligence/domain.ts — F.6 pure key-account intelligence computation.
 *
 * The opportunity score answers one question for a key-account manager: how much
 * un-tapped, low-risk upside is there in this account? It rewards white space
 * and penalises risk, so a large account that is actively churning does not rank
 * above a smaller healthy one.
 *
 * Output is a DECIMAL STRING at 4 dp to match numeric(6,4) — never a float on
 * the wire (see predictive/domain.ts for the full rationale).
 */
import type { RiskSignal, WhiteSpaceEntry } from "./schema.js";

export const RISK_SEVERITIES: readonly RiskSignal["severity"][] = ["low", "medium", "high", "critical"];

/**
 * Penalty weight per severity. Critical is deliberately heavy: one critical
 * signal should be enough to pull an account out of the top of the list.
 */
export const RISK_PENALTY = {
  low: 0.05,
  medium: 0.15,
  high: 0.3,
  critical: 0.6,
} as const;

/**
 * White space saturates at this many entries — beyond it, more gaps do not make
 * the account meaningfully more attractive, they just make it noisier.
 */
export const WHITE_SPACE_SATURATION = 8;

export const OPPORTUNITY_SCALE = 4;

export function isRiskSeverity(value: string): value is RiskSignal["severity"] {
  return (RISK_SEVERITIES as readonly string[]).includes(value);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/** Render a 0..1 ratio as a fixed-scale decimal string for numeric(6,4). */
export function toOpportunityString(value: number): string {
  return clamp01(value).toFixed(OPPORTUNITY_SCALE);
}

/**
 * Re-scale an already-validated decimal literal (`0`, `0.5`, `1.0000`) to the
 * numeric(6,4) scale using string padding only — no float round-trip, so a
 * filter threshold means exactly what the caller typed.
 */
export function padOpportunityString(value: string): string {
  const [integer = "0", fraction = ""] = value.trim().split(".");
  return `${integer}.${fraction.slice(0, OPPORTUNITY_SCALE).padEnd(OPPORTUNITY_SCALE, "0")}`;
}

/**
 * Total risk penalty in 0..1. Penalties add up but saturate at 1 so the score
 * never goes negative.
 */
export function riskPenalty(signals: readonly RiskSignal[]): number {
  let total = 0;
  for (const signal of signals) {
    if (!isRiskSeverity(signal.severity)) continue;
    total += RISK_PENALTY[signal.severity];
  }
  return clamp01(total);
}

/** White-space contribution in 0..1, saturating at WHITE_SPACE_SATURATION entries. */
export function whiteSpaceRatio(entries: readonly WhiteSpaceEntry[]): number {
  const usable = entries.filter(
    (e) => typeof e.productId === "string" && e.productId.trim().length > 0,
  ).length;
  return clamp01(usable / WHITE_SPACE_SATURATION);
}

/**
 * Opportunity = white-space upside, discounted by risk.
 * Deterministic: the same inputs always produce the same string.
 */
export function computeOpportunityScore(
  whiteSpace: readonly WhiteSpaceEntry[],
  riskSignals: readonly RiskSignal[],
): string {
  const upside = whiteSpaceRatio(whiteSpace);
  const discount = 1 - riskPenalty(riskSignals);
  return toOpportunityString(upside * discount);
}

export interface IntelligenceInput {
  whiteSpace: readonly WhiteSpaceEntry[];
  riskSignals: readonly RiskSignal[];
}

/** Returns null when valid, otherwise a human message for a 422 response. */
export function validateIntelligenceInput(input: IntelligenceInput): string | null {
  if (!Array.isArray(input.whiteSpace)) return "whiteSpace must be an array";
  if (!Array.isArray(input.riskSignals)) return "riskSignals must be an array";

  for (const entry of input.whiteSpace) {
    if (typeof entry.productId !== "string" || entry.productId.trim().length === 0) {
      return "each whiteSpace entry requires a productId";
    }
  }

  for (const signal of input.riskSignals) {
    if (typeof signal.code !== "string" || signal.code.trim().length === 0) {
      return "each riskSignal requires a code";
    }
    if (!isRiskSeverity(signal.severity)) {
      return `unknown risk severity: ${String(signal.severity)}`;
    }
  }

  return null;
}

/** Highest severity present, or null when there is no risk at all. */
export function worstSeverity(signals: readonly RiskSignal[]): RiskSignal["severity"] | null {
  let worst: RiskSignal["severity"] | null = null;
  let worstIndex = -1;
  for (const signal of signals) {
    const index = RISK_SEVERITIES.indexOf(signal.severity);
    if (index > worstIndex) {
      worstIndex = index;
      worst = signal.severity;
    }
  }
  return worst;
}
