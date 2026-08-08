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
    const packKeys = Array.isArray(row.packKeys)
      ? row.packKeys.filter((k): k is string => typeof k === "string")
      : catalog?.outcomes.map((o) => o.packKey) ?? [];
    byKey.set(key, {
      domainPackKey: key,
      name: str(row.name) || catalog?.name || key,
      sector: str(row.sector) || catalog?.sector || "general",
      jurisdiction: str(row.jurisdiction) || catalog?.jurisdiction || "",
      summary: catalog?.summary ?? "Import included service packs as editable catalogue drafts.",
      recommended: catalog?.recommended ?? key === MUNICIPAL_DOMAIN_PACK.domainPackKey,
      outcomes:
        catalog?.outcomes ??
        packKeys.map((packKey) => ({
          packKey,
          label: packKey.replace(/^pack:/, ""),
          shortLabel: packKey.replace(/^pack:/, "").slice(0, 12),
          description: "Editable catalogue draft after activation.",
        })),
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

export async function fetchDomainPacksForInstall(): Promise<DomainPackListItem[]> {
  try {
    const res = await fetch("/api/proxy/v1/citizen/packs/domain", { cache: "no-store" });
    if (!res.ok) return mergeDomainPackCatalog([]);
    const body = (await res.json()) as { data?: unknown[] };
    return mergeDomainPackCatalog(Array.isArray(body.data) ? body.data : []);
  } catch {
    return mergeDomainPackCatalog([]);
  }
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
    const text = await res.text().catch(() => "");
    let message = text || `Domain Pack activation failed (${res.status})`;
    try {
      const err = JSON.parse(text) as { message?: string; code?: string };
      if (err.message) message = err.message;
    } catch {
      /* keep text */
    }
    throw new Error(message);
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
