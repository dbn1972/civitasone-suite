/**
 * SVC-085 — pure fee & exemption computation (no I/O, unit-tested).
 *
 * A fee schedule is a base amount plus an ordered list of exemption rules. The
 * FIRST exemption whose predicate matches the subject is applied:
 *   - kind "waive"   → amount becomes 0
 *   - kind "percent" → amount reduced by `value`% (clamped to [0, base])
 *   - kind "flat"    → amount reduced by `value` (clamped to >= 0)
 * Amounts are handled in whole minor-unit-free decimals rounded to 2 dp.
 */

import { evaluateRule, type EligibilityOp } from "../eligibility/domain.js";

export const EXEMPTION_KINDS = ["waive", "percent", "flat"] as const;
export type ExemptionKind = typeof EXEMPTION_KINDS[number];

export interface ExemptionRule {
  id: string;
  attribute: string;
  op: EligibilityOp;
  value?: unknown;   // predicate operand
  kind: ExemptionKind;
  amount?: number | undefined;   // percent (0-100) or flat reduction; ignored for waive
  label?: string | undefined;
}

export interface FeeComputation {
  baseAmount: number;
  amount: number;
  exemptionApplied: string | null;   // rule id
  exemptionLabel: string | null;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function computeFee(baseAmount: number, exemptions: ExemptionRule[], subject: Record<string, unknown>): FeeComputation {
  const base = round2(Math.max(0, baseAmount));
  for (const ex of exemptions) {
    // The exemption predicate reuses the eligibility operator engine so both
    // subsystems share one deterministic matcher.
    if (!evaluateRule({ id: ex.id, attribute: ex.attribute, op: ex.op, value: ex.value, effect: "disqualify" }, subject)) {
      continue;
    }
    let amount = base;
    if (ex.kind === "waive") amount = 0;
    else if (ex.kind === "percent") amount = base - (base * Math.min(100, Math.max(0, ex.amount ?? 0))) / 100;
    else if (ex.kind === "flat") amount = base - Math.max(0, ex.amount ?? 0);
    amount = round2(Math.max(0, amount));
    return { baseAmount: base, amount, exemptionApplied: ex.id, exemptionLabel: ex.label ?? ex.id };
  }
  return { baseAmount: base, amount: base, exemptionApplied: null, exemptionLabel: null };
}

/** Unique, human-readable receipt number. Prefix RCT-{YYYY}-{seq zero-padded}. */
export function buildReceiptNo(year: number, seq: number): string {
  return `RCT-${year}-${String(seq).padStart(8, "0")}`;
}

/**
 * SVC-085 honesty gate: a real gateway capture only happens when creds are
 * configured. With none, the online path MUST remain a labelled pending state
 * (never a fake success). Returns true ONLY when a usable key is present.
 */
export function isGatewayConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  const key = env.PAYMENT_GATEWAY_KEY ?? env.CITIZEN_PAYMENT_GATEWAY_KEY;
  return typeof key === "string" && key.trim().length > 0;
}

/** A payment is refundable only once it has actually been collected. */
export function isRefundable(status: string): boolean {
  return status === "paid" || status === "offline_recorded";
}
