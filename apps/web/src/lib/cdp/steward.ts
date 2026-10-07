/**
 * API client for the CDP steward merge-review queue (identity resolution).
 *
 * GET  /v1/cdp/steward/queue   — list merge candidates (pending + already-decided)
 * POST /v1/cdp/steward/decide  — approve (merge the two profiles for real) or
 *                                 reject (close the suggestion; no data changes)
 *
 * A decision is processed asynchronously: the server accepts the command
 * (HTTP 202) and a queue consumer performs the actual profile merge and
 * identity reassignment moments later — see
 * services/cdp-service/src/modules/steward/consumer.ts. Callers should not
 * assume `status` has flipped the instant this resolves.
 *
 * On network/server failure the loader returns { source: "error" } so the UI
 * can render the real error state rather than an empty state that could be
 * mistaken for "no merge suggestions".
 */
import { browserFetch, browserJson } from "@/lib/api/browserClient";

export type MergeQueueStatus = "pending" | "approved" | "rejected";

// A `type` alias (not `interface`) so this satisfies DataTable<T extends
// Record<string, unknown>> — interfaces don't get TS's implicit index
// signature, so `DataTable<MergeCandidate>` fails to compile otherwise.
export type MergeCandidate = {
  id: string;
  tenantId: string;
  sourceProfileId: string;
  targetProfileId: string;
  /** Numeric string in [0,1], e.g. "0.9231" — the DB column is numeric(5,4). */
  confidence: string;
  matchReason: string | null;
  status: MergeQueueStatus;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionReason: string | null;
  createdAt: string;
};

export type StewardQueueSource = "api" | "error";

export async function getStewardQueue(): Promise<{ data: MergeCandidate[]; source: StewardQueueSource }> {
  try {
    const res = await browserFetch("v1/cdp/steward/queue");
    if (!res.ok) return { data: [], source: "error" };
    const body = (await res.json()) as { data: MergeCandidate[] };
    return { data: body.data ?? [], source: "api" };
  } catch {
    return { data: [], source: "error" };
  }
}

export type MergeDecision = "approve" | "reject";

export type DecideMergeResult = {
  id?: string;
  status?: string;
  correlationId?: string;
};

/**
 * Submit a steward decision. Resolves once the command is accepted (HTTP 202);
 * the actual merge (on approve) happens moments later via the queue consumer.
 *
 * On failure this throws a UserFacingError carrying a clerk-safe, plain-language
 * message built by the app error catalogue (browserJson -> errorMessageFromResponse
 * -> humanErrorFromFailure); the server's machine code (e.g. "ALREADY_DECIDED" when
 * two stewards race) and raw text are deliberately NOT surfaced (UX-020).
 */
export async function decideMerge(
  mergeRequestId: string,
  decision: MergeDecision,
  reason?: string,
): Promise<DecideMergeResult> {
  return browserJson<DecideMergeResult>("v1/cdp/steward/decide", {
    method: "POST",
    body: JSON.stringify({ mergeRequestId, decision, reason }),
  });
}

/**
 * GAP-CDP-STEWARD-02: a compact, display-safe view of a profile for the merge
 * queue and the confirm dialog. A steward must see WHO they are merging — name,
 * type and a couple of (masked) identifying attributes — not just two opaque
 * UUID prefixes, before approving an irreversible merge.
 *
 * Backed by the existing cdp-service read model GET /v1/cdp/profiles/:id/summary
 * (profiles/summary-routes.ts), which already projects a bounded KEY_ATTRIBUTES
 * bag (name/email/phone/city/state/...). No new backend surface is invented.
 */
export type ProfileSummary = {
  id: string;
  profileType: string;
  attributes: Record<string, unknown>;
};

/**
 * Fetch the display summary for one profile. Returns null when the profile
 * cannot be loaded (404, merged-away, network/permission error) so the caller
 * can show an honest "details unavailable" state WITHOUT blocking the decision —
 * the merge queue must stay usable even if a profile read fails.
 */
export async function getProfileSummary(id: string): Promise<ProfileSummary | null> {
  try {
    const res = await browserFetch(`v1/cdp/profiles/${id}/summary`);
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: ProfileSummary };
    return body.data ?? null;
  } catch {
    return null;
  }
}

/** Read a string attribute from a summary bag, or null when absent/non-string. */
export function summaryAttr(summary: ProfileSummary | null | undefined, key: string): string | null {
  const value = summary?.attributes?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** The best available human label for a profile: its name, else a short id. */
export function profileDisplayName(summary: ProfileSummary | null | undefined, fallbackId: string): string {
  return summaryAttr(summary, "name") ?? `${fallbackId.slice(0, 8)}…`;
}
