/**
 * Read-only client to inventory-service (a separate physical database, so this is an internal service-to-service
 * HTTP call, not a join). Same convention as inventory's grn-client / payroll's hrms-client: x-internal +
 * x-service-secret + x-tenant-id, a bounded timeout.
 *
 * UAT B23: used when a GRN is accepted, to refuse synchronously (422) a GRN that inventory would only dead-letter
 * later (unknown / ambiguous SKU, unknown store). FAIL-OPEN by design: inventory being unreachable must not block
 * goods receipt; the inventory consumer still refuses a bad GRN itself, so the worst case is the old behaviour.
 *
 * Every fail-open is visible: inventory_precheck_failopen_total{reason} and one warning per reason per process
 * (status only, never headers or secrets). Requires INTERNAL_SERVICE_SECRET, identical on procurement and
 * inventory; a mismatch shows up as reason http_401.
 */
import { incrementInventoryPrecheckFailopen } from "@civitasone/observability";
import { LICENCE_MODULE } from "@civitasone/module-licence";
import { licence } from "./licence.js";

const INVENTORY_URL = process.env.INVENTORY_SERVICE_URL ?? "http://127.0.0.1:3025";
const TIMEOUT_MS = Number(process.env.INVENTORY_PRECHECK_TIMEOUT_MS ?? "1500");

const warned = new Set<string>();
function failOpen(reason: string): null {
  incrementInventoryPrecheckFailopen(reason);
  if (!warned.has(reason)) {
    warned.add(reason);
    // eslint-disable-next-line no-console -- structured operational log
    console.warn(JSON.stringify({ level: "warn", event: "inventory_precheck_failopen", service: "procurement-service", reason, msg: "GRN accept let through without the inventory SKU/store pre-check" }));
  }
  return null;
}

export interface GrnStockPrecheck {
  unknownSkus: string[];
  ambiguousSkus: string[];
  /** null when no store was asked about. */
  storeKnown: boolean | null;
}

/** null = could not be checked (inventory unreachable / unexpected reply): caller must not refuse. */
export async function precheckGrnStock(tenantId: string, skus: string[], storeId?: string): Promise<GrnStockPrecheck | null> {
  // M5: the pre-check is best-effort. A tenant without the inventory module has no SKUs to check, so skip the call
  // quietly (no fail-open alarm: this is expected, not an outage). No-op unless the check is on and the tenant is in enforce.
  if (!(await licence.check(tenantId, LICENCE_MODULE.inventory, "http", "inventory grn-precheck")).allowed) return null;
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
    if (!res.ok) return failOpen(`http_${res.status}`);
    const body = await res.json() as Partial<GrnStockPrecheck>;
    if (!Array.isArray(body.unknownSkus) || !Array.isArray(body.ambiguousSkus)) return failOpen("bad_body");
    return {
      unknownSkus: body.unknownSkus,
      ambiguousSkus: body.ambiguousSkus,
      storeKnown: typeof body.storeKnown === "boolean" ? body.storeKnown : null,
    };
  } catch {
    return failOpen("unreachable");
  }
}
