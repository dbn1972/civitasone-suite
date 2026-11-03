import type { RFQDetail } from "@civitasone/types";

/**
 * L1 (lowest bidder) selection for the RFQ comparative statement and the Award
 * action. Deliberately a plain module, not the "use client"
 * ComparativeStatement.tsx: the RFQ detail page (a Server Component) calls
 * computeL1() while rendering, and a function exported from a client module is
 * a client reference on the server -- calling it threw "Attempted to call
 * computeL1() from the server", crashing /procurement/rfq/[id] (UAT L1, Phase 1B).
 *
 * L1 is the lowest `totalAmountMinor` among responses that are still in the
 * running (not withdrawn/rejected), compared in integer paise (BigInt) so float
 * rounding can never pick the wrong winner.
 */
type Resp = RFQDetail["responses"][number];

export function toPaise(minor: string | undefined): bigint | null {
  if (minor === undefined || !/^\d+$/.test(minor)) return null;
  return BigInt(minor);
}

/** The L1 response (lowest total among in-the-running, unsealed responses), or null. */
export function computeL1(responses: Resp[]): Resp | null {
  let best: Resp | null = null;
  let bestPaise: bigint | null = null;
  for (const r of responses) {
    if (r.status === "rejected" || r.status === "withdrawn") continue;
    const p = toPaise(r.totalAmountMinor);
    if (p === null) continue;
    if (bestPaise === null || p < bestPaise) {
      bestPaise = p;
      best = r;
    }
  }
  return best;
}
