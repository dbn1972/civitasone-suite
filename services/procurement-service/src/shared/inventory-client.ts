/**
 * Read-only client to inventory-service (a separate physical database, so this is an internal service-to-service
 * HTTP call, not a join). Same convention as inventory's grn-client / payroll's hrms-client: x-internal +
 * x-service-secret + x-tenant-id, a bounded timeout.
 *
 * UAT B23: used when a GRN is accepted, to refuse synchronously (422) a GRN that inventory would only dead-letter
 * later (unknown / ambiguous SKU, unknown store). FAIL-OPEN by design: inventory being unreachable must not block
 * goods receipt; the inventory consumer still refuses a bad GRN itself, so the worst case is the old behaviour.
 */
const INVENTORY_URL = process.env.INVENTORY_SERVICE_URL ?? "http://127.0.0.1:3025";
const TIMEOUT_MS = Number(process.env.INVENTORY_PRECHECK_TIMEOUT_MS ?? "3000");

export interface GrnStockPrecheck {
  unknownSkus: string[];
  ambiguousSkus: string[];
  /** null when no store was asked about. */
  storeKnown: boolean | null;
}

/** null = could not be checked (inventory unreachable / unexpected reply): caller must not refuse. */
export async function precheckGrnStock(tenantId: string, skus: string[], storeId?: string): Promise<GrnStockPrecheck | null> {
  try {
    const res = await fetch(`${INVENTORY_URL}/v1/inventory/grn-precheck`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal": "1",
        "x-service-secret": process.env.INTERNAL_SERVICE_SECRET ?? "",
        "x-tenant-id": tenantId,
      },
      body: JSON.stringify({ skus, ...(storeId ? { storeId } : {}) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const body = await res.json() as Partial<GrnStockPrecheck>;
    if (!Array.isArray(body.unknownSkus) || !Array.isArray(body.ambiguousSkus)) return null;
    return {
      unknownSkus: body.unknownSkus,
      ambiguousSkus: body.ambiguousSkus,
      storeKnown: typeof body.storeKnown === "boolean" ? body.storeKnown : null,
    };
  } catch {
    return null;
  }
}
