/**
 * FN-17 — Install Stage 3 Domain Pack client (browse + activate).
 * Mutations go through the BFF proxy → install-service Stage 3 endpoint.
 */

import {
  DOMAIN_PACK_CATALOG,
  MUNICIPAL_DOMAIN_PACK,
  findCatalogEntry,
  type DomainPackCatalogEntry,
} from "./domainPackCatalog";
import { toHumanError } from "@/lib/messages";

export type DomainPackListItem = DomainPackCatalogEntry & {
  id?: string;
  version?: number;
  fromApi: boolean;
};

export type DomainPackActivateResult = {
  id: string;
  status: string;
  correlationId: string;
  domainPackKey: string;
  stageNumber: number;
  packKeys: string[];
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

/** Merge API domain packs with the static municipal pilot catalogue. */
export function mergeDomainPackCatalog(apiRows: unknown[]): DomainPackListItem[] {
  const byKey = new Map<string, DomainPackListItem>();

  for (const entry of DOMAIN_PACK_CATALOG) {
    byKey.set(entry.domainPackKey, { ...entry, fromApi: false });
  }

  for (const row of apiRows) {
    if (!isRecord(row)) continue;
    const key = str(row.domainPackKey);
    if (!key) continue;
    const catalog = findCatalogEntry(key);
    const apiPackKeys = Array.isArray(row.packKeys)
      ? row.packKeys.filter((k): k is string => typeof k === "string")
      : [];
    // GAP-INSTALL-DOMAIN-PACKS-03: the API is the source of truth for which
    // packs a Domain Pack activates. When it returns packKeys, derive the
    // outcome list from THOSE keys (using the static catalogue only to label
    // keys it recognises), so a server-side change to the pack set shows up in
    // both the preview and the activate request. Fall back to the static
    // catalogue outcomes only when the API returns no packKeys.
    const outcomes =
      apiPackKeys.length > 0
        ? apiPackKeys.map((packKey) => {
            const known = catalog?.outcomes.find((o) => o.packKey === packKey);
            return (
              known ?? {
                packKey,
                label: packKey.replace(/^pack:/, ""),
                shortLabel: packKey.replace(/^pack:/, "").slice(0, 12),
                description: "Editable catalogue draft after activation.",
              }
            );
          })
        : (catalog?.outcomes ?? []);
    byKey.set(key, {
      domainPackKey: key,
      name: str(row.name) || catalog?.name || key,
      sector: str(row.sector) || catalog?.sector || "general",
      jurisdiction: str(row.jurisdiction) || catalog?.jurisdiction || "",
      summary: catalog?.summary ?? "Import included service packs as editable catalogue drafts.",
      recommended: catalog?.recommended ?? key === MUNICIPAL_DOMAIN_PACK.domainPackKey,
      outcomes,
      id: str(row.id) || undefined,
      version: typeof row.version === "number" ? row.version : undefined,
      fromApi: true,
    });
  }

  return Array.from(byKey.values()).sort((a, b) => {
    if (a.recommended && !b.recommended) return -1;
    if (!a.recommended && b.recommended) return 1;
    return a.name.localeCompare(b.name);
  });
}

export type DomainPackFetchResult = {
  packs: DomainPackListItem[];
  /** True when the live list fetch failed and only the built-in catalogue is shown. */
  error: boolean;
};

/**
 * GAP-INSTALL-DOMAIN-PACKS-02 / GAP-INSTALL-HOME-07: fetch the Domain Pack
 * library, reporting whether the live fetch actually failed. A failed fetch
 * used to be swallowed and returned as the static municipal catalogue, so an
 * outage looked identical to a healthy single-pack library. The panel uses
 * this to show a retry banner ("Showing built-in pack only") over the fallback
 * instead of pretending the list loaded.
 */
export async function fetchDomainPacksForInstallResult(): Promise<DomainPackFetchResult> {
  try {
    const res = await fetch("/api/proxy/v1/citizen/packs/domain", { cache: "no-store" });
    if (!res.ok) return { packs: mergeDomainPackCatalog([]), error: true };
    const body = (await res.json()) as { data?: unknown[] };
    return { packs: mergeDomainPackCatalog(Array.isArray(body.data) ? body.data : []), error: false };
  } catch {
    return { packs: mergeDomainPackCatalog([]), error: true };
  }
}

/**
 * Back-compat wrapper returning just the pack list (built-in catalogue on
 * failure). Prefer {@link fetchDomainPacksForInstallResult} in UI so an outage
 * is not masked. Retained so existing callers/tests keep working unchanged.
 */
export async function fetchDomainPacksForInstall(): Promise<DomainPackListItem[]> {
  return (await fetchDomainPacksForInstallResult()).packs;
}

export async function activateDomainPackStage3(
  domainPackKey: string = MUNICIPAL_DOMAIN_PACK.domainPackKey,
  packKeys?: string[],
): Promise<DomainPackActivateResult> {
  const res = await fetch("/api/proxy/v1/install/stages/3/domain-pack/activate", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      domainPackKey,
      ...(packKeys?.length ? { packKeys } : {}),
    }),
  });

  if (!(res.ok || res.status === 202)) {
    const human = toHumanError("save", { area: "domain pack" });
    throw new Error(`${human.what} ${human.next}`);
  }

  const body = (await res.json()) as Partial<DomainPackActivateResult>;
  return {
    id: str(body.id),
    status: str(body.status) || "accepted",
    correlationId: str(body.correlationId),
    domainPackKey: str(body.domainPackKey) || domainPackKey,
    stageNumber: typeof body.stageNumber === "number" ? body.stageNumber : 3,
    packKeys: Array.isArray(body.packKeys)
      ? body.packKeys.filter((k): k is string => typeof k === "string")
      : [],
  };
}
