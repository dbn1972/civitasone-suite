import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}
function arr(p: unknown): unknown[] {
  if (Array.isArray(p)) return p;
  if (isRecord(p) && Array.isArray(p.data)) return p.data;
  return [];
}
function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

export interface DesignerServiceRow {
  id: string;
  serviceKey: string;
  name: string;
  servicePattern: string;
  ownerDepartment: string;
  version: number;
  status: string;
  updatedAt: string;
  /**
   * GAP-DESIGNER-HOME-04: outcome of the most recent sandbox test, when the
   * catalogue list response carries it. Optional + additive: absent for
   * backends that don't yet project it, so existing callers are unaffected.
   * Used to flag stale/failed drafts in "Needs Attention".
   */
  latestTestStatus?: "pass" | "fail" | "pending" | null;
}

export interface DomainPackRow {
  id: string;
  domainPackKey: string;
  name: string;
  sector: string;
  jurisdiction: string;
  version: number;
  packCount: number;
}

export async function getDesignerServices(): Promise<LoaderResult<DesignerServiceRow[]>> {
  return fetchJson<unknown, DesignerServiceRow[]>("/api/v1/citizen/catalogue/services", [], {
    revalidateSeconds: 15,
    telemetryKey: "designer.catalogue.services",
    mapResponse: (p) =>
      arr(p).filter(isRecord).map((r) => ({
        id: str(r.id),
        serviceKey: str(r.serviceKey),
        name: str(r.name),
        servicePattern: str(r.servicePattern) || "certificate",
        ownerDepartment: str(r.ownerDepartment),
        version: typeof r.version === "number" ? r.version : 1,
        status: str(r.status) || "draft",
        updatedAt: str(r.updatedAt),
        latestTestStatus: typeof r.latestTestStatus === "string" && ["pass", "fail", "pending"].includes(r.latestTestStatus)
          ? (r.latestTestStatus as "pass" | "fail" | "pending")
          : null,
      })),
  });
}

export async function getDomainPacks(): Promise<LoaderResult<DomainPackRow[]>> {
  return fetchJson<unknown, DomainPackRow[]>("/api/v1/citizen/packs/domain", [], {
    revalidateSeconds: 60,
    telemetryKey: "designer.packs.domain",
    mapResponse: (p) =>
      arr(p).filter(isRecord).map((r) => ({
        id: str(r.id),
        domainPackKey: str(r.domainPackKey),
        name: str(r.name),
        sector: str(r.sector),
        jurisdiction: str(r.jurisdiction),
        version: typeof r.version === "number" ? r.version : 1,
        packCount: Array.isArray(r.packKeys) ? r.packKeys.length : 0,
      })),
  });
}

export {
  SERVICE_PATTERN_OPTIONS,
  DEFAULT_BLOCKS,
  hiddenBlocksForPattern,
} from "./designerConstants";

/** GAP-DESIGNER-HOME-02: server-side single-service fetch for the redirect page. */
export interface DesignerServiceDetail {
  id: string;
  serviceKey: string;
  name: string;
  status: string;
  servicePattern: string;
}

export async function getDesignerServiceById(id: string): Promise<LoaderResult<DesignerServiceDetail | null>> {
  return fetchJson<unknown, DesignerServiceDetail | null>(
    `/api/v1/citizen/catalogue/services/${encodeURIComponent(id)}`,
    null,
    {
      revalidateSeconds: 0,
      telemetryKey: "designer.catalogue.service.detail",
      mapResponse: (p) => {
        if (!isRecord(p)) return null;
        return {
          id: str(p.id),
          serviceKey: str(p.serviceKey),
          name: str(p.name),
          status: str(p.status) || "draft",
          servicePattern: str(p.servicePattern) || "certificate",
        };
      },
    },
  );
}

// ---------------------------------------------------------------------------
// GAP-DESIGNER-LIBRARY-05: Unify pack list load paths. Previously service
// packs loaded client-side via fetch(/api/proxy/...) while domain packs used
// the server-loader fetchJson path. Now both load through the server loader so
// the initial render has both available and errors are handled in one place.
// ---------------------------------------------------------------------------

export interface ServicePackLoaderRow {
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

function mapServicePack(r: Record<string, unknown>): ServicePackLoaderRow {
  const refs = Array.isArray(r.statutoryReferences) ? r.statutoryReferences : [];
  return {
    id: str(r.id),
    packKey: str(r.packKey),
    domainPackKey: r.domainPackKey == null ? null : str(r.domainPackKey),
    name: str(r.name),
    servicePattern: r.servicePattern == null ? null : str(r.servicePattern),
    feeModel: r.feeModel == null ? null : str(r.feeModel),
    hoaCode: r.hoaCode == null ? null : str(r.hoaCode),
    statutoryReferences: (refs as Record<string, unknown>[]).map((ref) => ({
      act: str(ref.act ?? ""),
      section: ref.section == null ? undefined : str(ref.section),
      url: ref.url == null ? undefined : str(ref.url),
    })),
    manifest:
      typeof r.manifest === "object" && r.manifest !== null
        ? (r.manifest as Record<string, unknown>)
        : {},
    version: typeof r.version === "number" ? r.version : 1,
    status: str(r.status ?? "draft"),
  };
}

export async function getServicePacks(): Promise<LoaderResult<ServicePackLoaderRow[]>> {
  return fetchJson<unknown, ServicePackLoaderRow[]>("/api/v1/citizen/packs/services", [], {
    revalidateSeconds: 30,
    telemetryKey: "designer.packs.services",
    mapResponse: (p) => arr(p).filter(isRecord).map(mapServicePack),
  });
}
