import type { EntityOption } from "@/app/_components/ds";

type ProductRow = {
  id: string;
  name?: string | null;
  code?: string | null;
  productCode?: string | null;
};

function toOption(row: ProductRow): EntityOption | null {
  if (!row.id) return null;
  const name = (row.name ?? "").trim();
  const code = (row.productCode ?? row.code ?? "").trim();
  return {
    id: row.id,
    label: name || code || row.id,
    sublabel: code && name ? code : undefined,
  };
}

function rowsOf(body: unknown): ProductRow[] {
  if (Array.isArray(body)) return body as ProductRow[];
  const data = (body as { data?: unknown })?.data;
  return Array.isArray(data) ? (data as ProductRow[]) : [];
}

/**
 * EntityPicker adapters for catalogue products (GAP-CATALOGUE-RATES-01).
 *
 * Backed by catalogue-service's existing GET /v1/catalogue/products, which
 * supports a real `search` query param (products/routes.ts listQuery.search),
 * so the rates page can offer a typeahead product picker instead of a plain
 * <select> that loads the whole catalogue — the picker then drives
 * ?productId= and the paise-correct, in-force rate list. search() passes the
 * query straight through to the server; resolve() reads the product detail
 * endpoint per seeded id. Returns [] on any non-ok response.
 */
export async function searchCatalogueProducts(query: string, signal: AbortSignal): Promise<EntityOption[]> {
  const qs = new URLSearchParams({ search: query.trim(), limit: "20" });
  const res = await fetch(`/api/proxy/v1/catalogue/products?${qs.toString()}`, { signal });
  if (!res.ok) return [];
  return rowsOf(await res.json())
    .map(toOption)
    .filter((o): o is EntityOption => o !== null);
}

export async function resolveCatalogueProducts(ids: string[]): Promise<EntityOption[]> {
  if (ids.length === 0) return [];
  const out: EntityOption[] = [];
  for (const id of ids) {
    const res = await fetch(`/api/proxy/v1/catalogue/products/${encodeURIComponent(id)}`);
    if (!res.ok) continue;
    const body = (await res.json()) as { data?: ProductRow };
    const opt = body.data ? toOption(body.data) : null;
    if (opt) out.push(opt);
  }
  return out;
}
