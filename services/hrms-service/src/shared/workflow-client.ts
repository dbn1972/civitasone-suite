/**
 * Workflow-service internal HTTP client (GAP-HR-LEAVE-APPROVALS-04).
 *
 * Lets the leave read path ask "does this actor hold an open approval task on
 * these leave applications?" so an approver who is not the applicant's line
 * manager can still read exactly the records they have been asked to decide,
 * and nothing else. Same x-internal + x-service-secret + x-tenant-id boundary
 * as the identity/payroll clients. Fails CLOSED: any error / non-2xx /
 * unreachable returns an empty set (the caller then sees only what its role
 * scope already allows), never a permissive fallback.
 */
const WORKFLOW_URL = process.env.WORKFLOW_SERVICE_URL ?? "http://127.0.0.1:3029";

export async function fetchOpenTaskRefIds(params: {
  tenantId: string;
  actorId: string;
  roles: string[];
  refType: string;
  refIds: string[];
}): Promise<Set<string>> {
  if (params.refIds.length === 0) return new Set();
  try {
    const res = await fetch(`${WORKFLOW_URL}/v1/workflow/internal/open-task-refs`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal": "1",
        "x-service-secret": process.env.INTERNAL_SERVICE_SECRET ?? "",
        "x-tenant-id": params.tenantId,
      },
      body: JSON.stringify({
        actorId: params.actorId,
        roles: params.roles,
        refType: params.refType,
        refIds: params.refIds,
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return new Set();
    const body = (await res.json()) as { refIds?: string[] };
    return new Set(body.refIds ?? []);
  } catch {
    return new Set();
  }
}
