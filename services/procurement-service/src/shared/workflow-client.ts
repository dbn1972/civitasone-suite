import { pino } from "pino";
import { HttpError } from "./context.js";

const WORKFLOW_URL = process.env.WORKFLOW_SERVICE_URL ?? "http://127.0.0.1:3029";

/**
 * B9-wf2: code of the 503 a caller gets when workflow-service refuses
 * procurement-service's own service credentials (401 / 403 on an internal
 * call). That is a deployment misconfiguration (wrong or missing
 * INTERNAL_SERVICE_SECRET), never an answer about the business record, so it
 * must not be read as "not configured" / "no decisions" / "could not ask".
 */
export const WORKFLOW_SERVICE_AUTH_FAILED = "WORKFLOW_SERVICE_AUTH_FAILED";

export const workflowClientLog = pino({ name: "procurement:workflow-client" });

/**
 * B9-wf2: a 401 / 403 from workflow-service used to fall into the same
 * `!res.ok` branch as an outage, so a misconfigured service token looked like
 * a fail-open success (the F77 pre-check let every command through). Fail
 * loudly instead: error-level log plus a 503 the route's error handler
 * returns as-is.
 */
function throwIfAuthRefused(res: Response, op: string, tenantId: string): void {
  if (res.status !== 401 && res.status !== 403) return;
  workflowClientLog.error(
    { op, status: res.status, tenantId, code: WORKFLOW_SERVICE_AUTH_FAILED },
    "workflow-service refused procurement-service's service credentials; check INTERNAL_SERVICE_SECRET",
  );
  throw new HttpError(
    503, WORKFLOW_SERVICE_AUTH_FAILED,
    `workflow-service rejected procurement-service's service credentials (HTTP ${res.status}); the request was not processed`,
  );
}

function internalHeaders(tenantId: string): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-internal": "1",
    "x-service-secret": process.env.INTERNAL_SERVICE_SECRET ?? "",
    "x-tenant-id": tenantId,
  };
}

/** POST to a workflow-service internal route; `null` = unreachable (network error / timeout). */
async function postInternal(path: string, tenantId: string, body: unknown): Promise<Response | null> {
  try {
    return await fetch(`${WORKFLOW_URL}${path}`, {
      method: "POST",
      headers: internalHeaders(tenantId),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    return null;
  }
}

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
 * trail on an indent that WAS decided. A credential refusal throws (B9-wf2).
 */
export async function fetchRefDecisions(
  tenantId: string,
  refType: string,
  refId: string,
): Promise<{ available: boolean; decisions: RefDecision[] }> {
  const res = await postInternal("/v1/workflow/internal/ref-decisions", tenantId, { refType, refId });
  if (!res) return { available: false, decisions: [] };
  throwIfAuthRefused(res, "ref-decisions", tenantId);
  if (!res.ok) {
    workflowClientLog.warn({ op: "ref-decisions", status: res.status, tenantId }, "workflow-service ref-decisions read failed");
    return { available: false, decisions: [] };
  }
  try {
    const body = (await res.json()) as { data?: RefDecision[] };
    return { available: true, decisions: Array.isArray(body.data) ? body.data : [] };
  } catch {
    return { available: false, decisions: [] };
  }
}

/**
 * F77: does this tenant have an ACTIVE workflow definition for `code`? Asked
 * before accepting a command whose consumer will raise an approval instance,
 * so a tenant without the chain gets a clear 422 WORKFLOW_NOT_CONFIGURED
 * instead of a 202 whose instance workflow-service then rejects (R13).
 * `null` means "could not ask" (workflow-service unreachable / 5xx / other
 * non-2xx): the caller proceeds and the async path stays fail-closed, so an
 * outage of the pre-check never blocks the command on its own.
 * B9-wf2: a 401 / 403 is NOT "could not ask" - it throws a 503
 * WORKFLOW_SERVICE_AUTH_FAILED (and logs at error level).
 */
export async function isWorkflowConfigured(tenantId: string, code: string): Promise<boolean | null> {
  const res = await postInternal("/v1/workflow/internal/definition-configured", tenantId, { code });
  if (!res) return null;
  throwIfAuthRefused(res, "definition-configured", tenantId);
  if (!res.ok) {
    workflowClientLog.warn({ op: "definition-configured", status: res.status, tenantId, definitionCode: code }, "workflow-service definition pre-check failed; proceeding (async path stays fail-closed)");
    return null;
  }
  try {
    const body = (await res.json()) as { configured?: unknown };
    return typeof body.configured === "boolean" ? body.configured : null;
  } catch {
    return null;
  }
}

/**
 * F77 / B9-wf1: refuse a command with 422 WORKFLOW_NOT_CONFIGURED when the
 * tenant has no active definition for the approval chain its consumer will
 * request. `consequence` completes the message ("a purchase order could never
 * be approved"). Fails open only when workflow-service cannot be asked.
 */
export async function assertWorkflowConfigured(tenantId: string, code: string, consequence: string): Promise<void> {
  if ((await isWorkflowConfigured(tenantId, code)) === false) {
    throw new HttpError(
      422, "WORKFLOW_NOT_CONFIGURED",
      `workflow definition '${code}' is not configured for this tenant; ${consequence}`,
    );
  }
}
