/**
 * Validates GL account heads against the tenant's finance chart of accounts.
 *
 * Uses finance-service's existing tenant-scoped accounts lookup (GET /v1/finance/accounts?q=) over the platform's
 * internal service-to-service path (x-internal + x-tenant-id + x-service-secret) -- no cross-service DB access.
 * A head is acceptable only when it EXISTS (exact code match), is ACTIVE, has the type the posting needs, and is not
 * the accumulated-depreciation (contra-asset) head. The accumulated-depreciation code is ASKED FROM FINANCE (the account
 * finance actually posts depreciation to) -- there is no copy of it here. There are deliberately NO default heads anywhere
 * in this service.
 */
import { pino } from "pino";

const log = pino({ name: "asset-finance-client" });

export type HeadKind = "cwip" | "fixed_asset" | "impairment_expense" | "revaluation_reserve" | "rou" | "lease_liability" | "lease_offset";
export type HeadType = "asset" | "liability" | "equity" | "income" | "expense";

/** The finance account type each head must have; null = any non-contra type (clearing head). */
export const REQUIRED_HEAD_TYPE: Record<HeadKind, HeadType | null> = {
  cwip: "asset",
  fixed_asset: "asset",
  impairment_expense: "expense", // impairment loss
  revaluation_reserve: "equity", // revaluation reserve
  rou: "asset",
  lease_liability: "liability",
  lease_offset: null,
};

export type HeadCheck =
  | { ok: true; code: string; name: string; type: HeadType }
  | { ok: false; reason: "NOT_FOUND" | "INACTIVE" | "WRONG_TYPE" | "ACCUMULATED_DEPRECIATION" | "UNAVAILABLE"; detail?: string };

/** Belt and braces on top of finance's own code: an account literally NAMED accumulated depreciation is never a target. */
const ACCUM_DEP_NAME = /accumulated\s+depreciation|accum\.?\s*dep/i;

type AccountRow = { code?: unknown; name?: unknown; type?: unknown; status?: unknown };

export function financeBaseUrl(): string {
  return process.env.FINANCE_SERVICE_URL ?? "http://127.0.0.1:3007";
}

function internalHeaders(tenantId: string, secret: string, correlationId?: string): Record<string, string> {
  return {
    "x-internal": "1",
    "x-tenant-id": tenantId,
    "x-service-secret": secret,
    "x-internal-caller": "asset-service",
    ...(correlationId ? { "x-correlation-id": correlationId } : {}),
  };
}

let accumDepCache: { code: string; at: number } | null = null;
/** Test seam: forget the cached accumulated-depreciation code. */
export function resetFinanceCache(): void { accumDepCache = null; }

/** The code finance posts accumulated depreciation to (cached for 5 minutes); null when finance cannot be asked. */
async function financeAccumDepCode(tenantId: string, secret: string, signal: AbortSignal, correlationId?: string): Promise<string | null> {
  if (accumDepCache && Date.now() - accumDepCache.at < 300_000) return accumDepCache.code;
  const res = await fetch(`${financeBaseUrl()}/v1/finance/accounts/system-heads`, { headers: internalHeaders(tenantId, secret, correlationId), signal });
  if (!res.ok) return null;
  const body = (await res.json().catch(() => null)) as { accumulatedDepreciationCode?: unknown } | null;
  if (typeof body?.accumulatedDepreciationCode !== "string" || body.accumulatedDepreciationCode === "") return null;
  accumDepCache = { code: body.accumulatedDepreciationCode, at: Date.now() };
  return accumDepCache.code;
}

export async function validateHead(tenantId: string, kind: HeadKind, code: string, correlationId?: string): Promise<HeadCheck> {
  const secret = process.env.INTERNAL_SERVICE_SECRET;
  if (!secret) return { ok: false, reason: "UNAVAILABLE", detail: "INTERNAL_SERVICE_SECRET is not configured" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(`${financeBaseUrl()}/v1/finance/accounts?q=${encodeURIComponent(code)}&limit=50`, {
      headers: internalHeaders(tenantId, secret, correlationId),
      signal: controller.signal,
    });
    if (!res.ok) {
      log.warn({ status: res.status }, "finance accounts lookup failed");
      return { ok: false, reason: "UNAVAILABLE", detail: `finance answered ${res.status}` };
    }
    const body = (await res.json().catch(() => null)) as { data?: AccountRow[] } | null;
    const row = (body?.data ?? []).find((r) => r.code === code);
    if (!row) return { ok: false, reason: "NOT_FOUND" };
    const name = typeof row.name === "string" ? row.name : code;
    const type = row.type as HeadType;
    if (row.status === "inactive") return { ok: false, reason: "INACTIVE" };
    const accumDep = await financeAccumDepCode(tenantId, secret, controller.signal, correlationId);
    if (accumDep === null) return { ok: false, reason: "UNAVAILABLE", detail: "finance did not report its accumulated-depreciation account" };
    if (code === accumDep || ACCUM_DEP_NAME.test(name)) return { ok: false, reason: "ACCUMULATED_DEPRECIATION" };
    const need = REQUIRED_HEAD_TYPE[kind];
    if (need && type !== need) return { ok: false, reason: "WRONG_TYPE", detail: `expected ${need}, found ${String(type)}` };
    return { ok: true, code, name, type };
  } catch (err) {
    log.warn({ err }, "finance accounts lookup threw");
    return { ok: false, reason: "UNAVAILABLE", detail: err instanceof Error ? err.message : "lookup failed" };
  } finally {
    clearTimeout(timer);
  }
}
