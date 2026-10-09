/**
 * API client for dedup-candidate review (DQ-001).
 *
 * GAP2-CRM-DEDUP-CANDIDATES-07: these endpoints now EXIST server-side.
 *   - GET  /v1/crm/contacts/dedup-candidates          — computes near-duplicate
 *       PAIRS live from the tenant's active contacts under the configured dedup
 *       rules, excluding pairs the tenant has dismissed. Returns
 *       `{ data: DedupPair[] }`. On any non-2xx this still fails closed to
 *       `{source:"error"}` so the page shows the honest DataSourceBadge error
 *       rather than a fabricated "0 duplicates" empty state.
 *   - PATCH /v1/crm/contacts/dedup-candidates/:pairId/dismiss — persists +
 *       audits the operator's decision to suppress a pair (so it never
 *       resurfaces). `pairId` is the order-independent "contactA:contactB" key
 *       the list returns. An optional `reason` is forwarded when supplied.
 *
 * `mergeDedupPair` posts to the real `POST /v1/crm/contacts/merge`
 * (contacts/routes.ts), body `{ primaryId, duplicateId }`.
 */
import { browserFetch, errorMessageFromResponse } from "@/lib/api/browserClient";

export interface DedupContactSnapshot {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  lastActivity: string | null; // ISO-8601 date-time, may be null
}

export interface DedupPair {
  pairId: string;
  /** Confidence the two contacts are the same person, 0–100. */
  confidence: number;
  left: DedupContactSnapshot;
  right: DedupContactSnapshot;
}

export type DedupSource = "api" | "error";

export async function getDedupCandidates(): Promise<{ data: DedupPair[]; source: DedupSource }> {
  try {
    const res = await browserFetch("v1/crm/contacts/dedup-candidates");
    if (!res.ok) return { data: [], source: "error" };
    const body = (await res.json()) as { data: DedupPair[] };
    return { data: body.data ?? [], source: "api" };
  } catch {
    return { data: [], source: "error" };
  }
}

/**
 * Merge right contact into left. Left (`primaryId`) is kept and gets any of its
 * empty fields backfilled from the right; right (`duplicateId`) is soft-deleted
 * and its children reassigned — see contacts/merge-consumer.ts's
 * buildContactMergePatch for exactly what gets carried over.
 *
 * GAP-CRM-DEDUP-CANDIDATES-02: an optional reviewer `reason` is forwarded when
 * supplied. The merge is irreversible, so capturing why it was approved aids the
 * audit trail; the field is additive and ignored by a backend that does not yet
 * read it.
 */
export async function mergeDedupPair(leftId: string, rightId: string, reason?: string): Promise<void> {
  const res = await browserFetch("v1/crm/contacts/merge", {
    method: "POST",
    body: JSON.stringify({
      primaryId: leftId,
      duplicateId: rightId,
      ...(reason && reason.trim() ? { reason: reason.trim() } : {}),
    }),
  });
  if (!res.ok) throw new Error(await errorMessageFromResponse(res));
}

/**
 * Dismiss a flagged pair — they will not surface again as duplicates.
 *
 * GAP-CRM-DEDUP-CANDIDATES-03: an optional `reason` is forwarded when supplied.
 * Dismissing permanently hides a potential duplicate, so a short note is useful
 * for review; additive and ignored by a backend that does not read it.
 */
export async function dismissDedupPair(pairId: string, reason?: string): Promise<void> {
  const res = await browserFetch(`v1/crm/contacts/dedup-candidates/${pairId}/dismiss`, {
    method: "PATCH",
    ...(reason && reason.trim() ? { body: JSON.stringify({ reason: reason.trim() }) } : {}),
  });
  if (!res.ok) throw new Error(await errorMessageFromResponse(res));
}
