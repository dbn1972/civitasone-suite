import type { EntityOption } from "@/app/_components/ds";
import { failStrict, type StrictOpt } from "./strict";

/**
 * EntityPicker adapters for the finance VENDOR master (GAP-FINANCE-EXPENDITURE-ADVANCES-NEW-03: the payee of a vendor
 * advance is picked, and the picked vendor's id is stored with the advance instead of free text).
 *
 * GET /v1/finance/vendors returns the tenant's whole (bounded) vendor list with no search parameter, so -- like the
 * cost-centre and pay-structure adapters -- both functions read that one list and filter client-side. Only ACTIVE
 * vendors are offered: finance-service refuses an advance to a deactivated, pending or rejected vendor, so offering
 * one would only fail after the form was filled in. Nothing but id, name and category is read (no PAN, no bank data).
 */
type VendorRow = { id: string; name?: string; category?: string; status?: string };

function toOption(row: VendorRow): EntityOption {
  return { id: row.id, label: row.name ?? row.id, ...(row.category ? { sublabel: row.category } : {}) };
}

async function fetchActive(signal?: AbortSignal, opts?: StrictOpt): Promise<VendorRow[]> {
  const res = await fetch("/api/proxy/v1/finance/vendors", signal ? { signal } : undefined);
  failStrict(res, opts);
  if (!res.ok) return [];
  const body = (await res.json()) as { data?: VendorRow[] } | VendorRow[];
  const rows = Array.isArray(body) ? body : (body.data ?? []);
  return rows.filter((r) => typeof r.id === "string" && r.status === "active");
}

export async function searchFinanceVendors(query: string, signal: AbortSignal, opts?: StrictOpt): Promise<EntityOption[]> {
  const rows = await fetchActive(signal, opts);
  const q = query.trim().toLowerCase();
  const filtered = q
    ? rows.filter((r) => (r.name ?? "").toLowerCase().includes(q) || (r.category ?? "").toLowerCase().includes(q))
    : rows;
  return filtered.slice(0, 20).map(toOption);
}

export async function resolveFinanceVendors(ids: string[]): Promise<EntityOption[]> {
  if (ids.length === 0) return [];
  const idSet = new Set(ids);
  const rows = await fetchActive();
  return rows.filter((r) => idSet.has(r.id)).map(toOption);
}
