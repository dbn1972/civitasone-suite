/**
 * API client for dedup-candidate review (DQ-001).
 *
 * KNOWN GAP (investigated, not silently patched over — see this PR's
 * description for the full writeup): `getDedupCandidates` and
 * `dismissDedupPair` below still call endpoints that do not exist anywhere in
 * crm-service. The real backend (contacts/dedup-routes.ts) only offers
 * `POST /v1/crm/contacts/duplicate-check` — an ON-DEMAND check of ONE
 * candidate (by id or raw field values) against the tenant's contacts,
 * returning ranked `{id, matchedFields, score}` matches. There is no table,
 * job, or endpoint anywhere that persists a tenant-wide queue of "flagged
 * pairs" for this page's list view to load, and no "dismiss" concept to
 * un-flag one (dedup is recomputed fresh every time duplicate-check runs, so
 * nothing to dismiss is ever stored). That's a real product decision — redesign
 * this page around the real per-contact on-demand check, or invest in the
 * backend work an actual persisted/dismissible queue would need — not a
 * one-line endpoint-name fix, so it was intentionally left alone here rather
 * than guessed at. `getDedupCandidates` already fails closed to
 * `{source:"error"}` on any non-2xx response (see below), so the page shows
 * the honest DataSourceBadge error state rather than a fabricated "0
 * duplicates" empty state.
 *
 * `mergeDedupPair`, in contrast, DOES have a direct, unambiguous real
 * endpoint and has been fixed to call it: `POST /v1/crm/contacts/merge`
 * (contacts/routes.ts), body `{ primaryId, duplicateId }` — not the
 * `PATCH /v1/crm/contacts/:leftId/merge` + `{ mergeIntoId }` this used to
 * send, which 404'd unconditionally.
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

/**
 * Merge right contact into left. Left (`primaryId`) is kept and gets any of its
 * empty fields backfilled from the right; right (`duplicateId`) is soft-deleted
 * and its children reassigned — see contacts/merge-consumer.ts's
 * buildContactMergePatch for exactly what gets carried over.
 */
export async function mergeDedupPair(leftId: string, rightId: string): Promise<void> {
  const res = await browserFetch("/v1/crm/contacts/merge", {
    method: "POST",
    body: JSON.stringify({ primaryId: leftId, duplicateId: rightId }),
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
