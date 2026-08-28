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
 * Throws with the server's real `CODE: message` on failure — e.g.
 * "ALREADY_DECIDED: merge request is already approved" if two stewards race.
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
