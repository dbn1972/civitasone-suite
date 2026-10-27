/**
 * D4c #25 (GAP-PROCUREMENT-CONTRACTS-NEW-06): read-only client to procurement-service
 * that resolves the purchase-order reference a contract quotes. contract-service and
 * procurement-service have separate databases, so this is an internal service-to-service
 * HTTP call (x-internal + x-service-secret + x-tenant-id, bounded timeout), mirroring
 * inventory-service's grn-client. "Unreachable" is NEVER treated as "not found" or as
 * "valid": it raises ProcurementUnavailableError so the caller can fail closed with a
 * retryable error.
 */
const PROCUREMENT_URL = process.env.PROCUREMENT_SERVICE_URL ?? "http://127.0.0.1:3008";
const PO_FETCH_TIMEOUT_MS = Number(process.env.PO_FETCH_TIMEOUT_MS ?? "5000");

export class ProcurementUnavailableError extends Error {
  readonly code = "PROCUREMENT_UNAVAILABLE";
  constructor(message: string) {
    super(message);
    this.name = "ProcurementUnavailableError";
  }
}

export type ResolvedPo = { id: string; poNo: string; status: string };

/** The tenant's real PO for `ref` (uuid, procurement_po:<uuid> or PO number), or null when none exists. */
export async function resolvePoRef(tenantId: string, ref: string, correlationId?: string): Promise<ResolvedPo | null> {
  let res: Response;
  try {
    res = await fetch(`${PROCUREMENT_URL}/v1/procurement/pos/resolve?ref=${encodeURIComponent(ref)}`, {
      headers: {
        "x-internal": "1",
        "x-service-secret": process.env.INTERNAL_SERVICE_SECRET ?? "",
        "x-tenant-id": tenantId,
        ...(correlationId ? { "x-correlation-id": correlationId } : {}),
      },
      signal: AbortSignal.timeout(PO_FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    throw new ProcurementUnavailableError(`procurement-service PO lookup unreachable: ${(err as Error).message}`);
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new ProcurementUnavailableError(`procurement-service PO lookup failed: ${res.status}`);
  const body = (await res.json()) as { data?: ResolvedPo };
  if (!body.data?.id) throw new ProcurementUnavailableError("procurement-service PO lookup returned an unreadable body");
  return body.data;
}
