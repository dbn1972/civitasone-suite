/**
 * API client for dedup-candidate review (DQ-001 post-save workflow).
 *
 * GET  /v1/crm/contacts/dedup-candidates           — list flagged pairs
 * PATCH /v1/crm/contacts/:leftId/merge             — merge right into left
 * PATCH /v1/crm/contacts/dedup-candidates/:id/dismiss — dismiss a pair
 *
 * On network/server failure the loaders return { source: "error" } so the
 * UI can render "—" and the DataSourceBadge without fabricating empty state.
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
    const res = await browserFetch("/v1/crm/contacts/dedup-candidates");
    if (!res.ok) return { data: [], source: "error" };
    const body = (await res.json()) as { data: DedupPair[] };
    return { data: body.data ?? [], source: "api" };
  } catch {
    return { data: [], source: "error" };
  }
}

/** Merge right contact into left. Left is kept; right is soft-deleted. */
export async function mergeDedupPair(leftId: string, rightId: string): Promise<void> {
  const res = await browserFetch(`/v1/crm/contacts/${leftId}/merge`, {
    method: "PATCH",
    body: JSON.stringify({ mergeIntoId: rightId }),
  });
  if (!res.ok) throw new Error(await errorMessageFromResponse(res));
}

/** Dismiss a flagged pair — they will not surface again as duplicates. */
export async function dismissDedupPair(pairId: string): Promise<void> {
  const res = await browserFetch(`/v1/crm/contacts/dedup-candidates/${pairId}/dismiss`, {
    method: "PATCH",
  });
  if (!res.ok) throw new Error(await errorMessageFromResponse(res));
}
