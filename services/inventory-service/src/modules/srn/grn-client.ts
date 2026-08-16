/**
 * srn module — read-only client to procurement-service for the GRN status
 * that gates SRN creation (Req 1.1). inventory-service and procurement-service
 * are separate physical databases, so this is an internal service-to-service
 * HTTP call, not a JOIN — see migrations/0017_store_receipt_notes.sql.
 *
 * Mirrors the existing precedent in this codebase for cross-service GET calls
 * (e.g. services/payroll-service/src/shared/hrms-client.ts): x-internal +
 * x-service-secret + x-tenant-id headers, bounded timeout, fail with a
 * distinguishable error rather than treating "unreachable" as "not found".
 */
const PROCUREMENT_URL = process.env.PROCUREMENT_SERVICE_URL ?? "http://127.0.0.1:3008";
const GRN_FETCH_TIMEOUT_MS = Number(process.env.GRN_FETCH_TIMEOUT_MS ?? "5000");

/** Raised when procurement-service cannot be reached to resolve GRN status. */
export class ProcurementUnavailableError extends Error {
  readonly code = "PROCUREMENT_UNAVAILABLE";
  constructor(message: string) {
    super(message);
    this.name = "ProcurementUnavailableError";
  }
}

export interface RemoteGrn {
  id: string;
  status: string;
}

/**
 * Fetches the GRN's current status from procurement-service.
 * Returns null when the GRN genuinely does not exist (404).
 * Throws ProcurementUnavailableError on network failure/timeout/5xx — callers
 * must not treat that the same as "GRN not found".
 */
export async function fetchGrn(tenantId: string, grnId: string): Promise<RemoteGrn | null> {
  const serviceSecret = process.env.INTERNAL_SERVICE_SECRET ?? "";
  let res: Response;
  try {
    res = await fetch(`${PROCUREMENT_URL}/v1/procurement/grns/${grnId}`, {
      headers: {
        "x-internal": "1",
        "x-service-secret": serviceSecret,
        "x-tenant-id": tenantId,
      },
      signal: AbortSignal.timeout(GRN_FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    throw new ProcurementUnavailableError(`procurement-service grn lookup unreachable: ${(err as Error).message}`);
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new ProcurementUnavailableError(`procurement-service grn lookup failed: ${res.status}`);
  const body = await res.json() as { id: string; status: string };
  return { id: body.id, status: body.status };
}
