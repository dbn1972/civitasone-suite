/**
 * Pure mapping and banding helpers for the AI governance screen (P2-10).
 *
 * Kept free of server-only imports so the mapping rules can be unit tested
 * without a request context.
 */

export type GovernanceCounters = {
  totalInvocations: number;
  blockedCount: number;
  blockRatePct: number;
  activeAgents: number;
};

export type AuditEntry = {
  id: string;
  agentId: string | null;
  action: string;
  blocked: boolean;
  reason: string | null;
  createdAt: string;
};

export type AgentStatus = {
  id: string;
  name: string;
  status: string;
};

/** How a block rate should be presented: informational, watch, or act now. */
export type BlockRateBand = "normal" | "elevated" | "critical";

export const ELEVATED_BLOCK_RATE_PCT = 5;
export const CRITICAL_BLOCK_RATE_PCT = 20;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toText(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function toCount(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function rows(payload: unknown): unknown[] | null {
  if (Array.isArray(payload)) return payload;
  if (isRecord(payload) && Array.isArray(payload.data)) return payload.data;
  return null;
}

/**
 * Governance counters come from the dashboard endpoint. The block rate is
 * recomputed locally when the service omits it so the headline can never
 * disagree with the two counts shown beside it.
 */
export function mapGovernanceCounters(payload: unknown): GovernanceCounters | null {
  const data = isRecord(payload) && isRecord(payload.data) ? payload.data : isRecord(payload) ? payload : null;
  if (!data) return null;

  const totalInvocations = toCount(data.totalInvocations ?? data.total);
  const blockedCount = toCount(data.blockedCount ?? data.blocked);
  const reported = data.blockRatePct;
  const blockRatePct =
    typeof reported === "number" && Number.isFinite(reported)
      ? reported
      : totalInvocations === 0
        ? 0
        : Math.round((blockedCount / totalInvocations) * 10000) / 100;

  return {
    totalInvocations,
    blockedCount,
    blockRatePct,
    activeAgents: toCount(data.activeAgents),
  };
}

export function mapAuditEntries(payload: unknown): AuditEntry[] | null {
  const list = rows(payload);
  if (!list) return null;
  const mapped: AuditEntry[] = [];
  for (const row of list) {
    if (!isRecord(row)) continue;
    const id = toText(row.id);
    const action = toText(row.action);
    const createdAt = toText(row.createdAt);
    if (!id || !action || !createdAt) continue;
    mapped.push({
      id,
      agentId: toText(row.agentId),
      action,
      blocked: row.blocked === true,
      reason: toText(row.reason),
      createdAt,
    });
  }
  return mapped;
}

export function mapAgentStatuses(payload: unknown): AgentStatus[] | null {
  const list = rows(payload);
  if (!list) return null;
  const mapped: AgentStatus[] = [];
  for (const row of list) {
    if (!isRecord(row)) continue;
    const id = toText(row.id);
    const name = toText(row.name);
    if (!id || !name) continue;
    mapped.push({ id, name, status: toText(row.status) ?? "unknown" });
  }
  return mapped;
}

/** Bands a block rate so the UI can flag a model that is refusing too much. */
export function blockRateBand(blockRatePct: number): BlockRateBand {
  if (blockRatePct >= CRITICAL_BLOCK_RATE_PCT) return "critical";
  if (blockRatePct >= ELEVATED_BLOCK_RATE_PCT) return "elevated";
  return "normal";
}

/** The reasons behind blocked actions, most frequent first. */
export function topBlockReasons(
  entries: AuditEntry[],
  limit = 5,
): Array<{ reason: string; count: number }> {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    if (!entry.blocked) continue;
    const reason = entry.reason ?? "Unspecified";
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason))
    .slice(0, limit);
}
