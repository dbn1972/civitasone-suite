import type { EntityOption } from "@/app/_components/ds";

type AssetRow = { id?: unknown; code?: unknown; assetCode?: unknown; name?: unknown };

/**
 * GAP-ASSETS-INSURANCE-03: option for an asset. The CODE stays visible in the
 * label -- picking the wrong asset for an insurance policy is the business
 * risk -- and a raw UUID is never used as a label.
 */
export function assetToOption(row: AssetRow): EntityOption | null {
  if (typeof row.id !== "string") return null;
  const code = typeof row.assetCode === "string" && row.assetCode ? row.assetCode : typeof row.code === "string" ? row.code : "";
  const name = typeof row.name === "string" ? row.name : "";
  const label = [code, name].filter(Boolean).join(" · ") || "Unnamed asset";
  return { id: row.id, label };
}

function rowsOf(body: unknown): AssetRow[] {
  if (Array.isArray(body)) return body as AssetRow[];
  if (typeof body === "object" && body !== null && Array.isArray((body as { data?: unknown }).data)) {
    return (body as { data: AssetRow[] }).data;
  }
  return [];
}

/**
 * EntityPicker search(q) adapter for assets: GET /v1/assets/assets?search=q.
 * asset-service matches name/code server-side (word AND substring) and pages,
 * so the register size no longer caps what the picker can find.
 */
export async function searchAssets(query: string, signal: AbortSignal): Promise<EntityOption[]> {
  const res = await fetch(`/api/proxy/v1/assets/assets?search=${encodeURIComponent(query)}&limit=20`, { signal });
  if (!res.ok) throw new Error("asset search failed");
  return rowsOf(await res.json()).flatMap((r) => {
    const o = assetToOption(r);
    return o ? [o] : [];
  });
}

/** EntityPicker resolve(ids) adapter: one detail GET per id (a form seeds at most one). */
export async function resolveAssets(ids: string[]): Promise<EntityOption[]> {
  const out: EntityOption[] = [];
  await Promise.all(
    ids.map(async (id) => {
      const res = await fetch(`/api/proxy/v1/assets/assets/${encodeURIComponent(id)}`);
      if (!res.ok) return;
      const o = assetToOption((await res.json()) as AssetRow);
      if (o) out.push(o);
    }),
  );
  return out;
}
