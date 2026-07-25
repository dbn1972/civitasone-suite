/**
 * CAP-094 — pure feature-flag evaluation domain.
 *
 * Deterministic, side-effect-free evaluation used for safe progressive rollout:
 *   kill switch  → always OFF (highest precedence)
 *   expired      → always OFF
 *   disabled     → OFF
 *   segment hit  → ON (targeted tenants/roles/segments bypass the percentage)
 *   percentage   → stable per-subject bucket < rolloutPercent → ON
 *
 * The percentage bucket is a stable hash of (flagKey + subjectId) into [0,100),
 * so a given subject's inclusion is consistent across evaluations and only grows
 * monotonically as rolloutPercent is raised — never flapping.
 */
import { createHash } from "node:crypto";

export interface FlagState {
  key: string;
  enabled: boolean;
  rolloutPercent: number;
  targetSegments: string[];
  killSwitch: boolean;
  expiresAt?: Date | string | null;
}

export interface EvalSubject {
  /** Stable identifier for bucketing (e.g. tenantId or userId). */
  subjectId: string;
  /** Segments the subject belongs to (roles, tenant ids, cohort labels). */
  segments?: string[];
}

export type FlagReason =
  | "kill_switch"
  | "expired"
  | "disabled"
  | "segment_match"
  | "percentage_in"
  | "percentage_out";

export interface FlagDecision {
  enabled: boolean;
  reason: FlagReason;
  bucket: number;
}

/** Stable bucket in [0,100) for a (flagKey, subjectId) pair. */
export function bucketOf(flagKey: string, subjectId: string): number {
  const h = createHash("sha256").update(`${flagKey}:${subjectId}`).digest();
  // First 4 bytes → unsigned int → mod 100.
  const n = h.readUInt32BE(0);
  return n % 100;
}

/** True when the flag's expiry has passed. */
export function isExpired(expiresAt: Date | string | null | undefined, now = new Date()): boolean {
  if (expiresAt === null || expiresAt === undefined) return false;
  const t = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
  if (Number.isNaN(t.getTime())) return false;
  return now.getTime() >= t.getTime();
}

/** Evaluate a flag for a subject. Deterministic and total. */
export function evaluateFlag(flag: FlagState, subject: EvalSubject, now = new Date()): FlagDecision {
  const bucket = bucketOf(flag.key, subject.subjectId);
  if (flag.killSwitch) return { enabled: false, reason: "kill_switch", bucket };
  if (isExpired(flag.expiresAt, now)) return { enabled: false, reason: "expired", bucket };
  if (!flag.enabled) return { enabled: false, reason: "disabled", bucket };

  const subjectSegments = subject.segments ?? [];
  if (flag.targetSegments.length > 0 && subjectSegments.some((s) => flag.targetSegments.includes(s))) {
    return { enabled: true, reason: "segment_match", bucket };
  }

  const pct = Math.max(0, Math.min(100, flag.rolloutPercent));
  if (pct >= 100) return { enabled: true, reason: "percentage_in", bucket };
  if (pct <= 0) return { enabled: false, reason: "percentage_out", bucket };
  return bucket < pct
    ? { enabled: true, reason: "percentage_in", bucket }
    : { enabled: false, reason: "percentage_out", bucket };
}
