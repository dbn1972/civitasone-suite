/**
 * Which ledger a tenant keeps its stock in (inventory-service setting `ledgerSource`).
 *
 * stock-service is legacy. A tenant on the inventory ledger already gets its GRN receipt from
 * inventory-service, so the GRN consumer here must not write a second, invisible copy. The setting is read
 * over the internal service path (same headers as inventory-service's own stock-client) through the narrow
 * GET /v1/inventory/ledger-source, with a short in-memory cache.
 *
 * FAIL SAFE: anything other than a clean "inventory" answer (unreachable, timeout, non-200, bad body) is
 * "not inventory": today's behaviour (write the stock rows) is kept and a warning is logged. The event is
 * never dropped because a lookup failed.
 */
import { pino } from "pino";

const defaultLog = pino({ name: "stock-ledger-source" });
const TTL_MS = Number(process.env.LEDGER_SOURCE_CACHE_MS ?? "30000");
const TIMEOUT_MS = Number(process.env.LEDGER_SOURCE_TIMEOUT_MS ?? "3000");

type Entry = { inventory: boolean; at: number };
const cached = new Map<string, Entry>();

export function clearLedgerSourceCache(): void {
  cached.clear();
}

export async function isInventoryLedger(
  tenantId: string,
  warn: (obj: Record<string, unknown>, msg: string) => void = (o, m) => defaultLog.warn(o, m),
): Promise<boolean> {
  const hit = cached.get(tenantId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.inventory;
  const base = process.env.INVENTORY_SERVICE_URL ?? "http://127.0.0.1:3025";
  try {
    const res = await fetch(`${base}/v1/inventory/ledger-source`, {
      headers: {
        "x-internal": "1",
        "x-service-secret": process.env.INTERNAL_SERVICE_SECRET ?? "",
        "x-tenant-id": tenantId,
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const body = (await res.json()) as { data?: { ledgerSource?: unknown } } | null;
    const value = body?.data?.ledgerSource;
    if (value !== "inventory" && value !== "stock") throw new Error("unreadable ledgerSource");
    cached.set(tenantId, { inventory: value === "inventory", at: Date.now() });
    return value === "inventory";
  } catch (err) {
    warn({ tenantId, err: (err as Error).message }, "ledgerSource unreadable: keeping the stock-register behaviour for this event");
    return false;
  }
}
