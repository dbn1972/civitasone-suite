/**
 * Pure escalation maths for unaccepted / unattended leads (AS-004).
 *
 * Kept free of I/O so the "which leads are overdue and by how long" decision can
 * be unit-tested exhaustively, and so the worker scheduler and any future manual
 * "escalate now" path share exactly the same arithmetic.
 *
 * Two triggers:
 *  - `unaccepted`: a lead was assigned (assigned_at) but never accepted
 *    (accepted_at IS NULL) and the wait has exceeded threshold_minutes.
 *  - `unattended`: a lead has had no activity (last_activity_at, falling back to
 *    assigned_at) for longer than threshold_minutes.
 */

export type EscalationTrigger = "unaccepted" | "unattended";

export interface EscalationRuleLike {
  id: string;
  trigger: EscalationTrigger;
  thresholdMinutes: number;
  reassign: boolean;
  enabled: boolean;
  recipientRole?: string | null;
  recipientId?: string | null;
}

/** The lead facts the overdue check needs; deliberately narrower than the row. */
export interface LeadTimingLike {
  leadId: string;
  ownerId: string | null;
  assignedAt: Date | string | null;
  acceptedAt: Date | string | null;
  lastActivityAt: Date | string | null;
}

export interface OverdueLead {
  leadId: string;
  ownerId: string | null;
  ruleId: string;
  trigger: EscalationTrigger;
  /** Minutes the lead has been overdue past the configured threshold. */
  overdueMinutes: number;
  /** Total ageing in minutes since the reference time (assigned / last activity). */
  ageingMinutes: number;
  recipientRole: string | null;
  recipientId: string | null;
  reassign: boolean;
}

const MIN_MS = 60_000;

function toDate(v: Date | string | null | undefined): Date | null {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function minutesBetween(from: Date, now: Date): number {
  return Math.floor((now.getTime() - from.getTime()) / MIN_MS);
}

/**
 * Evaluate one lead against one rule. Returns the overdue descriptor, or null if
 * the lead is not (yet) overdue for that rule.
 *
 * `unaccepted` ignores leads that were already accepted. `unattended` measures
 * from last_activity_at, or assigned_at when the lead has never had an activity.
 */
export function evaluateLead(
  lead: LeadTimingLike,
  rule: EscalationRuleLike,
  now: Date,
): OverdueLead | null {
  if (!rule.enabled) return null;
  if (!Number.isFinite(rule.thresholdMinutes) || rule.thresholdMinutes <= 0) return null;

  const assignedAt = toDate(lead.assignedAt);
  if (!assignedAt) return null; // never assigned ⇒ nothing to escalate

  let reference: Date | null;
  if (rule.trigger === "unaccepted") {
    if (toDate(lead.acceptedAt)) return null; // already accepted
    reference = assignedAt;
  } else {
    reference = toDate(lead.lastActivityAt) ?? assignedAt;
  }
  if (!reference) return null;

  const ageingMinutes = minutesBetween(reference, now);
  if (ageingMinutes < rule.thresholdMinutes) return null;

  return {
    leadId: lead.leadId,
    ownerId: lead.ownerId,
    ruleId: rule.id,
    trigger: rule.trigger,
    ageingMinutes,
    overdueMinutes: ageingMinutes - rule.thresholdMinutes,
    recipientRole: rule.recipientRole ?? null,
    recipientId: rule.recipientId ?? null,
    reassign: rule.reassign,
  };
}

/**
 * All (lead, rule) overdue matches. A lead may match more than one rule; the
 * caller decides how to fan out. Rules are applied in the order supplied, and for
 * a given lead the first matching rule wins (so a tenant can order escalation
 * tiers by putting the tightest threshold first).
 */
export function findOverdue(
  leads: LeadTimingLike[],
  rules: EscalationRuleLike[],
  now: Date,
): OverdueLead[] {
  const out: OverdueLead[] = [];
  for (const lead of leads) {
    for (const rule of rules) {
      const hit = evaluateLead(lead, rule, now);
      if (hit) {
        out.push(hit);
        break; // first matching rule per lead
      }
    }
  }
  return out;
}
