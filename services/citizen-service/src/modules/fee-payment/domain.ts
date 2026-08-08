/**
 * SVC-085 — pure fee & exemption computation (no I/O, unit-tested).
 *
 * A fee schedule is a base amount (in paise) plus an ordered list of exemption
 * rules. The FIRST exemption whose predicate matches the subject is applied:
 *   - kind "waive"   → amount becomes 0
 *   - kind "percent" → amount reduced by `value`% (integer math, truncated)
 *   - kind "flat"    → amount reduced by `value` paise (clamped to >= 0)
 * All amounts are in paise (bigint-safe integers). No floating point.
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
  amount?: number | undefined;   // percent (0-100) or flat reduction in paise; ignored for waive
  label?: string | undefined;
}

export interface FeeComputation {
  baseAmount: number;  // paise
  amount: number;      // paise
  exemptionApplied: string | null;   // rule id
  exemptionLabel: string | null;
}

export function computeFee(baseAmount: number, exemptions: ExemptionRule[], subject: Record<string, unknown>): FeeComputation {
  const base = Math.max(0, Math.trunc(baseAmount));
  for (const ex of exemptions) {
    // The exemption predicate reuses the eligibility operator engine so both
    // subsystems share one deterministic matcher.
    if (!evaluateRule({ id: ex.id, attribute: ex.attribute, op: ex.op, value: ex.value, effect: "disqualify" }, subject)) {
      continue;
    }
    let amount = base;
    if (ex.kind === "waive") amount = 0;
    else if (ex.kind === "percent") {
      const pct = Math.min(100, Math.max(0, Math.trunc(ex.amount ?? 0)));
      amount = base - Math.trunc((base * pct) / 100);
    }
    else if (ex.kind === "flat") amount = base - Math.max(0, Math.trunc(ex.amount ?? 0));
    amount = Math.max(0, amount);
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

export const PAYMENT_CONFIRM_MODES = ["gateway", "sandbox"] as const;
export type PaymentConfirmMode = (typeof PAYMENT_CONFIRM_MODES)[number];

/**
 * FN-14 — decide whether an online payment may be confirmed.
 * - gateway mode: requires configured gateway + a non-empty gatewayRef
 * - sandbox mode: labelled Test/Sandbox capture only (never pretends to be live)
 * Pending-only: already-collected payments cannot be confirmed again.
 */
export function assertPaymentConfirmable(input: {
  status: string;
  mode: PaymentConfirmMode;
  gatewayRef?: string | null;
  gatewayConfigured: boolean;
}): void {
  if (input.status !== "pending") {
    throw new Error("PAYMENT_NOT_PENDING");
  }
  if (input.mode === "sandbox") {
    return;
  }
  if (!input.gatewayConfigured) {
    throw new Error("GATEWAY_NOT_CONFIGURED");
  }
  const ref = input.gatewayRef?.trim() ?? "";
  if (ref.length === 0) {
    throw new Error("GATEWAY_REF_REQUIRED");
  }
}

/** A payment is refundable only once it has actually been collected. */
export function isRefundable(status: string): boolean {
  return status === "paid" || status === "offline_recorded";
}
