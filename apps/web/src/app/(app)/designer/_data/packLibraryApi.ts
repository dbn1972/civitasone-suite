"use client";

export interface ServicePackDto {
  id: string;
  packKey: string;
  domainPackKey: string | null;
  name: string;
  servicePattern: string | null;
  feeModel: string | null;
  hoaCode: string | null;
  statutoryReferences: { act: string; section?: string; url?: string }[];
  manifest: Record<string, unknown>;
  version: number;
  status: string;
}

async function parseAccepted(res: Response): Promise<string> {
  if (!(res.ok || res.status === 202)) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Import failed (${res.status})`);
  }
  const body = await res.json() as { id?: string };
  return body.id ?? "";
}

export async function fetchServicePacks(domainPackKey?: string): Promise<ServicePackDto[]> {
  const qs = domainPackKey ? `?domainPackKey=${encodeURIComponent(domainPackKey)}` : "";
  const res = await fetch(`/api/proxy/v1/citizen/packs/services${qs}`, { cache: "no-store" });
  if (!res.ok) return [];
  const body = await res.json() as { data?: unknown[] };
  return (body.data ?? []).map(mapPack);
}

export async function fetchServicePack(id: string): Promise<ServicePackDto | null> {
  const res = await fetch(`/api/proxy/v1/citizen/packs/services/${id}`, { cache: "no-store" });
  if (!res.ok) return null;
  return mapPack(await res.json());
}

/** FN-09 — export a published catalogue definition as a versioned service pack. */
export async function exportServicePack(definitionId: string): Promise<string> {
  const res = await fetch(`/api/proxy/v1/citizen/packs/services/export`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ definitionId }),
  });
  return parseAccepted(res);
}

/** FN-09 / FN-29 — import as draft; pass acknowledgeStatutory when pack has statutory refs. */
export async function importServicePack(
  packId: string,
  opts: { acknowledgeStatutory?: boolean } = {},
): Promise<string> {
  const res = await fetch(`/api/proxy/v1/citizen/packs/services/${packId}/import`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      acknowledgeStatutory: opts.acknowledgeStatutory === true ? true : undefined,
    }),
  });
  return parseAccepted(res);
}

function mapPack(raw: unknown): ServicePackDto {
  const r = raw as Record<string, unknown>;
  const refs = Array.isArray(r.statutoryReferences) ? r.statutoryReferences : [];
  return {
    id: String(r.id),
    packKey: String(r.packKey),
    domainPackKey: r.domainPackKey == null ? null : String(r.domainPackKey),
    name: String(r.name),
    servicePattern: r.servicePattern == null ? null : String(r.servicePattern),
    feeModel: r.feeModel == null ? null : String(r.feeModel),
    hoaCode: r.hoaCode == null ? null : String(r.hoaCode),
    statutoryReferences: refs.map((ref) => {
      const row = ref as Record<string, unknown>;
      return {
        act: String(row.act ?? ""),
        section: row.section == null ? undefined : String(row.section),
        url: row.url == null ? undefined : String(row.url),
      };
    }),
    manifest: typeof r.manifest === "object" && r.manifest !== null
      ? r.manifest as Record<string, unknown>
      : {},
    version: typeof r.version === "number" ? r.version : 1,
    status: String(r.status ?? "draft"),
  };
}
