/**
 * GAP-WORKFLOW-INSTANCES-DETAIL-02 (w0-report F4) — mandatory-document gate for
 * APPROVING an officer task bound to a citizen application.
 *
 * The lane checklist is derived in citizen-service (published catalogue
 * requiredDocuments, folded with the application submissions). The web shows it
 * via GET /v1/citizen/documents/verification-lane; this module asks the same
 * authority over the x-internal + x-service-secret boundary (same pattern as the
 * hrms -> workflow open-task-refs client) so the SERVER refuses an approval the
 * UI already disables. Fails CLOSED: an unreachable / non-2xx / malformed
 * checklist is "unavailable", never a pass. Reject / return are never gated.
 */
export interface GateableTask {
  nodeKey?: string | null;
  refType?: string | null;
  refId?: string | null;
}

export type DocGateResult =
  | { ok: true }
  | { ok: false; reason: "missing"; missingMandatory: number }
  | { ok: false; reason: "unavailable"; missingMandatory: 0 };

/** Same predicate the web uses to render the checklist beside Approve. */
export function isDocGatedTask(t: GateableTask): boolean {
  return Boolean(t.nodeKey && t.refId && (t.refType ?? "").toLowerCase().includes("application"));
}

function normalizeLane(laneKey: string): string {
  return laneKey.trim().toLowerCase().replace(/^lane[_./-]?/, "");
}

function citizenUrl(): string {
  return process.env.CITIZEN_SERVICE_URL ?? "http://127.0.0.1:3020";
}

export async function checkMandatoryDocs(tenantId: string, t: GateableTask): Promise<DocGateResult> {
  if (!isDocGatedTask(t)) return { ok: true };
  try {
    const qs = new URLSearchParams({ laneKey: normalizeLane(t.nodeKey as string), applicationId: t.refId as string });
    const res = await fetch(`${citizenUrl()}/v1/citizen/documents/verification-lane?${qs.toString()}`, {
      headers: {
        "x-internal": "1",
        "x-service-secret": process.env.INTERNAL_SERVICE_SECRET ?? "",
        "x-tenant-id": tenantId,
      },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { ok: false, reason: "unavailable", missingMandatory: 0 };
    const body = (await res.json()) as { items?: unknown };
    if (!Array.isArray(body.items)) return { ok: false, reason: "unavailable", missingMandatory: 0 };
    const missing = (body.items as Array<{ mandatory?: boolean; provided?: boolean }>)
      .filter((i) => i.mandatory === true && i.provided !== true).length;
    return missing > 0 ? { ok: false, reason: "missing", missingMandatory: missing } : { ok: true };
  } catch {
    return { ok: false, reason: "unavailable", missingMandatory: 0 };
  }
}
