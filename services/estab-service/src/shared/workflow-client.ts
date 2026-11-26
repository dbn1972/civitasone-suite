/**
 * Internal HTTP client for estab-service -> workflow-service: "does this actor hold an OPEN approval
 * task on this file right now?" (GAP-ESTAB-FILES-DETAIL-03, owner decision B23).
 *
 * Uses workflow-service's /v1/workflow/internal/open-task-refs (the same endpoint hrms-service uses
 * for leave approvals). A task is "open for the actor" when it is pending and either assigned to
 * them or unassigned and addressed to a role they hold (file_noting chain: Section Officer ->
 * Under Secretary -> Deputy Secretary; only the current level's task is pending).
 *
 * Fails CLOSED: null means "workflow could not answer" and callers must treat it as "no", never as
 * permission.
 */
export const ESTAB_FILE_REF_TYPE = "estab_file";

const WORKFLOW_URL = (process.env.WORKFLOW_SERVICE_URL ?? "http://127.0.0.1:3029").replace(/\/$/, "");

export async function actorHoldsOpenFileTask(params: {
  tenantId: string;
  actorId: string;
  roles: readonly string[];
  fileId: string;
}): Promise<boolean | null> {
  const serviceSecret = process.env.INTERNAL_SERVICE_SECRET;
  if (!serviceSecret) return null;
  try {
    const res = await fetch(`${WORKFLOW_URL}/v1/workflow/internal/open-task-refs`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal": "1",
        "x-service-secret": serviceSecret,
        "x-tenant-id": params.tenantId,
      },
      body: JSON.stringify({
        actorId: params.actorId,
        roles: [...params.roles].slice(0, 50),
        refType: ESTAB_FILE_REF_TYPE,
        refIds: [params.fileId],
      }),
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { refIds?: string[] };
    return (body.refIds ?? []).includes(params.fileId);
  } catch {
    return null;
  }
}
