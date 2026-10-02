import type { EntityOption } from "@/app/_components/ds";

/** Row shape of GET /v1/asset/assets (the register list). `assetCode` is accepted too, like mapAssetSummaries. */
export type AssetPickerRow = { id: string; code?: string | null; assetCode?: string | null; name?: string | null };

/**
 * GAP-ASSETS-MAINTENANCE-NEW-05: one label for an asset in any picker/option.
 * "CODE · Name"; with neither, "Unnamed asset (ref a1b2c3)" using the last 6
 * characters of the id -- never the full raw UUID.
 */
export function assetOptionLabel(a: AssetPickerRow): string {
  const code = (a.assetCode ?? a.code ?? "").trim();
  const name = (a.name ?? "").trim();
  const label = [code, name].filter(Boolean).join(" · ");
  return label || `Unnamed asset (ref ${a.id.slice(-6)})`;
}

export function toAssetOption(a: AssetPickerRow): EntityOption {
  return { id: a.id, label: assetOptionLabel(a) };
}

function rowsOf(body: unknown): AssetPickerRow[] {
  if (Array.isArray(body)) return body as AssetPickerRow[];
  const data = (body as { data?: unknown } | null)?.data;
  return Array.isArray(data) ? (data as AssetPickerRow[]) : [];
}

/**
 * EntityPicker search(q) adapter over the register's server-side `?search=`
 * (GAP-ASSETS-MAINTENANCE-NEW-01): replaces "fetch the first 200 assets into a
 * <select>", so asset #300 is reachable by typing part of its code or name.
 * `onError(status)` lets the caller show a real error/permission state instead
 * of a silent "no results" (GAP-ASSETS-MAINTENANCE-NEW-02).
 */
export async function searchAssets(
  query: string,
  signal: AbortSignal,
  opts?: { onError?: (status: number | null) => void; onOk?: () => void },
): Promise<EntityOption[]> {
  try {
    const res = await fetch(`/api/proxy/v1/asset/assets?search=${encodeURIComponent(query)}&limit=20`, {
      signal,
      headers: { accept: "application/json" },
    });
    if (!res.ok) {
      opts?.onError?.(res.status);
      return [];
    }
    opts?.onOk?.();
    return rowsOf(await res.json()).map(toAssetOption);
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") return [];
    opts?.onError?.(null);
    return [];
  }
}

/** EntityPicker resolve(ids) adapter -- labels a deep-linked `?assetId=` on mount. */
export async function resolveAssets(ids: string[]): Promise<EntityOption[]> {
  const out: EntityOption[] = [];
  await Promise.all(ids.map(async (id) => {
    try {
      const res = await fetch(`/api/proxy/v1/asset/assets/${encodeURIComponent(id)}`, { headers: { accept: "application/json" } });
      if (!res.ok) return;
      const body = (await res.json()) as AssetPickerRow | { data?: AssetPickerRow };
      const row = "id" in body ? body : body.data;
      if (row && row.id) out.push(toAssetOption(row));
    } catch {
      /* a label that cannot be resolved just stays blank; the id is still submitted */
    }
  }));
  return out;
}
