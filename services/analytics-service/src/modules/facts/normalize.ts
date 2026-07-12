/**
 * Map inbound cross-domain events to a normalised analytics fact row.
 * Pure + defensive: unknown shapes degrade to safe defaults rather than throw,
 * so a malformed upstream event can not crash the ingestion consumer.
 */
import type { FactEventInsert } from "./schema.js";
import { INBOUND } from "../../topics.js";

type Envelope = {
  messageId: string;
  tenantId: string;
  payload: Record<string, unknown>;
};

function num(v: unknown): bigint {
  const n = typeof v === "number" ? v : Number(v);
  // Incoming amounts may be in rupees (decimal) or already paise (integer).
  // Assume paise (integer) — coerce to bigint. If fractional, multiply by 100.
  if (!Number.isFinite(n)) return 0n;
  if (Number.isInteger(n)) return BigInt(n);
  return BigInt(Math.round(n * 100)); // fractional → treat as rupees → convert to paise
}

function str(v: unknown, fallback: string): string {
  return typeof v === "string" && v.length > 0 ? v.slice(0, 64) : fallback;
}

/** First non-empty string among candidates, else fallback. */
function firstStr(candidates: unknown[], fallback: string): string {
  for (const c of candidates) {
    if (typeof c === "string" && c.length > 0) return c.slice(0, 64);
  }
  return fallback;
}

/** First parseable ISO-string timestamp among candidates, else now. */
function firstDate(candidates: unknown[]): Date {
  for (const c of candidates) {
    if (typeof c === "string" && c.length > 0) {
      const d = new Date(c);
      if (!Number.isNaN(d.getTime())) return d;
    }
  }
  return new Date();
}

/**
 * source label per event. Money domains (finance/grants/procurement) plus the
 * cross-service governance/judiciary/premises domains that publish domain facts
 * nobody else was consuming for analytics.
 */
const SOURCE_BY_EVENT: Record<string, string> = {
  [INBOUND.financePaymentReleased]: "finance",
  [INBOUND.grantReleaseProcessed]: "grants",
  [INBOUND.procurementPoApproved]: "procurement",
  [INBOUND.meetingAttendanceMarked]: "meeting",
  [INBOUND.meetingVoteConcluded]: "meeting",
  [INBOUND.meetingCompleted]: "meeting",
  [INBOUND.courtCaseRegistered]: "court",
  [INBOUND.courtCaseStatusChanged]: "court",
  [INBOUND.courtHearingScheduled]: "court",
  [INBOUND.visitorCheckedIn]: "visitor",
  [INBOUND.visitorOverstayAlerted]: "visitor",
};

/**
 * Implied status for events whose payload carries no explicit status field.
 * The event itself is the fact (a check-in IS a "checked_in" fact), so we
 * record a meaningful status rather than the generic "recorded" default.
 */
const STATUS_BY_EVENT: Record<string, string> = {
  [INBOUND.meetingCompleted]: "completed",
  [INBOUND.courtHearingScheduled]: "scheduled",
  [INBOUND.visitorCheckedIn]: "checked_in",
  [INBOUND.visitorOverstayAlerted]: "overstay",
};

export function normalizeFact(eventType: string, msg: Envelope): FactEventInsert {
  const p = msg.payload ?? {};
  const source = SOURCE_BY_EVENT[eventType] ?? "unknown";
  const systemActor = "00000000-0000-0000-0000-000000000000";
  // status: explicit status wins; then domain-specific fields
  // (vote.result, case.status_changed.to); else the per-event implied status.
  const status = firstStr(
    [p.status, p.result, p.to],
    STATUS_BY_EVENT[eventType] ?? "recorded",
  );
  // category: generic category first, then money-domain heads, then
  // governance/judiciary/premises descriptors (caseType, purpose, method, type).
  const category = firstStr(
    [p.category, p.majorHead, p.module, p.caseType, p.purpose, p.method, p.type],
    "general",
  );
  // occurredAt: prefer an event-carried timestamp over ingestion time so the
  // fact lands on its business-time axis for time-series analytics.
  const occurredAt = firstDate([
    p.occurredAt,
    p.actualEndAt,
    p.scheduledAt,
    p.timestamp,
    p.detectedAt,
  ]);
  return {
    tenantId: msg.tenantId,
    source,
    eventType: eventType.split(".").slice(1).join(".").slice(0, 64) || eventType.slice(0, 64),
    category,
    status,
    amount: num(p.amount ?? p.totalAmount ?? p.value),
    occurredAt,
    dedupeKey: msg.messageId,
    createdBy: str(p.actorId, systemActor),
    updatedBy: str(p.actorId, systemActor),
  };
}
