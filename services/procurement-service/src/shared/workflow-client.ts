const WORKFLOW_URL = process.env.WORKFLOW_SERVICE_URL ?? "http://127.0.0.1:3029";

export type RefDecision = {
  action: string;
  decision: string | null;
  actorId: string;
  nodeKey: string | null;
  reason: string | null;
  at: string;
};

/**
 * GAP-PROCUREMENT-INDENTS-DETAIL-05: the approve / reject / return decisions the
 * workflow engine recorded against one business record, via workflow-service's
 * service-account-only internal read (same x-internal boundary as
 * identity-client.ts). Unlike a display enrichment this distinguishes "no
 * decisions yet" from "could not ask": `available:false` lets the caller say
 * the trail is temporarily unavailable instead of rendering a misleading empty
 * trail on an indent that WAS decided.
 */
export async function fetchRefDecisions(
  tenantId: string,
  refType: string,
  refId: string,
): Promise<{ available: boolean; decisions: RefDecision[] }> {
  try {
    const res = await fetch(`${WORKFLOW_URL}/v1/workflow/internal/ref-decisions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal": "1",
        "x-service-secret": process.env.INTERNAL_SERVICE_SECRET ?? "",
        "x-tenant-id": tenantId,
      },
      body: JSON.stringify({ refType, refId }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { available: false, decisions: [] };
    const body = (await res.json()) as { data?: RefDecision[] };
    return { available: true, decisions: Array.isArray(body.data) ? body.data : [] };
  } catch {
    return { available: false, decisions: [] };
  }
}
