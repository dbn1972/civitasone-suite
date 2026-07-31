/**
 * governance/domain.ts — audit entry construction + block-rate statistics.
 * Pure functions only.
 */
import { detectPii, redactPii } from "../guardrails/domain.js";

export const MAX_AUDIT_TEXT = 4000;

export interface AuditEntryInput {
  agentId?: string | null;
  action: string;
  input?: string | null;
  output?: string | null;
  blocked?: boolean;
  reason?: string | null;
}

export interface AuditEntry {
  agentId: string | null;
  action: string;
  input: string | null;
  output: string | null;
  blocked: boolean;
  reason: string | null;
}

/**
 * DPDP Act 2023 compliance: the governance audit writer MUST persist the
 * redacted copy. Raw personal data is never logged or stored — text is
 * truncated to MAX_AUDIT_TEXT first, then every PII match is replaced with
 * `[REDACTED:TYPE]`.
 */
function sanitize(text: string | null | undefined): string | null {
  if (text === null || text === undefined) return null;
  const truncated = text.length > MAX_AUDIT_TEXT ? text.slice(0, MAX_AUDIT_TEXT) : text;
  return redactPii(truncated, detectPii(truncated));
}

export function buildAuditEntry(input: AuditEntryInput): AuditEntry {
  return {
    agentId: input.agentId ?? null,
    action: input.action,
    input: sanitize(input.input),
    output: sanitize(input.output),
    blocked: input.blocked ?? false,
    reason: input.reason ?? null,
  };
}

export interface BlockRateSummary {
  total: number;
  blocked: number;
  blockRatePct: number;
}

/** Block-rate stats over audit entries. Empty input ⇒ all zeros (no divide by zero). */
export function summarizeBlockRate(entries: Array<{ blocked?: boolean | null }>): BlockRateSummary {
  const total = entries.length;
  const blocked = entries.reduce((n, e) => (e.blocked === true ? n + 1 : n), 0);
  const blockRatePct = total === 0 ? 0 : Math.round((blocked / total) * 10000) / 100;
  return { total, blocked, blockRatePct };
}
