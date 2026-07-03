/**
 * @civitasone/feature-flags — deterministic feature flag evaluation.
 *
 * Evaluates whether a flag is active for a given context (tenant + user + segments).
 * Pure logic — no DB or network calls. The flag state is passed in from the caller.
 */
import { z } from "zod";
import { createHash } from "node:crypto";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface FeatureFlag {
  key: string;
  name: string;
  description: string;
  enabled: boolean;
  rolloutPercent: number; // 0–100
  targetSegments: string[];
  killSwitch: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface EvaluationContext {
  tenantId: string;
  userId: string;
  roles: string[];
  segments: string[];
}

export interface EvaluationResult {
  active: boolean;
  reason: "kill_switch" | "disabled" | "rollout_miss" | "rollout_hit" | "segment_match" | "segment_miss";
}

// ─── Zod Schema ──────────────────────────────────────────────────────────────

export const featureFlagSchema = z.object({
  key: z.string().min(1).max(128).regex(/^[a-z0-9_-]+$/),
  name: z.string().min(1).max(200),
  description: z.string().max(1000).default(""),
  enabled: z.boolean(),
  rolloutPercent: z.number().int().min(0).max(100),
  targetSegments: z.array(z.string().min(1).max(100)).default([]),
  killSwitch: z.boolean().default(false),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
});

export const evaluationContextSchema = z.object({
  tenantId: z.string().uuid(),
  userId: z.string().uuid(),
  roles: z.array(z.string()).default([]),
  segments: z.array(z.string()).default([]),
});

// ─── Core Functions ──────────────────────────────────────────────────────────

/**
 * Deterministic hash of userId + flagKey → number in [0, 100).
 * Uses SHA-256 for uniform distribution with no external state.
 */
export function hashUserToPercent(userId: string, flagKey: string): number {
  const hash = createHash("sha256").update(`${userId}:${flagKey}`).digest();
  // Use first 4 bytes as unsigned 32-bit int, mod 100
  const n = hash.readUInt32BE(0);
  return n % 100;
}

/**
 * Evaluate whether a flag is active for the given context.
 *
 * Priority: killSwitch → enabled → segment targeting → rolloutPercent
 */
export function evaluateFlag(flag: FeatureFlag, context: EvaluationContext): EvaluationResult {
  // 1. Kill switch — always off
  if (flag.killSwitch) {
    return { active: false, reason: "kill_switch" };
  }

  // 2. Disabled — always off
  if (!flag.enabled) {
    return { active: false, reason: "disabled" };
  }

  // 3. Segment targeting — if segments are defined, user must match at least one
  if (flag.targetSegments.length > 0) {
    const matched = flag.targetSegments.some((seg) => context.segments.includes(seg));
    if (!matched) {
      return { active: false, reason: "segment_miss" };
    }
    // Segment matched — still apply rollout
  }

  // 4. Percentage rollout — deterministic hash
  if (flag.rolloutPercent >= 100) {
    return { active: true, reason: flag.targetSegments.length > 0 ? "segment_match" : "rollout_hit" };
  }

  if (flag.rolloutPercent <= 0) {
    return { active: false, reason: "rollout_miss" };
  }

  const bucket = hashUserToPercent(context.userId, flag.key);
  const active = bucket < flag.rolloutPercent;
  return { active, reason: active ? "rollout_hit" : "rollout_miss" };
}

/**
 * Simplified boolean evaluation (convenience wrapper).
 */
export function isFeatureEnabled(flag: FeatureFlag, context: EvaluationContext): boolean {
  return evaluateFlag(flag, context).active;
}
