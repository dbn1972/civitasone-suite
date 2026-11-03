/**
 * UAT Phase 2 follow-up: synchronous budget check for PO create. Reads
 * finance-service's existing GET /v1/finance/sanctions/:id/available over HTTP
 * (internal service-account call: x-internal + x-service-secret + x-tenant-id,
 * bounded timeout) — the same endpoint the poCreate consumer checks. Never
 * called inside a DB transaction.
 *
 * Result:
 *   - { kind: "ok", available }   finance answered with the sanction balance
 *   - { kind: "not_found" }       finance has no such sanction for this tenant (404)
 *   - { kind: "unavailable" }     unreachable / timeout / non-404 error — the
 *                                 caller falls back to the async path (the
 *                                 consumer re-checks and retries), like the F77
 *                                 workflow pre-check.
 */
const FINANCE_URL = process.env.FINANCE_SERVICE_URL ?? "http://localhost:3007";
const TIMEOUT_MS = 5000;

export type SanctionBalance =
  | { kind: "ok"; available: bigint }
  | { kind: "not_found" }
  | { kind: "unavailable"; reason: string };

/** The sanction uuid inside a ref (`finance_sanction:<uuid>` or a bare uuid). */
export function sanctionIdFromRef(ref: string): string {
  return ref.trim().replace(/^.*:/, "");
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function fetchSanctionBalance(tenantId: string, sanctionRef: string, correlationId?: string): Promise<SanctionBalance> {
  const id = sanctionIdFromRef(sanctionRef);
  if (!UUID_RE.test(id)) return { kind: "not_found" };
  let res: Response;
  try {
    res = await fetch(`${FINANCE_URL}/v1/finance/sanctions/${encodeURIComponent(id)}/available`, {
      headers: {
        "x-internal": "1",
        "x-service-secret": process.env.INTERNAL_SERVICE_SECRET ?? "",
        "x-tenant-id": tenantId,
        ...(correlationId ? { "x-correlation-id": correlationId } : {}),
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    return { kind: "unavailable", reason: `finance-service unreachable: ${String(err)}` };
  }
  if (res.status === 404) return { kind: "not_found" };
  if (!res.ok) return { kind: "unavailable", reason: `finance-service sanctions check failed: ${res.status}` };
  try {
    const body = (await res.json()) as { available?: unknown };
    if (typeof body.available !== "string" && typeof body.available !== "number") {
      return { kind: "unavailable", reason: "finance-service returned no available balance" };
    }
    return { kind: "ok", available: BigInt(body.available) };
  } catch (err) {
    return { kind: "unavailable", reason: `finance-service returned an unreadable body: ${String(err)}` };
  }
}

/** ₹ with Indian grouping from paise (BigInt-safe), for refusal messages. */
export function rupeesFromMinor(minor: bigint): string {
  const neg = minor < 0n;
  const abs = neg ? -minor : minor;
  const r = (abs / 100n).toString();
  const p = (abs % 100n).toString().padStart(2, "0");
  const grouped = r.length <= 3 ? r : r.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + r.slice(-3);
  return `${neg ? "-" : ""}₹${grouped}.${p}`;
}
